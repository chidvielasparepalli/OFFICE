import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type {
  RuntimeAgent,
  RuntimeCommand,
  RuntimeJson,
} from '../runtime/runtimeTypes'
import { DeterministicResearchProvider } from '../dev/deterministicResearchProvider'
import { ToolExecutor } from './ToolExecutor'
import { ToolRegistry } from './ToolRegistry'
import { createResearchTool } from './researchTool'
import {
  ToolFault,
  type Tool,
  type ToolGrant,
  type ToolRequest,
} from './toolTypes'
import {
  jsonOutputSchema,
  publicToolJson,
  toolObject,
  toolText,
} from './toolValidation'

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

function sampleTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: 'test.read',
    name: 'Trusted test read',
    description: 'A test-only tool.',
    category: 'data',
    capabilities: ['test.read'],
    permissions: ['read'],
    allowedKinds: ['standard-worker', 'manager'],
    timeoutMs: 1000,
    metadata: {},
    inputSchema: {
      description: 'A nonempty label',
      parse(value) {
        return { label: toolText(toolObject(value, ['label']).label, 'Label') }
      },
    },
    outputSchema: jsonOutputSchema,
    summarizeInput: () => ({ hasLabel: true }),
    execute: async () => ({ value: 'safe result' }),
    ...overrides,
  }
}

const resources: ToolExecutor[] = []
afterEach(() => {
  for (const executor of resources.splice(0)) executor.dispose()
})

function setup(
  tool = sampleTool(),
  kind: RuntimeAgent['kind'] = 'standard-worker',
  grant?: ToolGrant,
  runtime = createOfficeRuntime(),
) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test' },
  })
  send(runtime, {
    type: 'registerAgent',
    agent: {
      id: 'agent',
      name: 'Test agent',
      role: 'test',
      kind,
      departmentId: 'test',
      capabilities: [tool.id],
      position: [0, 0, 0],
      headingRadians: 0,
    },
  })
  send(runtime, {
    type: 'createTask',
    task: {
      id: 'task',
      title: 'Explicit tool test',
      description: 'A test task.',
    },
  })
  send(runtime, { type: 'assignTask', taskId: 'task', agentId: 'agent' })
  send(runtime, { type: 'startTask', taskId: 'task' })
  const registry = new ToolRegistry()
  registry.register(tool)
  const grants = {
    agent: grant ?? { toolIds: [tool.id], permissions: [...tool.permissions] },
  }
  const executor = new ToolExecutor({ runtime, registry, grants })
  resources.push(executor)
  const request: ToolRequest = {
    executionId: 'execution:1',
    agentId: 'agent',
    taskId: 'task',
    toolId: tool.id,
    input: { label: 'fixture' },
  }
  return { runtime, registry, executor, request, grants }
}

function abortableTool(overrides: Partial<Tool> = {}): Tool {
  return sampleTool({
    execute: (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.throwIfAborted()
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      }),
    ...overrides,
  })
}

