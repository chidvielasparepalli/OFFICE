import { describe, expect, it, vi } from 'vitest'
import type {
  PlanProposal,
  RequestInput,
} from '../orchestration/orchestrationTypes'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from './officeRuntime'
import type {
  OfficeRuntimeRepository,
  RuntimeCommand,
  RuntimeState,
} from './runtimeTypes'

const now = () => '2026-10-09T12:00:00.000Z'
const request: RequestInput = {
  requestId: 'request',
  title: 'Build a feature',
  description: 'Explicit local request for planning and coordination.',
  requestedBy: 'local-user',
  priority: 'normal',
  constraints: ['No external calls'],
}

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.state
}
function reject(
  runtime: OfficeRuntime,
  command: RuntimeCommand,
  code?: string,
) {
  const before = runtime.getSnapshot()
  const result = runtime.dispatch(command)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected rejection')
  if (code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(before)
}

function seed(runtime = createOfficeRuntime({ now })) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'department', name: 'Engineering' },
  })
  const agents = [
    {
      id: 'manager',
      kind: 'manager',
      capabilities: ['coordinate'],
      managerId: null,
    },
    {
      id: 'other-manager',
      kind: 'manager',
      capabilities: ['coordinate'],
      managerId: null,
    },
    {
      id: 'worker-a',
      kind: 'standard-worker',
      capabilities: ['write'],
      managerId: 'manager',
    },
    {
      id: 'worker-b',
      kind: 'standard-worker',
      capabilities: ['review'],
      managerId: 'manager',
    },
    {
      id: 'other-worker',
      kind: 'standard-worker',
      capabilities: ['write'],
      managerId: 'other-manager',
    },
  ] as const
  for (const agent of agents)
    send(runtime, {
      type: 'registerAgent',
      agent: {
        ...agent,
        name: agent.id,
        role: agent.kind,
        departmentId: 'department',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  return runtime
}

function proposal(): PlanProposal {
  return {
    planId: 'plan',
    requestId: request.requestId,
    objective: 'Perform the requested two-step work.',
    constraints: [...request.constraints],
    expectedOutputs: [],
    tasks: [
      {
        id: 'review-task',
        title: 'Review',
        description: 'Review the supplied result.',
        status: 'queued',
        priority: 'normal',
        dependencyIds: ['write-task'],
        requiredCapabilities: ['review'],
        preferredAgentId: null,
      },
      {
        id: 'write-task',
        title: 'Write',
        description: 'Implement the requested change.',
        status: 'queued',
        priority: 'normal',
        dependencyIds: [],
        requiredCapabilities: ['write'],
        preferredAgentId: null,
      },
    ],
  }
}

function begin(runtime: OfficeRuntime) {
  send(runtime, { type: 'receiveRequest', managerId: 'manager', request })
  return send(runtime, {
    type: 'beginPlanning',
    managerId: 'manager',
    requestId: request.requestId,
  }).requests.request.planningAttemptId!
}
function accept(runtime: OfficeRuntime, input: PlanProposal = proposal()) {
  const attemptId = begin(runtime)
  return send(runtime, {
    type: 'acceptPlan',
    managerId: 'manager',
    requestId: request.requestId,
    attemptId,
    proposal: input,
  })
}
const sync = (runtime: OfficeRuntime) =>
  send(runtime, {
    type: 'synchronizePlan',
    managerId: 'manager',
    planId: 'plan',
  })
const dispatch = (
  runtime: OfficeRuntime,
  taskId = 'write-task',
  agentId = 'worker-a',
) =>
  send(runtime, {
    type: 'dispatchPlanTask',
    managerId: 'manager',
    planId: 'plan',
    taskId,
    agentId,
  })

describe('atomic request intake and planning', () => {
  it('stores request and real Manager coordination work without waking workers', () => {
    const runtime = seed()
    const listener = vi.fn()
    runtime.subscribe(listener)
    const attemptId = begin(runtime)
    const state = runtime.getSnapshot()
    const recorded = state.requests.request
    expect(recorded).toMatchObject({
      ...request,
      managerId: 'manager',
      status: 'planning',
      planningAttemptId: attemptId,
      planId: null,
    })
    expect(state.tasks[recorded.coordinationTaskId!]).toMatchObject({
      assignedAgentId: 'manager',
      status: 'in_progress',
      metadata: { requestId: 'request', coordination: true },
    })
    expect(state.agents.manager).toMatchObject({
      status: 'working',
      currentTaskId: recorded.coordinationTaskId,
    })
    expect(state.agents['worker-a'].status).toBe('sleeping')
    expect(listener).toHaveBeenCalledTimes(2)
    const events = state.events.filter(
      (event) => event.transactionRevision === state.revision,
    )
    expect(events.map((event) => event.type)).toEqual([
      'TASK_CREATED',
      'TASK_ASSIGNED',
      'AGENT_STARTED',
      'PLANNING_STARTED',
    ])
    expect(events.every((event) => event.transactionEventCount === 4)).toBe(
      true,
    )
  })

  it('validates request identity, Manager ownership and busy planning atomically', () => {
    const runtime = seed()
    reject(
      runtime,
      { type: 'receiveRequest', managerId: 'worker-a', request },
      'INVALID_MANAGER',
    )
    reject(
      runtime,
      {
        type: 'receiveRequest',
        managerId: 'manager',
        request: { ...request, requestedBy: '' },
      },
      'INVALID_INPUT',
    )
    send(runtime, { type: 'receiveRequest', managerId: 'manager', request })
    reject(
      runtime,
      { type: 'receiveRequest', managerId: 'manager', request },
      'DUPLICATE_ID',
    )
    reject(
      runtime,
      {
        type: 'beginPlanning',
        managerId: 'other-manager',
        requestId: 'request',
      },
      'INVALID_OWNERSHIP',
    )
    send(runtime, {
      type: 'beginPlanning',
      managerId: 'manager',
      requestId: 'request',
    })
    send(runtime, {
      type: 'receiveRequest',
      managerId: 'manager',
      request: { ...request, requestId: 'second' },
    })
    reject(
      runtime,
      { type: 'beginPlanning', managerId: 'manager', requestId: 'second' },
      'MANAGER_BUSY',
    )
  })

  it('commits the validated DAG topologically as canonical tasks in one transaction', () => {
    const runtime = seed()
    const attemptId = begin(runtime)
    const previous = runtime.getSnapshot()
    const listener = vi.fn()
    runtime.subscribe(listener)
    const state = send(runtime, {
      type: 'acceptPlan',
      managerId: 'manager',
      requestId: 'request',
      attemptId,
      proposal: proposal(),
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(state.plans.plan.taskIds).toEqual(['write-task', 'review-task'])
    expect(state.plans.plan.taskIds).not.toContain(
      state.requests.request.coordinationTaskId,
    )
    expect(state.tasks['write-task']).toMatchObject({
      status: 'queued',
      assignedAgentId: null,
      metadata: { requestId: 'request', planId: 'plan' },
    })
    expect(state.tasks['review-task']).toMatchObject({
      status: 'waiting',
      dependencyIds: ['write-task'],
      waitingForDependencies: true,
    })
    expect(state.requests.request).toMatchObject({
      status: 'planned',
      planningAttemptId: null,
      planId: 'plan',
    })
    expect(state.tasks[state.requests.request.coordinationTaskId!].status).toBe(
      'in_progress',
    )
    expect(
      state.events.slice(previous.events.length).map((event) => event.type),
    ).toEqual(['TASK_CREATED', 'TASK_CREATED', 'PLAN_ACCEPTED'])
    expect(state.agents['worker-a']).toBe(previous.agents['worker-a'])
    expect(
      Object.isFrozen(state.plans.plan.requirements['write-task'].capabilities),
    ).toBe(true)
  })

  it('rejects malformed plans without partial tasks, then explicitly records planning failure', () => {
    const runtime = seed()
    const attemptId = begin(runtime)
    reject(
      runtime,
      {
        type: 'acceptPlan',
        managerId: 'manager',
        requestId: 'request',
        attemptId,
        proposal: {
          ...proposal(),
          tasks: [...proposal().tasks, proposal().tasks[0]],
        },
      },
      'PLAN_ID_COLLISION',
    )
    expect(Object.keys(runtime.getSnapshot().tasks)).toHaveLength(1)
    expect(runtime.getSnapshot().plans).toEqual({})
    send(runtime, {
      type: 'rejectPlan',
      managerId: 'manager',
      requestId: 'request',
      attemptId,
      reason: 'Duplicate task ID from planner',
    })
    const state = runtime.getSnapshot()
    expect(state.requests.request).toMatchObject({
      status: 'failed',
      planningAttemptId: null,
      issues: [
        { code: 'PLAN_REJECTED', message: 'Duplicate task ID from planner' },
      ],
    })
    expect(state.tasks[state.requests.request.coordinationTaskId!].status).toBe(
      'failed',
    )
    expect(state.agents.manager.status).toBe('blocked')
  })

  it('rolls back the entire plan when the repository cannot commit it', () => {
    let stored: RuntimeState | null = null
    let failWrites = false
    const repository: OfficeRuntimeRepository = {
      read: () => stored,
      write: (state) => {
        if (failWrites) throw new Error('Rejected write')
        stored = state
      },
    }
    const runtime = seed(createOfficeRuntime({ now, repository }))
    const attemptId = begin(runtime)
    const before = runtime.getSnapshot()
    const listener = vi.fn()
    runtime.subscribe(listener)
    failWrites = true
    reject(
      runtime,
      {
        type: 'acceptPlan',
        managerId: 'manager',
        requestId: 'request',
        attemptId,
        proposal: proposal(),
      },
      'REPOSITORY_ERROR',
    )
    expect(stored).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(runtime.getSnapshot().requests.request.status).toBe('planning')
    failWrites = false
    send(runtime, {
      type: 'acceptPlan',
      managerId: 'manager',
      requestId: 'request',
      attemptId,
      proposal: proposal(),
    })
    expect(runtime.getSnapshot().plans.plan.taskIds).toHaveLength(2)
  })

  it('invalidates a pending attempt on disconnect and allows only a fresh retry after reconnect', () => {
    const runtime = seed()
    const oldAttempt = begin(runtime)
    const oldCoordination =
      runtime.getSnapshot().requests.request.coordinationTaskId!
    send(runtime, { type: 'disconnect' })
    expect(runtime.getSnapshot().requests.request).toMatchObject({
      status: 'blocked',
      planningAttemptId: null,
      issues: [{ code: 'CONNECTION_LOST' }],
    })
    expect(runtime.getSnapshot().tasks[oldCoordination].status).toBe(
      'cancelled',
    )
    reject(
      runtime,
      {
        type: 'acceptPlan',
        managerId: 'manager',
        requestId: 'request',
        attemptId: oldAttempt,
        proposal: proposal(),
      },
      'DISCONNECTED',
    )
    send(runtime, { type: 'connect' })
    const retry = send(runtime, {
      type: 'beginPlanning',
      managerId: 'manager',
      requestId: 'request',
    })
    const newAttempt = retry.requests.request.planningAttemptId!
    expect(newAttempt).not.toBe(oldAttempt)
    reject(
      runtime,
      {
        type: 'acceptPlan',
        managerId: 'manager',
        requestId: 'request',
        attemptId: oldAttempt,
        proposal: proposal(),
      },
      'STALE_PLANNING_ATTEMPT',
    )
    send(runtime, {
      type: 'acceptPlan',
      managerId: 'manager',
      requestId: 'request',
      attemptId: newAttempt,
      proposal: proposal(),
    })
  })

  it('rejects a late proposal after explicit request cancellation', () => {
    const runtime = seed()
    const attemptId = begin(runtime)
    send(runtime, {
      type: 'cancelRequest',
      managerId: 'manager',
      requestId: 'request',
      reason: 'User cancelled while planning',
    })
    reject(
      runtime,
      {
        type: 'acceptPlan',
        managerId: 'manager',
        requestId: 'request',
        attemptId,
        proposal: proposal(),
      },
      'STALE_PLANNING_ATTEMPT',
    )
    expect(runtime.getSnapshot().requests.request.status).toBe('cancelled')
    expect(runtime.getSnapshot().plans).toEqual({})
  })

  it('keeps one active accepted request per Manager even when its coordination task is cancelled', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'cancelTask',
      taskId: runtime.getSnapshot().requests.request.coordinationTaskId!,
    })
    sync(runtime)
    send(runtime, {
      type: 'receiveRequest',
      managerId: 'manager',
      request: { ...request, requestId: 'second' },
    })
    reject(
      runtime,
      { type: 'beginPlanning', managerId: 'manager', requestId: 'second' },
      'MANAGER_BUSY',
    )
    send(runtime, {
      type: 'cancelRequest',
      managerId: 'manager',
      requestId: 'request',
      reason: 'Close the prior owned request explicitly',
    })
    send(runtime, {
      type: 'beginPlanning',
      managerId: 'manager',
      requestId: 'second',
    })
    expect(runtime.getSnapshot().requests.second.status).toBe('planning')
  })
})

describe('controlled delegation and monitoring', () => {
  it('requires readiness, exact capabilities and ownership before atomic assignment/start', () => {
    const runtime = seed()
    accept(runtime)
    reject(
      runtime,
      {
        type: 'dispatchPlanTask',
        managerId: 'manager',
        planId: 'plan',
        taskId: 'review-task',
        agentId: 'worker-b',
      },
      'TASK_NOT_READY',
    )
    for (const agentId of ['worker-b', 'other-worker', 'manager'])
      reject(
        runtime,
        {
          type: 'dispatchPlanTask',
          managerId: 'manager',
          planId: 'plan',
          taskId: 'write-task',
          agentId,
        },
        'INVALID_ASSIGNMENT',
      )
    const previous = runtime.getSnapshot()
    const listener = vi.fn()
    runtime.subscribe(listener)
    const state = dispatch(runtime)
    expect(listener).toHaveBeenCalledOnce()
    expect(state.tasks['write-task']).toMatchObject({
      status: 'in_progress',
      assignedAgentId: 'worker-a',
    })
    expect(state.agents['worker-a']).toMatchObject({
      status: 'working',
      currentTaskId: 'write-task',
    })
    expect(state.requests.request.status).toBe('executing')
    expect(
      state.events.slice(previous.events.length).map((event) => event.type),
    ).toEqual([
      'TASK_ASSIGNED',
      'AGENT_STARTED',
      'PLAN_DISPATCHED',
      'PLAN_STATUS_CHANGED',
    ])
  })

  it('retains a queue and structured availability issue while the capable worker is busy', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'createTask',
      task: { id: 'other-work', title: 'Existing work' },
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'other-work',
      agentId: 'worker-a',
    })
    send(runtime, { type: 'startTask', taskId: 'other-work' })
    reject(
      runtime,
      {
        type: 'dispatchPlanTask',
        managerId: 'manager',
        planId: 'plan',
        taskId: 'write-task',
        agentId: 'worker-a',
      },
      'AGENT_UNAVAILABLE',
    )
    send(runtime, {
      type: 'recordDispatchIssue',
      managerId: 'manager',
      planId: 'plan',
      issue: {
        code: 'AGENT_UNAVAILABLE',
        message: 'Matching worker is busy.',
        taskId: 'write-task',
        agentId: 'worker-a',
      },
    })
    expect(runtime.getSnapshot().plans.plan.status).toBe('needs_attention')
    expect(runtime.getSnapshot().tasks['write-task']).toMatchObject({
      status: 'queued',
      assignedAgentId: null,
    })
    send(runtime, { type: 'completeTask', taskId: 'other-work' })
    const ready = sync(runtime)
    expect(ready.plans.plan).toMatchObject({ status: 'planned', issues: [] })
    expect(ready.tasks['write-task'].status).toBe('queued')
  })

  it('does not emit from a no-op sync or dispatch automatically when dependencies release', () => {
    const runtime = seed()
    accept(runtime)
    const planned = runtime.getSnapshot()
    sync(runtime)
    expect(runtime.getSnapshot()).toBe(planned)
    dispatch(runtime)
    send(runtime, { type: 'completeTask', taskId: 'write-task' })
    sync(runtime)
    const state = runtime.getSnapshot()
    expect(state.tasks['review-task']).toMatchObject({
      status: 'queued',
      assignedAgentId: null,
      startedAt: null,
    })
    expect(state.agents['worker-b'].status).toBe('sleeping')
    const commits = runtime.getMetrics().commits
    sync(runtime)
    expect(runtime.getMetrics().commits).toBe(commits)
  })

  it('completes request and coordination only after every canonical body task completes', () => {
    const runtime = seed()
    accept(runtime)
    dispatch(runtime)
    send(runtime, { type: 'completeTask', taskId: 'write-task' })
    sync(runtime)
    expect(runtime.getSnapshot().requests.request.status).toBe('executing')
    dispatch(runtime, 'review-task', 'worker-b')
    send(runtime, {
      type: 'updateProgress',
      taskId: 'review-task',
      progressPercent: 100,
    })
    sync(runtime)
    expect(runtime.getSnapshot().requests.request.status).toBe('executing')
    send(runtime, { type: 'completeTask', taskId: 'review-task' })
    const before = runtime.getSnapshot()
    const complete = sync(runtime)
    expect(complete.requests.request.status).toBe('completed')
    expect(complete.plans.plan.status).toBe('completed')
    expect(
      complete.tasks[complete.requests.request.coordinationTaskId!].status,
    ).toBe('completed')
    expect(complete.agents.manager.status).toBe('completed')
    expect(
      complete.events.slice(before.events.length).map((event) => event.type),
    ).toEqual(['TASK_COMPLETED', 'PLAN_STATUS_CHANGED'])
    expect(complete.plans.plan.expectedOutputs).toEqual([])
    sync(runtime)
    expect(runtime.getSnapshot()).toBe(complete)
  })

  it.each(['blockTask', 'waitTask', 'failTask', 'cancelTask'] as const)(
    '%s produces attention from actual task state without fake completion',
    (type) => {
      const runtime = seed()
      accept(runtime)
      dispatch(runtime)
      send(runtime, {
        type,
        taskId: 'write-task',
        reason: 'Explicit intervention',
      })
      const state = sync(runtime)
      expect(state.plans.plan.status).toBe('needs_attention')
      expect(state.requests.request.status).toBe('blocked')
      expect(
        state.plans.plan.issues.some((issue) => issue.taskId === 'write-task'),
      ).toBe(true)
      expect(
        state.tasks[state.requests.request.coordinationTaskId!].status,
      ).toBe('in_progress')
      expect(state.tasks['write-task'].completedAt).toBeNull()
    },
  )

  it('preserves manual holds during generic assignment and requires explicit start to resume', () => {
    const runtime = seed()
    for (const type of ['blockTask', 'waitTask'] as const) {
      const taskId = type
      send(runtime, { type: 'createTask', task: { id: taskId, title: taskId } })
      send(runtime, { type, taskId, reason: 'Manual approval required' })
      send(runtime, { type: 'assignTask', taskId, agentId: 'worker-a' })
      expect(runtime.getSnapshot().tasks[taskId]).toMatchObject({
        status: type === 'blockTask' ? 'blocked' : 'waiting',
        statusReason: 'Manual approval required',
        waitingForDependencies: false,
      })
      expect(runtime.getSnapshot().agents['worker-a']).toMatchObject({
        status: type === 'blockTask' ? 'blocked' : 'waiting',
        blockers: ['Manual approval required'],
      })
      send(runtime, { type: 'startTask', taskId })
      expect(runtime.getSnapshot().tasks[taskId].status).toBe('in_progress')
      send(runtime, { type: 'completeTask', taskId })
    }
  })

  it.each(['worker-b', 'other-worker', 'manager'])(
    'flags direct generic assignment to invalid worker %s',
    (agentId) => {
      const runtime = seed()
      accept(runtime)
      if (agentId === 'manager')
        send(runtime, {
          type: 'cancelTask',
          taskId: runtime.getSnapshot().requests.request.coordinationTaskId!,
        })
      send(runtime, { type: 'assignTask', taskId: 'write-task', agentId })
      const state = sync(runtime)
      expect(state.plans.plan.status).toBe('needs_attention')
      expect(
        state.plans.plan.issues.some(
          (issue) =>
            issue.code === 'INVALID_ASSIGNMENT' &&
            issue.taskId === 'write-task',
        ),
      ).toBe(true)
      expect(state.tasks['write-task'].assignedAgentId).toBe(agentId)
    },
  )

  it('flags external dependencies added through the generic task API without repairing them', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'createTask',
      task: { id: 'external-task', title: 'Another request or manual task' },
    })
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'write-task',
      dependencyIds: ['external-task'],
    })
    const state = sync(runtime)
    expect(state.plans.plan.status).toBe('needs_attention')
    expect(
      state.plans.plan.issues.some(
        (issue) => issue.code === 'INVALID_DEPENDENCY',
      ),
    ).toBe(true)
    expect(state.tasks['write-task'].dependencyIds).toEqual(['external-task'])
  })

  it('cannot bypass controlled dispatch using a completed dependency outside the accepted plan', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'createTask',
      task: { id: 'external-done', title: 'External task' },
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'external-done',
      agentId: 'worker-a',
    })
    send(runtime, { type: 'startTask', taskId: 'external-done' })
    send(runtime, { type: 'completeTask', taskId: 'external-done' })
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'write-task',
      dependencyIds: ['external-done'],
    })
    reject(
      runtime,
      {
        type: 'dispatchPlanTask',
        managerId: 'manager',
        planId: 'plan',
        taskId: 'write-task',
        agentId: 'worker-a',
      },
      'INVALID_DEPENDENCY',
    )
  })

  it('cannot convert completion by an incapable worker into overall plan success', () => {
    const runtime = seed()
    const input = proposal()
    accept(runtime, { ...input, tasks: [input.tasks[1]] })
    send(runtime, {
      type: 'assignTask',
      taskId: 'write-task',
      agentId: 'worker-b',
    })
    send(runtime, { type: 'startTask', taskId: 'write-task' })
    send(runtime, { type: 'completeTask', taskId: 'write-task' })
    const state = sync(runtime)
    expect(state.plans.plan.status).toBe('needs_attention')
    expect(
      state.plans.plan.issues.some(
        (issue) => issue.code === 'INVALID_ASSIGNMENT',
      ),
    ).toBe(true)
    expect(state.tasks[state.requests.request.coordinationTaskId!].status).toBe(
      'in_progress',
    )
  })

  it('records an explicit dispatch rejection even when its code also describes derived task issues', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'recordDispatchIssue',
      managerId: 'manager',
      planId: 'plan',
      issue: {
        code: 'INVALID_ASSIGNMENT',
        message: 'Requested worker did not match.',
        taskId: 'write-task',
        agentId: 'worker-b',
      },
    })
    expect(runtime.getSnapshot().plans.plan.issues).toContainEqual({
      code: 'INVALID_ASSIGNMENT',
      message: 'Requested worker did not match.',
      taskId: 'write-task',
      agentId: 'worker-b',
    })
    expect(runtime.getSnapshot().events.at(-1)?.type).toBe(
      'PLAN_STATUS_CHANGED',
    )
  })

  it('will not dispatch or report completion while the Manager coordination is unavailable', () => {
    const runtime = seed()
    const oneTask = proposal()
    accept(runtime, { ...oneTask, tasks: [oneTask.tasks[1]] })
    dispatch(runtime)
    const coordinationId =
      runtime.getSnapshot().requests.request.coordinationTaskId!
    send(runtime, {
      type: 'blockTask',
      taskId: coordinationId,
      reason: 'Manager approval blocked',
    })
    send(runtime, {
      type: 'beginRepair',
      agentId: 'manager',
      reason: 'Manager repair pending',
    })
    send(runtime, { type: 'completeTask', taskId: 'write-task' })
    const state = sync(runtime)
    expect(state.plans.plan).toMatchObject({
      status: 'needs_attention',
      issues: [{ code: 'COORDINATION_UNAVAILABLE' }],
    })
    expect(state.requests.request.status).toBe('blocked')
    expect(state.agents.manager.status).toBe('repair')
    send(runtime, {
      type: 'repairAgent',
      agentId: 'manager',
      reason: 'Acknowledged',
    })
    send(runtime, { type: 'startTask', taskId: coordinationId })
    expect(sync(runtime).plans.plan.status).toBe('completed')
  })

  it('rejects dispatch after coordination is cancelled, even if a worker is available', () => {
    const runtime = seed()
    accept(runtime)
    send(runtime, {
      type: 'cancelTask',
      taskId: runtime.getSnapshot().requests.request.coordinationTaskId!,
    })
    reject(
      runtime,
      {
        type: 'dispatchPlanTask',
        managerId: 'manager',
        planId: 'plan',
        taskId: 'write-task',
        agentId: 'worker-a',
      },
      'MANAGER_UNAVAILABLE',
    )
    expect(sync(runtime).plans.plan.status).toBe('needs_attention')
  })

  it('cancels owned nonterminal body and coordination tasks atomically while preserving unrelated work', () => {
    const runtime = seed()
    accept(runtime)
    dispatch(runtime)
    send(runtime, {
      type: 'createTask',
      task: { id: 'unrelated', title: 'Unrelated task' },
    })
    const unrelated = runtime.getSnapshot().tasks.unrelated
    const listener = vi.fn()
    runtime.subscribe(listener)
    const state = send(runtime, {
      type: 'cancelRequest',
      managerId: 'manager',
      requestId: 'request',
      reason: 'User stopped request',
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(state.requests.request.status).toBe('cancelled')
    expect(state.plans.plan.status).toBe('cancelled')
    for (const id of [
      ...state.plans.plan.taskIds,
      state.requests.request.coordinationTaskId!,
    ])
      expect(state.tasks[id].status).toBe('cancelled')
    expect(state.tasks.unrelated).toBe(unrelated)
    expect(state.agents['worker-a'].status).toBe('waiting')
    expect(state.agents.manager.status).toBe('waiting')
  })
})

