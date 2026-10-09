import { describe, expect, it, vi } from 'vitest'
import { ManagerOrchestrator } from '../orchestration/ManagerOrchestrator'
import type { PlanProposal } from '../orchestration/orchestrationTypes'
import type {
  ToolPermissionDecision,
  ToolRuntimeCommand,
} from '../tools/toolTypes'
import {
  createEmptyRuntimeState,
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from './officeRuntime'
import type {
  OfficeRuntimeRepository,
  RuntimeCommand,
  RuntimeJson,
  RuntimeState,
} from './runtimeTypes'

const NOW = '2026-10-09T16:00:00.000Z'
const allowed: ToolPermissionDecision = {
  allowed: true,
  code: 'ALLOWED',
  reason: 'Explicit host read grant.',
  requiredPermissions: ['read'],
}

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return runtime.getSnapshot()
}

function reject(
  runtime: OfficeRuntime,
  command: RuntimeCommand,
  code?: string,
) {
  const snapshot = runtime.getSnapshot()
  const result = runtime.dispatch(command)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected rejection')
  if (code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(snapshot)
}

function seed(runtime = createOfficeRuntime({ now: () => NOW })) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test' },
  })
  for (const [id, kind] of [
    ['manager', 'manager'],
    ['a', 'standard-worker'],
    ['b', 'standard-worker'],
  ] as const)
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        kind,
        name: id,
        role: kind,
        departmentId: 'test',
        managerId: kind === 'manager' ? null : 'manager',
        capabilities: ['research'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  return runtime
}

function work(runtime: OfficeRuntime, taskId = 'task', agentId = 'a') {
  send(runtime, { type: 'createTask', task: { id: taskId, title: taskId } })
  send(runtime, { type: 'assignTask', taskId, agentId })
  send(runtime, { type: 'startTask', taskId })
  send(runtime, { type: 'updateProgress', taskId, progressPercent: 25 })
  return runtime
}

type RequestCommand = Extract<
  ToolRuntimeCommand,
  { type: 'requestToolExecution' }
>
function request(changes: Partial<RequestCommand> = {}): RequestCommand {
  return {
    type: 'requestToolExecution',
    executionId: 'execution',
    agentId: 'a',
    taskId: 'task',
    toolId: 'filesystem.read',
    inputSummary: { path: 'project/README.md' },
    permission: allowed,
    ...changes,
  }
}

function running(runtime = work(seed()), command = request()) {
  send(runtime, command)
  send(runtime, {
    type: 'startToolExecution',
    executionId: command.executionId,
  })
  return runtime
}

function acceptPlan(runtime: OfficeRuntime) {
  send(runtime, {
    type: 'receiveRequest',
    managerId: 'manager',
    request: {
      requestId: 'request',
      title: 'Research',
      description: 'Explicit test research.',
      requestedBy: 'test',
      priority: 'normal',
      constraints: [],
    },
  })
  const state = send(runtime, {
    type: 'beginPlanning',
    managerId: 'manager',
    requestId: 'request',
  })
  const proposal: PlanProposal = {
    planId: 'plan',
    requestId: 'request',
    objective: 'Research',
    constraints: [],
    expectedOutputs: [],
    tasks: [
      {
        id: 'task',
        title: 'Research',
        description: 'Inspect supplied fixture.',
        status: 'queued',
        priority: 'normal',
        dependencyIds: [],
        requiredCapabilities: ['research'],
        preferredAgentId: 'a',
      },
    ],
  }
  send(runtime, {
    type: 'acceptPlan',
    managerId: 'manager',
    requestId: 'request',
    attemptId: state.requests.request.planningAttemptId!,
    proposal,
  })
  send(runtime, {
    type: 'dispatchPlanTask',
    managerId: 'manager',
    planId: 'plan',
    taskId: 'task',
    agentId: 'a',
  })
}