describe('ToolRegistry and host permissions', () => {
  it('registers, lists, looks up and unregisters the one canonical tool', () => {
    const registry = new ToolRegistry()
    registry.register(sampleTool())
    expect(registry.list().map((tool) => tool.id)).toEqual(['test.read'])
    expect(registry.lookup('test.read')?.category).toBe('data')
    expect(() => registry.register(sampleTool())).toThrow('already registered')
    expect(registry.unregister('test.read')).toBe(true)
    expect(registry.lookup('test.read')).toBeUndefined()
  })

  it('rejects unbounded tool timeout configuration', () => {
    expect(() =>
      new ToolRegistry().register(sampleTool({ timeoutMs: Infinity })),
    ).toThrow(ToolFault)
  })

  it('requires both agent capabilities and explicit host permissions', () => {
    const { runtime, registry } = setup()
    const agent = runtime.getSnapshot().agents.agent
    expect(registry.checkCapability('test.read', agent).code).toBe(
      'PERMISSION_DENIED',
    )
    expect(
      registry.checkCapability(
        'test.read',
        { ...agent, capabilities: [] },
        { toolIds: ['test.read'], permissions: ['read'] },
      ).code,
    ).toBe('CAPABILITY_DENIED')
    expect(registry.checkCapability('missing', agent).code).toBe('UNKNOWN_TOOL')
  })

  it('does not let a broad grant override Manager tool-kind restrictions', async () => {
    const execute = vi.fn(async () => null)
    const { executor, request, runtime } = setup(
      sampleTool({ allowedKinds: ['standard-worker'], execute }),
      'manager',
    )
    const result = await executor.execute(request)
    expect(result).toMatchObject({
      status: 'failed',
      permission: { allowed: false, code: 'AGENT_KIND_DENIED' },
    })
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().agents.agent.kind).toBe('manager')
  })

  it('copies grants so callers cannot mutate executor permissions after construction', async () => {
    const { executor, request, grants } = setup()
    grants.agent = { toolIds: [], permissions: [] }
    expect((await executor.execute(request)).status).toBe('completed')
  })
})