describe('repository and event compatibility', () => {
  it('adds empty normalized maps when loading an older trusted Phase 5 snapshot', () => {
    const state = seed().getSnapshot()
    const { requests: _requests, plans: _plans, ...older } = state
    const repository = { read: () => older as RuntimeState, write: () => {} }
    const runtime = createOfficeRuntime({ now, repository })
    expect(runtime.getSnapshot().requests).toEqual({})
    expect(runtime.getSnapshot().plans).toEqual({})
    expect(runtime.getSnapshot().agents).toEqual(state.agents)
  })

  it('reconstructs requests, plans and canonical tasks from committed after-images', () => {
    const runtime = seed()
    accept(runtime)
    dispatch(runtime)
    send(runtime, { type: 'completeTask', taskId: 'write-task' })
    sync(runtime)
    send(runtime, {
      type: 'cancelRequest',
      managerId: 'manager',
      requestId: 'request',
      reason: 'Stop remaining work',
    })
    const state = runtime.getSnapshot()
    let requests: RuntimeState['requests'] = {},
      plans: RuntimeState['plans'] = {},
      tasks: RuntimeState['tasks'] = {},
      agents: RuntimeState['agents'] = {}
    for (const event of state.events) {
      requests = { ...requests, ...event.changes.requests }
      plans = { ...plans, ...event.changes.plans }
      tasks = { ...tasks, ...event.changes.tasks }
      agents = { ...agents, ...event.changes.agents }
    }
    expect({ requests, plans, tasks, agents }).toEqual({
      requests: state.requests,
      plans: state.plans,
      tasks: state.tasks,
      agents: state.agents,
    })
    const accepted = state.events.find(
      (event) => event.type === 'PLAN_ACCEPTED',
    )!
    expect(accepted.changes.plans?.plan.status).toBe('planned')
    expect(accepted.changes.requests?.request.planningAttemptId).toBeNull()
    expect(Object.isFrozen(accepted.changes.plans?.plan.taskIds)).toBe(true)
  })

  it('flags a restored assigned worker whose current-task link no longer agrees', () => {
    const source = seed()
    accept(source)
    dispatch(source)
    const state = source.getSnapshot()
    const runtime = createOfficeRuntime({
      now,
      repository: createInMemoryOfficeRuntimeRepository({
        ...state,
        agents: {
          ...state.agents,
          'worker-a': { ...state.agents['worker-a'], currentTaskId: null },
        },
      }),
    })
    expect(
      sync(runtime).plans.plan.issues.some(
        (issue) => issue.code === 'INVALID_ASSIGNMENT',
      ),
    ).toBe(true)
  })
})
