import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeJson } from '../runtime/runtimeTypes'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import type { Tool, ToolGrant } from '../tools/toolTypes'
import { jsonOutputSchema } from '../tools/toolValidation'
import { QAEngine } from './QAEngine'
import type { QARequestInput } from './qaTypes'

const resources: ToolExecutor[] = []
afterEach(() => resources.splice(0).forEach((executor) => executor.dispose()))

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

function setup(options: { tool?: Partial<Tool>; grant?: ToolGrant } = {}) {
  const runtime = createOfficeRuntime()
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'qa', name: 'QA development test' },
  })
  for (const agentId of ['manager', 'worker', 'verifier'])
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id: agentId,
        name: agentId,
        role: agentId,
        departmentId: 'qa',
        kind: agentId === 'manager' ? 'manager' : 'standard-worker',
        capabilities: ['qa', 'validation.inspect', 'frontend'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  send(runtime, {
    type: 'createTask',
    task: {
      id: 'source',
      title: 'Development source',
      description: 'Explicit fixture task.',
    },
  })
  send(runtime, { type: 'assignTask', taskId: 'source', agentId: 'worker' })
  send(runtime, { type: 'startTask', taskId: 'source' })
  send(runtime, { type: 'completeTask', taskId: 'source' })
  const execute = vi.fn(async () => ({ valid: true }))
  const tool: Tool = {
    id: 'validation.inspect',
    name: 'Fixture inspection',
    description: 'Deterministic test-only structured validation.',
    category: 'validation',
    capabilities: ['validation.inspect'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 1000,
    metadata: {},
    inputSchema: jsonOutputSchema,
    outputSchema: jsonOutputSchema,
    summarizeInput: () => ({ fixture: true }),
    execute,
    ...options.tool,
  }
  const registry = new ToolRegistry()
  registry.register(tool)
  const executor = new ToolExecutor({
    runtime,
    registry,
    grants: {
      verifier: options.grant ?? { toolIds: [tool.id], permissions: ['read'] },
    },
  })
  resources.push(executor)
  const engine = new QAEngine({ runtime, executor })
  const input: QARequestInput = {
    qaId: 'qa:test',
    taskId: 'source',
    requestedBy: 'manager',
    scope: 'Explicit fixture structure',
    repairCapabilities: ['frontend'],
    checks: [
      {
        checkId: 'valid',
        title: 'Valid fixture structure',
        type: 'structure',
        required: true,
        severity: 'error',
        toolId: tool.id,
        input: { fixture: true },
        assertion: { kind: 'equals', path: ['valid'], value: true },
      },
    ],
  }
  return { runtime, registry, executor, engine, input, execute }
}

describe('QAEngine through the existing ToolExecutor', () => {
  it('does not treat inherited object properties as retained QA results', async () => {
    const { engine } = setup()
    await expect(engine.run('constructor', 'verifier')).rejects.toMatchObject({
      code: 'QA_NOT_FOUND',
    })
    await expect(engine.run('missing', 'verifier')).rejects.toMatchObject({
      code: 'QA_NOT_FOUND',
    })
  })

  it('requests, executes and verifies using committed authorized evidence', async () => {
    const { runtime, engine, input, execute } = setup()
    const created = engine.request(input)
    expect(created.status).toBe('queued')
    const result = await engine.run(created.qaId, 'verifier')
    expect(result.status).toBe('passed')
    expect(result.result?.evidence[0]).toMatchObject({
      matched: true,
      toolId: 'validation.inspect',
    })
    expect(execute).toHaveBeenCalledTimes(1)
    const state = runtime.getSnapshot()
    expect(state.tasks.source.status).toBe('completed')
    expect(state.tasks.source.verification?.status).toBe('verified')
    expect(state.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'QA_REQUESTED',
        'QA_STARTED',
        'TOOL_REQUESTED',
        'TOOL_COMPLETED',
        'QA_PASSED',
      ]),
    )
    expect(state.agents.manager.kind).toBe('manager')
  })

  it('deduplicates concurrent same-verifier runs and never reruns terminal QA', async () => {
    const { engine, input, execute } = setup()
    engine.request(input)
    const first = engine.run('qa:test', 'verifier')
    expect(engine.run('qa:test', 'verifier')).toBe(first)
    await expect(engine.run('qa:test', 'worker')).rejects.toMatchObject({
      code: 'QA_VERIFIER_CONFLICT',
    })
    const result = await first
    expect(await engine.run('qa:test', 'verifier')).toBe(result)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('retains exact tool idempotency after QA finishes but rejects input replacement', async () => {
    const { runtime, engine, executor, input, execute } = setup()
    engine.request(input)
    const qa = await engine.run('qa:test', 'verifier')
    const state = runtime.getSnapshot()
    const request = {
      executionId: qa.executionIds.valid,
      agentId: 'verifier',
      taskId: qa.inspectionTaskId!,
      toolId: input.checks[0].toolId,
      input: input.checks[0].input,
    }
    expect(await executor.execute(request)).toBe(
      state.toolExecutions[request.executionId],
    )
    await expect(
      executor.execute({ ...request, input: { fixture: false } }),
    ).rejects.toMatchObject({ code: 'QA_EXECUTION_CONFLICT' })
    expect(runtime.getSnapshot()).toBe(state)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('denies tools without an explicit host grant and reports blocked QA', async () => {
    const { runtime, engine, input, execute } = setup({
      grant: { toolIds: [], permissions: [] },
    })
    engine.request(input)
    const result = await engine.run('qa:test', 'verifier')
    expect(result.status).toBe('blocked')
    expect(result.result?.evidence[0]).toMatchObject({
      errorCode: 'PERMISSION_DENIED',
      matched: null,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().tasks.source.verification?.status).toBe(
      'blocked',
    )
    expect(
      runtime.getSnapshot().events.some((event) => event.type === 'QA_PASSED'),
    ).toBe(false)
  })

  it('does not accept a different input under the allocated check execution identity', async () => {
    const { runtime, engine, executor, input } = setup({
      tool: {
        execute: async (value) => ({
          valid: (value as { valid: boolean }).valid,
        }),
      },
    })
    engine.request({
      ...input,
      checks: [{ ...input.checks[0], input: { valid: false } }],
    })
    send(runtime, {
      type: 'startQA',
      qaId: 'qa:test',
      verifierAgentId: 'verifier',
    })
    const qa = runtime.getSnapshot().qaRequests['qa:test']
    await executor
      .execute({
        executionId: qa.executionIds.valid,
        agentId: 'verifier',
        taskId: qa.inspectionTaskId!,
        toolId: 'validation.inspect',
        input: { valid: true },
      })
      .catch(() => null)
    send(runtime, { type: 'completeQA', qaId: qa.qaId })
    expect(runtime.getSnapshot().qaRequests[qa.qaId].status).not.toBe('passed')
  })

  it('does not bypass a removed tool registration', async () => {
    const { engine, registry, input, execute } = setup()
    engine.request(input)
    registry.unregister('validation.inspect')
    expect((await engine.run('qa:test', 'verifier')).status).toBe('blocked')
    expect(execute).not.toHaveBeenCalled()
  })

  it('records assertion failure independently from successful tool execution', async () => {
    const { runtime, engine, input } = setup({
      tool: { execute: async () => ({ valid: false }) },
    })
    engine.request(input)
    const result = await engine.run('qa:test', 'verifier')
    expect(result.status).toBe('failed')
    expect(Object.values(runtime.getSnapshot().toolExecutions)[0].status).toBe(
      'completed',
    )
    expect(runtime.getSnapshot().tasks.source.verification?.status).toBe(
      'failed',
    )
  })

  it('blocks malformed output instead of converting it into a QA pass', async () => {
    const { engine, input } = setup({
      tool: { execute: async () => ({ invalid: NaN }) },
    })
    engine.request(input)
    expect((await engine.run('qa:test', 'verifier')).status).toBe('blocked')
  })

  it('does not complete cancelled QA when an adapter returns late', async () => {
    let resolve!: (output: RuntimeJson) => void
    const { runtime, engine, input } = setup({
      tool: {
        execute: () =>
          new Promise((done) => {
            resolve = done
          }),
      },
    })
    engine.request(input)
    const running = engine.run('qa:test', 'verifier')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    send(runtime, {
      type: 'cancelQA',
      qaId: 'qa:test',
      reason: 'Explicit development cancellation.',
    })
    resolve({ valid: true })
    expect((await running).status).toBe('cancelled')
    expect(
      runtime.getSnapshot().events.some((event) => event.type === 'QA_PASSED'),
    ).toBe(false)
  })

  it('does not publish completion after disconnect', async () => {
    let resolve!: (output: RuntimeJson) => void
    const { runtime, engine, input } = setup({
      tool: {
        execute: () =>
          new Promise((done) => {
            resolve = done
          }),
      },
    })
    engine.request(input)
    const running = engine.run('qa:test', 'verifier')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    send(runtime, { type: 'disconnect' })
    const revision = runtime.getSnapshot().revision
    resolve({ valid: true })
    await running
    expect(runtime.getSnapshot().revision).toBe(revision)
    expect(
      runtime.getSnapshot().events.some((event) => event.type === 'QA_PASSED'),
    ).toBe(false)
  })

  it('does not verify after the canonical inspection task is cancelled', async () => {
    const { runtime, engine, input } = setup()
    engine.request(input)
    const unsubscribe = runtime.subscribe(() => {
      const qa = runtime.getSnapshot().qaRequests['qa:test']
      if (qa.status !== 'running' || !qa.inspectionTaskId) return
      const task = runtime.getSnapshot().tasks[qa.inspectionTaskId]
      if (
        task.status === 'in_progress' &&
        Object.values(runtime.getSnapshot().toolExecutions).some(
          (execution) => execution.status === 'completed',
        )
      )
        send(runtime, {
          type: 'cancelTask',
          taskId: task.id,
          reason: 'Operator cancelled inspection.',
        })
    })
    try {
      expect((await engine.run('qa:test', 'verifier')).status).toBe('cancelled')
      expect(
        runtime
          .getSnapshot()
          .events.some((event) => event.type === 'QA_PASSED'),
      ).toBe(false)
    } finally {
      unsubscribe()
    }
  })

  it('rejects credential-bearing request data before events or execution', () => {
    const { runtime, engine, input, execute } = setup()
    const previous = runtime.getSnapshot()
    expect(() =>
      engine.request({
        ...input,
        checks: [
          {
            ...input.checks[0],
            input: { note: 'password=synthetic-qa-fixture' },
          },
        ],
      }),
    ).toThrow()
    expect(runtime.getSnapshot()).toBe(previous)
    expect(execute).not.toHaveBeenCalled()
  })
})