describe('ToolExecutor through the existing authoritative runtime', () => {
  it('audits requested/start/completion without completing its task or inventing progress', async () => {
    const { executor, request, runtime } = setup()
    const result = await executor.execute(request)
    expect(result.status).toBe('completed')
    expect(result.startedAt).not.toBeNull()
    expect(result.completedAt).not.toBeNull()
    expect(runtime.getSnapshot().tasks.task).toMatchObject({
      status: 'in_progress',
      progressPercent: 0,
    })
    expect(runtime.getSnapshot().agents.agent).toMatchObject({
      status: 'working',
      currentTaskId: 'task',
    })
    expect(
      runtime
        .getSnapshot()
        .events.filter((event) => event.type.startsWith('TOOL_'))
        .map((event) => event.type),
    ).toEqual(['TOOL_REQUESTED', 'TOOL_STARTED', 'TOOL_COMPLETED'])
    expect(
      runtime
        .getSnapshot()
        .activities.some((activity) => activity.taskId === 'task'),
    ).toBe(true)
  })

  it('denies before execute, audits denial and blocks unresolved task for attention', async () => {
    const execute = vi.fn(async () => null)
    const { executor, request, runtime } = setup(
      sampleTool({ execute }),
      'standard-worker',
      { toolIds: [], permissions: [] },
    )
    expect((await executor.execute(request)).status).toBe('failed')
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
    expect(
      runtime
        .getSnapshot()
        .events.some((event) => event.type === 'TOOL_STARTED'),
    ).toBe(false)
  })

  it('validates malformed input before side effects and excludes raw input from history', async () => {
    const execute = vi.fn(async () => null)
    const { executor, request, runtime } = setup(sampleTool({ execute }))
    const result = await executor.execute({
      ...request,
      input: { label: 'fixture', password: 'do-not-log-me' },
    })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_INPUT' },
    })
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain('do-not-log-me')
  })

  it('fails safely when an output schema rejects a tool result', async () => {
    const { executor, request, runtime } = setup(
      sampleTool({
        outputSchema: {
          description: 'Always reject test',
          parse() {
            throw new ToolFault('INVALID_OUTPUT', 'Result rejected.')
          },
        },
      }),
    )
    expect(await executor.execute(request)).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_OUTPUT' },
      output: null,
    })
    expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
  })

  it('redacts obvious credential fields/text before output enters snapshot/events', async () => {
    const { executor, request, runtime } = setup(
      sampleTool({
        execute: async () => ({
          apiKey: 'hidden-key',
          text: 'password=hidden-password Bearer hidden-token',
        }),
      }),
    )
    expect((await executor.execute(request)).status).toBe('completed')
    const serialized = JSON.stringify(runtime.getSnapshot())
    for (const secret of ['hidden-key', 'hidden-password', 'hidden-token'])
      expect(serialized).not.toContain(secret)
  })

  it('returns structured safe failure without leaking unexpected exception details', async () => {
    const { executor, request } = setup(
      sampleTool({
        execute: async () => {
          throw new Error('host-secret-path-and-key')
        },
      }),
    )
    const result = await executor.execute(request)
    expect(result.error).toEqual({
      code: 'TOOL_FAILED',
      message: 'Tool execution could not be validated or completed.',
    })
  })

  it.each([
    new ToolFault('INVALID_INPUT', 'Line one\nLine two'),
    new ToolFault('bad code\n', ''),
  ])(
    'normalizes malformed adapter faults so failed audit records can always commit',
    async (fault) => {
      const { executor, request, runtime } = setup(
        sampleTool({
          inputSchema: {
            description: 'Malformed error fixture',
            parse() {
              throw fault
            },
          },
        }),
      )
      expect(await executor.execute(request)).toMatchObject({
        status: 'failed',
        error: { code: 'INVALID_INPUT' },
      })
      expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
      expect(executor.getMetrics().activeExecutions).toBe(0)
    },
  )

  it('runs duplicate execution IDs only once, including retries after completion', async () => {
    const execute = vi.fn(async () => 'once')
    const { executor, request } = setup(sampleTool({ execute }))
    const first = executor.execute(request)
    expect(executor.execute(request)).toBe(first)
    expect((await first).output).toBe('once')
    expect(
      (
        await executor.execute({
          ...request,
          input: { label: 'a retry cannot change the first request' },
        })
      ).output,
    ).toBe('once')
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      executor.execute({ ...request, taskId: 'other-task' }),
    ).rejects.toMatchObject({ code: 'EXECUTION_ID_CONFLICT' })
  })

  it('rejects wrong task ownership without launching or blocking another agent', async () => {
    const execute = vi.fn(async () => null)
    const { executor, request, runtime } = setup(sampleTool({ execute }))
    await expect(
      executor.execute({ ...request, taskId: 'unknown' }),
    ).rejects.toBeInstanceOf(ToolFault)
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().tasks.task.status).toBe('in_progress')
  })

  it.each(['queued', 'running'] as const)(
    'refuses startup with a restored %s execution and never replays its effects',
    (status) => {
      const { runtime, registry, executor, request, grants } = setup()
      executor.dispose()
      send(runtime, {
        type: 'requestToolExecution',
        ...request,
        inputSummary: null,
        permission: {
          allowed: true,
          code: 'ALLOWED',
          reason: 'Host grant',
          requiredPermissions: ['read'],
        },
      })
      if (status === 'running')
        send(runtime, {
          type: 'startToolExecution',
          executionId: request.executionId,
        })
      const restored = createOfficeRuntime({
        repository: { read: () => runtime.getSnapshot(), write: () => {} },
      })
      expect(
        () => new ToolExecutor({ runtime: restored, registry, grants }),
      ).toThrow('reconcile')
      expect(restored.getMetrics().subscribers).toBe(0)
      send(restored, {
        type: 'cancelToolExecution',
        executionId: request.executionId,
        reason: 'Operator reconciled interrupted host session.',
      })
      const recovered = new ToolExecutor({
        runtime: restored,
        registry,
        grants,
      })
      resources.push(recovered)
      expect(restored.getSnapshot().tasks.task.status).toBe('waiting')
    },
  )

  it('cancels a running operation, leaves task waiting and ignores late success', async () => {
    let resolve!: (value: RuntimeJson) => void
    const { executor, request, runtime } = setup(
      sampleTool({
        execute: () =>
          new Promise((done) => {
            resolve = done
          }),
      }),
    )
    const pending = executor.execute(request)
    await vi.waitFor(() =>
      expect(
        runtime.getSnapshot().toolExecutions[request.executionId]?.status,
      ).toBe('running'),
    )
    expect(executor.cancel(request.executionId)).toBe(true)
    resolve('late value must not become a success')
    expect((await pending).status).toBe('cancelled')
    expect(runtime.getSnapshot().tasks.task).toMatchObject({
      status: 'waiting',
      progressPercent: 0,
    })
    expect(
      runtime.getSnapshot().toolExecutions[request.executionId].output,
    ).toBeNull()
  })

  it('cancels a queued request before execution starts', async () => {
    const execute = vi.fn(async () => null)
    const { executor, request } = setup(sampleTool({ execute }))
    const pending = executor.execute(request)
    expect(executor.cancel(request.executionId)).toBe(true)
    expect((await pending).status).toBe('cancelled')
    expect(execute).not.toHaveBeenCalled()
  })

  it('times out an abort-aware operation and blocks its unresolved task', async () => {
    const { executor, request, runtime } = setup(
      abortableTool({ timeoutMs: 15 }),
    )
    expect(await executor.execute(request)).toMatchObject({
      status: 'failed',
      error: { code: 'TIMEOUT' },
    })
    expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
    expect(executor.getMetrics().activeExecutions).toBe(0)
  })

  it('allows cooperating process cleanup to settle before returning the timeout result', async () => {
    const { executor, request } = setup(
      sampleTool({
        timeoutMs: 5,
        execute: (_input, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => setTimeout(() => reject(signal.reason), 700),
              { once: true },
            )
          }),
      }),
    )
    expect((await executor.execute(request)).error?.code).toBe('TIMEOUT')
    expect(executor.getMetrics().activeExecutions).toBe(0)
  })

  it('bounds a noncooperating adapter timeout but retains its operational lease until it settles', async () => {
    let resolve!: (value: RuntimeJson) => void
    const { executor, request, runtime } = setup(
      sampleTool({
        timeoutMs: 5,
        execute: () =>
          new Promise((done) => {
            resolve = done
          }),
      }),
    )
    expect((await executor.execute(request)).error?.code).toBe('TIMEOUT')
    expect(executor.getMetrics().activeExecutions).toBe(1)
    send(runtime, { type: 'startTask', taskId: 'task' })
    await expect(
      executor.execute({ ...request, executionId: 'second' }),
    ).rejects.toMatchObject({ code: 'TOOL_ACTIVE' })
    resolve('discarded')
    await vi.waitFor(() =>
      expect(executor.getMetrics().activeExecutions).toBe(0),
    )
    expect(
      runtime.getSnapshot().toolExecutions[request.executionId].status,
    ).toBe('failed')
  })

  it('task cancellation aborts the host operation through one runtime subscription', async () => {
    let observedSignal: AbortSignal | undefined
    const { executor, request, runtime } = setup(
      abortableTool({
        execute: (_input, context) => {
          observedSignal = context.signal
          return new Promise((_resolve, reject) =>
            context.signal.addEventListener(
              'abort',
              () => reject(context.signal.reason),
              { once: true },
            ),
          )
        },
      }),
    )
    const pending = executor.execute(request)
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    send(runtime, { type: 'cancelTask', taskId: 'task' })
    expect((await pending).status).toBe('cancelled')
    expect(observedSignal!.aborted).toBe(true)
    expect(runtime.getSnapshot().tasks.task.status).toBe('cancelled')
  })

  it('disposal cancels work, removes subscriptions and rejects future execution', async () => {
    const { executor, request, runtime } = setup(abortableTool())
    const pending = executor.execute(request)
    await vi.waitFor(() =>
      expect(
        runtime.getSnapshot().toolExecutions[request.executionId]?.status,
      ).toBe('running'),
    )
    executor.dispose()
    expect((await pending).status).toBe('cancelled')
    expect(runtime.getMetrics().subscribers).toBe(0)
    await expect(
      executor.execute({ ...request, executionId: 'second' }),
    ).rejects.toMatchObject({ code: 'EXECUTOR_DISPOSED' })
  })

  it('disposal aborts every agent and unsubscribes even when a cancellation cannot be persisted', async () => {
    const repository = createInMemoryOfficeRuntimeRepository()
    let rejectCancel = false
    const runtime = createOfficeRuntime({
      repository: {
        read: () => repository.read(),
        write(state) {
          if (
            rejectCancel &&
            Object.values(state.toolExecutions).some(
              (item) => item.status === 'cancelled',
            )
          )
            throw new Error('Injected unavailable persistence')
          repository.write(state)
        },
      },
    })
    const signals: AbortSignal[] = []
    const tool = abortableTool({
      execute: (_input, { signal }) => {
        signals.push(signal)
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        )
      },
    })
    const prepared = setup(tool, 'standard-worker', undefined, runtime)
    prepared.executor.dispose()
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id: 'second',
        name: 'Second',
        role: 'test',
        kind: 'standard-worker',
        departmentId: 'test',
        capabilities: ['test.read'],
        position: [1, 0, 0],
        headingRadians: 0,
      },
    })
    send(runtime, {
      type: 'createTask',
      task: { id: 'second-task', title: 'Second task' },
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'second-task',
      agentId: 'second',
    })
    send(runtime, { type: 'startTask', taskId: 'second-task' })
    const executor = new ToolExecutor({
      runtime,
      registry: prepared.registry,
      grants: { ...prepared.grants, second: prepared.grants.agent },
    })
    resources.push(executor)
    const pending = [
      executor.execute(prepared.request),
      executor.execute({
        ...prepared.request,
        executionId: 'second-execution',
        agentId: 'second',
        taskId: 'second-task',
      }),
    ]
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    rejectCancel = true
    expect(() => executor.dispose()).toThrow(ToolFault)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(runtime.getMetrics().subscribers).toBe(0)
    expect(
      (await Promise.all(pending)).every((item) => item.status === 'failed'),
    ).toBe(true)
  })
})