describe('tool lifecycle in the authoritative runtime', () => {
  it('records immutable request/permission audit and actual lifecycle without completing or progressing the task', () => {
    let tick = 0
    const runtime = work(
      seed(
        createOfficeRuntime({
          now: () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString(),
        }),
      ),
    )
    const before = runtime.getSnapshot()
    const input = { path: 'README.md', details: ['safe-summary'] }
    const metadata = { category: 'filesystem' }
    const decision = { ...allowed, requiredPermissions: ['read'] as const }
    const queued = send(
      runtime,
      request({ inputSummary: input, permission: decision, metadata }),
    )
    input.details.push('changed caller input')
    metadata.category = 'changed'
    expect(queued.toolExecutions.execution).toMatchObject({
      status: 'queued',
      startedAt: null,
      completedAt: null,
      output: null,
      error: null,
      inputSummary: { path: 'README.md', details: ['safe-summary'] },
      metadata: { category: 'filesystem' },
    })
    expect(
      Object.isFrozen(
        queued.toolExecutions.execution.permission.requiredPermissions,
      ),
    ).toBe(true)
    const started = send(runtime, {
      type: 'startToolExecution',
      executionId: 'execution',
    })
    expect(started.toolExecutions.execution.startedAt).not.toBe(
      queued.toolExecutions.execution.requestedAt,
    )
    const output = { bytes: 24, result: ['public fixture'] }
    const completed = send(runtime, {
      type: 'completeToolExecution',
      executionId: 'execution',
      output,
    })
    output.result.push('caller mutation')
    expect(completed.toolExecutions.execution).toMatchObject({
      status: 'completed',
      output: { bytes: 24, result: ['public fixture'] },
    })
    expect(completed.tasks).toBe(before.tasks)
    expect(completed.agents).toBe(before.agents)
    expect(completed.tasks.task).toMatchObject({
      status: 'in_progress',
      progressPercent: 25,
    })
    expect(completed.agents.a.status).toBe('working')
    expect(completed.events.slice(-3).map((event) => event.type)).toEqual([
      'TOOL_REQUESTED',
      'TOOL_STARTED',
      'TOOL_COMPLETED',
    ])
    expect(completed.activities.at(-1)?.summary).toContain(
      'task completion remains explicit',
    )
    send(runtime, { type: 'completeTask', taskId: 'task' })
    expect(runtime.getSnapshot().tasks.task.status).toBe('completed')
  })

  it('requires the exact assigned/current in-progress task and working agent', () => {
    const runtime = work(seed())
    send(runtime, {
      type: 'createTask',
      task: { id: 'unassigned', title: 'Unassigned' },
    })
    reject(runtime, request({ agentId: 'b' }), 'INVALID_ASSIGNMENT')
    reject(runtime, request({ taskId: 'unassigned' }), 'INVALID_ASSIGNMENT')
    reject(runtime, request({ agentId: 'missing' }), 'NOT_FOUND')
    send(runtime, { type: 'waitTask', taskId: 'task', reason: 'Manual hold' })
    reject(runtime, request(), 'INVALID_TRANSITION')
    send(runtime, { type: 'startTask', taskId: 'task' })
    send(runtime, {
      type: 'requestMovement',
      agentId: 'a',
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Explicit collaboration',
      arrivalStatus: 'collaborating',
    })
    reject(runtime, request(), 'INVALID_TRANSITION')
  })

  it('allows one live execution per agent, allows another agent, and never retries an execution ID', () => {
    const runtime = running()
    reject(runtime, request({ executionId: 'second' }), 'TOOL_ACTIVE')
    work(runtime, 'other-task', 'b')
    send(
      runtime,
      request({ executionId: 'other', agentId: 'b', taskId: 'other-task' }),
    )
    send(runtime, {
      type: 'completeToolExecution',
      executionId: 'execution',
      output: null,
    })
    reject(runtime, request(), 'DUPLICATE_ID')
    send(runtime, request({ executionId: 'new-attempt' }))
    expect(runtime.getSnapshot().toolExecutions.other.status).toBe('queued')
  })

  it.each(['queued', 'running'] as const)(
    'prevents task completion and movement while a tool is %s',
    (status) => {
      const runtime = work(seed())
      send(runtime, request())
      if (status === 'running')
        send(runtime, { type: 'startToolExecution', executionId: 'execution' })
      reject(runtime, { type: 'completeTask', taskId: 'task' }, 'TOOL_ACTIVE')
      reject(
        runtime,
        {
          type: 'requestMovement',
          agentId: 'a',
          destinationType: 'hub',
          destinationId: 'hub:central',
          movementReason: 'Move',
          arrivalStatus: 'collaborating',
        },
        'TOOL_ACTIVE',
      )
      expect(runtime.getSnapshot().agents.a.status).toBe('working')
    },
  )

  it('records denied permission atomically without a start and blocks unresolved work', () => {
    const runtime = work(seed())
    const listener = vi.fn()
    runtime.subscribe(listener)
    const before = runtime.getSnapshot()
    const state = send(
      runtime,
      request({
        permission: {
          ...allowed,
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: 'No write grant.',
          requiredPermissions: ['write'],
        },
      }),
    )
    expect(listener).toHaveBeenCalledTimes(1)
    expect(state.revision).toBe(before.revision + 1)
    expect(state.toolExecutions.execution).toMatchObject({
      status: 'failed',
      startedAt: null,
      completedAt: NOW,
      error: { code: 'PERMISSION_DENIED', message: 'No write grant.' },
    })
    expect(state.tasks.task).toMatchObject({
      status: 'blocked',
      progressPercent: 25,
      completedAt: null,
    })
    expect(state.agents.a.status).toBe('blocked')
    const events = state.events.slice(before.events.length)
    expect(events.map((event) => event.type)).toEqual([
      'TOOL_REQUESTED',
      'TOOL_FAILED',
      'AGENT_BLOCKED',
    ])
    expect(
      events.every(
        (event) =>
          event.transactionRevision === state.revision &&
          event.transactionEventCount === 3,
      ),
    ).toBe(true)
    reject(
      runtime,
      { type: 'startToolExecution', executionId: 'execution' },
      'STALE_TOOL_EXECUTION',
    )
  })

  it('records Manager host restrictions without substituting a worker or inventing permissions', () => {
    const runtime = work(seed(), 'coordination', 'manager')
    send(
      runtime,
      request({
        executionId: 'manager-read',
        taskId: 'coordination',
        agentId: 'manager',
        toolId: 'research.fixture',
      }),
    )
    send(runtime, { type: 'startToolExecution', executionId: 'manager-read' })
    send(runtime, {
      type: 'completeToolExecution',
      executionId: 'manager-read',
      output: { source: 'explicit development fixture' },
    })
    expect(runtime.getSnapshot().agents.manager).toMatchObject({
      kind: 'manager',
      status: 'working',
      currentTaskId: 'coordination',
    })
    send(
      runtime,
      request({
        executionId: 'manager-write',
        taskId: 'coordination',
        agentId: 'manager',
        permission: {
          ...allowed,
          allowed: false,
          code: 'KIND_DENIED',
          reason: 'Manager write execution is not permitted.',
          requiredPermissions: ['write'],
        },
      }),
    )
    expect(
      runtime.getSnapshot().toolExecutions['manager-write'].startedAt,
    ).toBeNull()
    expect(runtime.getSnapshot().tasks.coordination.status).toBe('blocked')
  })

  it.each(['queued', 'running'] as const)(
    'fails a %s execution without task completion and redacts error text',
    (status) => {
      const runtime = work(seed())
      send(runtime, request())
      if (status === 'running')
        send(runtime, { type: 'startToolExecution', executionId: 'execution' })
      const state = send(runtime, {
        type: 'failToolExecution',
        executionId: 'execution',
        error: {
          code: 'TIMEOUT',
          message: 'Timed out; api_key=do-not-log-this',
        },
      })
      expect(state.toolExecutions.execution).toMatchObject({
        status: 'failed',
        error: { code: 'TIMEOUT', message: 'Timed out; api_key=[REDACTED]' },
      })
      expect(state.tasks.task).toMatchObject({
        status: 'blocked',
        progressPercent: 25,
        completedAt: null,
        failedAt: null,
      })
      expect(JSON.stringify(state)).not.toContain('do-not-log-this')
      reject(
        runtime,
        {
          type: 'completeToolExecution',
          executionId: 'execution',
          output: 'late success',
        },
        'STALE_TOOL_EXECUTION',
      )
    },
  )

  it.each(['queued', 'running'] as const)(
    'cancels a %s execution to an explicit wait and rejects every late callback',
    (status) => {
      const runtime = work(seed())
      send(runtime, request())
      if (status === 'running')
        send(runtime, { type: 'startToolExecution', executionId: 'execution' })
      const state = send(runtime, {
        type: 'cancelToolExecution',
        executionId: 'execution',
        reason: 'Operator cancellation',
      })
      expect(state.toolExecutions.execution.status).toBe('cancelled')
      expect(state.tasks.task).toMatchObject({
        status: 'waiting',
        waitingForDependencies: false,
        progressPercent: 25,
      })
      expect(state.agents.a.status).toBe('waiting')
      for (const command of [
        { type: 'startToolExecution', executionId: 'execution' },
        {
          type: 'completeToolExecution',
          executionId: 'execution',
          output: null,
        },
        {
          type: 'failToolExecution',
          executionId: 'execution',
          error: { code: 'LATE', message: 'Late rejection' },
        },
        {
          type: 'cancelToolExecution',
          executionId: 'execution',
          reason: 'Duplicate cancellation',
        },
      ] as const)
        reject(runtime, command, 'STALE_TOOL_EXECUTION')
      send(runtime, { type: 'startTask', taskId: 'task' })
      send(runtime, request({ executionId: 'new' }))
    },
  )

  it.each([
    ['failTask', 'failed'],
    ['cancelTask', 'cancelled'],
    ['waitTask', 'waiting'],
    ['blockTask', 'blocked'],
  ] as const)(
    'invalidates tools atomically on %s without replacing the requested task state',
    (type, status) => {
      const runtime = running()
      const listener = vi.fn()
      runtime.subscribe(listener)
      send(runtime, {
        type,
        taskId: 'task',
        reason: 'Explicit task transition',
      })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(runtime.getSnapshot().toolExecutions.execution.status).toBe(
        'cancelled',
      )
      expect(runtime.getSnapshot().tasks.task).toMatchObject({
        status,
        progressPercent: 25,
      })
      reject(
        runtime,
        {
          type: 'failToolExecution',
          executionId: 'execution',
          error: { code: 'LATE', message: 'Late host response' },
        },
        'STALE_TOOL_EXECUTION',
      )
    },
  )

  it('never lets an old response block an agent after a different task is assigned', () => {
    const runtime = running()
    send(runtime, { type: 'cancelTask', taskId: 'task' })
    work(runtime, 'replacement')
    reject(
      runtime,
      {
        type: 'failToolExecution',
        executionId: 'execution',
        error: { code: 'LATE', message: 'Old task failed' },
      },
      'STALE_TOOL_EXECUTION',
    )
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'working',
      currentTaskId: 'replacement',
    })
    expect(runtime.getSnapshot().tasks.replacement.status).toBe('in_progress')
  })

  it('cancels work put on a dependency hold without auto-starting after dependency completion', () => {
    const runtime = running()
    work(runtime, 'dependency', 'b')
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'task',
      dependencyIds: ['dependency'],
    })
    expect(runtime.getSnapshot().toolExecutions.execution.status).toBe(
      'cancelled',
    )
    expect(runtime.getSnapshot().tasks.task).toMatchObject({
      status: 'waiting',
      waitingForDependencies: true,
    })
    send(runtime, { type: 'completeTask', taskId: 'dependency' })
    expect(runtime.getSnapshot().tasks.task.status).toBe('assigned')
    expect(runtime.getSnapshot().agents.a.status).toBe('queued')
  })

  it('disconnects all live executions atomically and reconnect never revives them', () => {
    const runtime = running()
    work(runtime, 'task-b', 'b')
    send(
      runtime,
      request({ executionId: 'queued-b', agentId: 'b', taskId: 'task-b' }),
    )
    const listener = vi.fn()
    runtime.subscribe(listener)
    send(runtime, { type: 'disconnect' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(
      Object.values(runtime.getSnapshot().toolExecutions).map(
        (execution) => execution.status,
      ),
    ).toEqual(['cancelled', 'cancelled'])
    expect(runtime.getSnapshot().tasks.task.status).toBe('waiting')
    expect(runtime.getSnapshot().tasks['task-b'].status).toBe('waiting')
    reject(
      runtime,
      { type: 'completeToolExecution', executionId: 'execution', output: null },
      'DISCONNECTED',
    )
    send(runtime, { type: 'connect' })
    reject(
      runtime,
      { type: 'completeToolExecution', executionId: 'execution', output: null },
      'STALE_TOOL_EXECUTION',
    )
  })
})