describe('public output and provider-independent research', () => {
  it('rejects cycles, non-finite values, oversized bodies and unsafe object keys', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    for (const value of [
      cycle,
      Infinity,
      'x'.repeat(70_000),
      JSON.parse('{"__proto__": "unsafe"}'),
    ])
      expect(() => publicToolJson(value)).toThrow(ToolFault)
  })

  it('runs the clearly labelled deterministic research fixture through permission checks', async () => {
    const tool = createResearchTool(new DeterministicResearchProvider())
    const { executor, request, runtime } = setup(tool as Tool)
    expect(
      await executor.execute({ ...request, input: { query: 'Boundary test' } }),
    ).toMatchObject({
      status: 'completed',
      output: { mode: 'fixture', results: [{ url: null }] },
    })
    expect(JSON.stringify(runtime.getSnapshot())).toContain('No web search')
  })

  it('requires network permission for a live provider and does not invoke it when denied', async () => {
    const search = vi.fn(async () => ({
      mode: 'live' as const,
      summary: 'Actual provider response',
      results: [],
    }))
    const tool = createResearchTool({ mode: 'live', search })
    const { executor, request } = setup(tool as Tool, 'standard-worker', {
      toolIds: ['research.search'],
      permissions: ['read'],
    })
    expect(
      (await executor.execute({ ...request, input: { query: 'test' } })).status,
    ).toBe('failed')
    expect(search).not.toHaveBeenCalled()
  })

  it('rejects fabricated provider mode and unsafe/missing live source URLs', () => {
    const tool = createResearchTool({
      mode: 'live',
      search: async () => ({ mode: 'live', summary: 'unused', results: [] }),
    })
    for (const output of [
      { mode: 'fixture', summary: 'wrong mode', results: [] },
      {
        mode: 'live',
        summary: 'unsafe URL',
        results: [{ title: 'x', excerpt: 'x', url: 'javascript:alert(1)' }],
      },
      {
        mode: 'live',
        summary: 'missing source',
        results: [{ title: 'x', excerpt: 'x', url: null }],
      },
    ])
      expect(() => tool.outputSchema.parse(output)).toThrow(ToolFault)
  })
})