describe('tool boundary validation, atomic publication and Manager monitoring', () => {
  it('uses bounded copied public JSON and redacts known credential fields before audit publication', () => {
    const runtime = work(seed())
    send(
      runtime,
      request({
        inputSummary: { password: 'input-secret', safe: 'Bearer input-token' },
        metadata: { apiKey: 'metadata-secret' },
      }),
    )
    send(runtime, { type: 'startToolExecution', executionId: 'execution' })
    send(runtime, {
      type: 'completeToolExecution',
      executionId: 'execution',
      output: { token: 'output-secret', safe: 'password=inline-secret' },
    })
    const serialized = JSON.stringify(runtime.getSnapshot())
    for (const secret of [
      'input-secret',
      'input-token',
      'metadata-secret',
      'output-secret',
      'inline-secret',
    ])
      expect(serialized).not.toContain(secret)
    expect(runtime.getSnapshot().toolExecutions.execution.output).toEqual({
      token: '[REDACTED]',
      safe: 'password=[REDACTED]',
    })
  })

  it('rejects malformed permission, IDs, summaries and metadata without partial records', () => {
    const runtime = work(seed())
    for (const command of [
      request({ executionId: '__proto__' }),
      request({ executionId: 'has spaces' }),
      request({
        permission: { ...allowed, requiredPermissions: ['read', 'read'] },
      }),
      request({
        permission: { ...allowed, allowed: 'yes' as unknown as boolean },
      }),
      request({ metadata: [] as unknown as Record<string, RuntimeJson> }),
      request({ inputSummary: 'x'.repeat(9000) }),
      request({ inputSummary: Number.NaN }),
    ])
      reject(runtime, command)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    reject(runtime, request({ inputSummary: cyclic as RuntimeJson }))
    expect(runtime.getSnapshot().toolExecutions).toEqual({})
  })

  it('rejects invalid output atomically, allowing the executor to explicitly report validation failure', () => {
    const runtime = running()
    for (const output of [
      Number.POSITIVE_INFINITY,
      'x'.repeat(70 * 1024),
      new Date() as unknown as RuntimeJson,
    ])
      reject(runtime, {
        type: 'completeToolExecution',
        executionId: 'execution',
        output,
      })
    expect(runtime.getSnapshot().toolExecutions.execution.status).toBe(
      'running',
    )
    send(runtime, {
      type: 'failToolExecution',
      executionId: 'execution',
      error: {
        code: 'INVALID_OUTPUT',
        message: 'Tool output did not match the schema.',
      },
    })
    expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
  })

  it('rejects unstarted completion, duplicate start, and unknown execution IDs', () => {
    const runtime = work(seed())
    send(runtime, request())
    reject(
      runtime,
      { type: 'completeToolExecution', executionId: 'execution', output: null },
      'INVALID_TRANSITION',
    )
    reject(
      runtime,
      { type: 'startToolExecution', executionId: 'missing' },
      'NOT_FOUND',
    )
    send(runtime, { type: 'startToolExecution', executionId: 'execution' })
    reject(
      runtime,
      { type: 'startToolExecution', executionId: 'execution' },
      'INVALID_TRANSITION',
    )
  })

  it('rolls back denied audit and task blocking if the repository cannot commit', () => {
    let storage: RuntimeState | null = null
    let refuse = false
    const repository: OfficeRuntimeRepository = {
      read: () => storage,
      write: (state) => {
        if (refuse) throw new Error('Unavailable')
        storage = state
      },
    }
    const runtime = work(
      seed(createOfficeRuntime({ repository, now: () => NOW })),
    )
    const listener = vi.fn()
    runtime.subscribe(listener)
    const before = runtime.getSnapshot()
    refuse = true
    reject(
      runtime,
      request({
        permission: {
          ...allowed,
          allowed: false,
          code: 'DENIED',
          reason: 'Denied',
        },
      }),
      'REPOSITORY_ERROR',
    )
    expect(storage).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().tasks.task.status).toBe('in_progress')
  })

  it('reconstructs tool records and affected business state from committed event after-images', () => {
    const runtime = running()
    send(runtime, {
      type: 'completeToolExecution',
      executionId: 'execution',
      output: { evidence: 'development fixture' },
    })
    send(
      runtime,
      request({
        executionId: 'denied',
        permission: {
          ...allowed,
          allowed: false,
          code: 'DENIED',
          reason: 'Denied',
        },
      }),
    )
    const final = runtime.getSnapshot()
    let state = createEmptyRuntimeState()
    for (const event of final.events) {
      const changes = event.changes
      state = {
        ...state,
        connection: changes.connection ?? state.connection,
        agents: { ...state.agents, ...changes.agents },
        tasks: { ...state.tasks, ...changes.tasks },
        departments: { ...state.departments, ...changes.departments },
        toolExecutions: { ...state.toolExecutions, ...changes.toolExecutions },
      }
    }
    expect(state.toolExecutions).toEqual(final.toolExecutions)
    expect(state.agents).toEqual(final.agents)
    expect(state.tasks).toEqual(final.tasks)
    expect(Object.isFrozen(final.events.at(-2)?.changes.toolExecutions)).toBe(
      true,
    )
    const restored = createOfficeRuntime({
      repository: createInMemoryOfficeRuntimeRepository(final),
    })
    expect(restored.getSnapshot().toolExecutions).toEqual(final.toolExecutions)
  })

  it('restores a pre-tool snapshot with an empty execution registry', () => {
    const old = {
      ...work(seed()).getSnapshot(),
      toolExecutions: undefined,
    } as unknown as RuntimeState
    const runtime = createOfficeRuntime({
      repository: { read: () => old as RuntimeState, write: () => {} },
    })
    expect(runtime.getSnapshot().toolExecutions).toEqual({})
    send(runtime, request())
    expect(runtime.getSnapshot().toolExecutions.execution.status).toBe('queued')
  })

  it('propagates tool timeout to the existing Manager monitor without completing the request or creating task output', () => {
    const runtime = seed()
    acceptPlan(runtime)
    const manager = new ManagerOrchestrator({
      runtime,
      managerId: 'manager',
      planner: {
        plan: async () => {
          throw new Error('Not used')
        },
      },
    })
    manager.start()
    running(runtime)
    send(runtime, {
      type: 'failToolExecution',
      executionId: 'execution',
      error: { code: 'TIMEOUT', message: 'Execution exceeded its limit.' },
    })
    const state = runtime.getSnapshot()
    expect(state.plans.plan.status).toBe('needs_attention')
    expect(state.requests.request.status).toBe('blocked')
    expect(state.tasks.task).toMatchObject({
      status: 'blocked',
      progressPercent: 0,
      completedAt: null,
    })
    expect(state.agents.manager.status).toBe('working')
    expect(manager.getMetrics().monitorError).toBeNull()
    manager.dispose()
  })

  it('whole-request cancellation invalidates executing worker tools in the same commit', () => {
    const runtime = seed()
    acceptPlan(runtime)
    running(runtime)
    send(runtime, {
      type: 'cancelRequest',
      managerId: 'manager',
      requestId: 'request',
      reason: 'Operator cancelled the goal.',
    })
    const state = runtime.getSnapshot()
    expect(state.toolExecutions.execution.status).toBe('cancelled')
    expect(state.tasks.task.status).toBe('cancelled')
    expect(state.requests.request.status).toBe('cancelled')
    const events = state.events.filter(
      (event) => event.transactionRevision === state.revision,
    )
    expect(events.map((event) => event.type)).toContain('TOOL_CANCELLED')
    expect(events.map((event) => event.type)).toContain('REQUEST_CANCELLED')
    reject(
      runtime,
      { type: 'completeToolExecution', executionId: 'execution', output: null },
      'STALE_TOOL_EXECUTION',
    )
  })

  it.each(['queued', 'running'] as const)(
    'defers Manager coordination completion while its own tool is %s and resumes monitoring on the tool result',
    (status) => {
      const runtime = seed()
      acceptPlan(runtime)
      const manager = new ManagerOrchestrator({
        runtime,
        managerId: 'manager',
        planner: {
          plan: async () => {
            throw new Error('Not used')
          },
        },
      })
      manager.start()
      const taskId = runtime.getSnapshot().requests.request.coordinationTaskId!
      send(
        runtime,
        request({
          executionId: 'manager-tool',
          agentId: 'manager',
          taskId,
          toolId: 'research.fixture',
        }),
      )
      if (status === 'running')
        send(runtime, {
          type: 'startToolExecution',
          executionId: 'manager-tool',
        })
      send(runtime, { type: 'completeTask', taskId: 'task' })
      expect(runtime.getSnapshot().plans.plan.status).toBe('executing')
      expect(runtime.getSnapshot().tasks[taskId].status).toBe('in_progress')
      expect(manager.getMetrics().monitorError).toBeNull()
      if (status === 'queued')
        send(runtime, {
          type: 'startToolExecution',
          executionId: 'manager-tool',
        })
      send(runtime, {
        type: 'completeToolExecution',
        executionId: 'manager-tool',
        output: { mode: 'fixture' },
      })
      expect(runtime.getSnapshot().requests.request.status).toBe('completed')
      expect(runtime.getSnapshot().tasks[taskId].status).toBe('completed')
      expect(manager.getMetrics().monitorError).toBeNull()
      manager.dispose()
    },
  )
})
