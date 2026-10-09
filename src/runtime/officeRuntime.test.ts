import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from './officeRuntime'
import type {
  OfficeRuntimeRepository,
  RuntimeCommand,
  RuntimeEvent,
  RuntimeJson,
  RuntimeState,
} from './runtimeTypes'

const NOW = '2026-10-09T10:00:00.000Z'

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
  if (result.ok) throw new Error('Expected command rejection')
  if (code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(before)
  return result.error
}

function seed(runtime = createOfficeRuntime({ now: () => NOW })) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'engineering', name: 'Engineering' },
  })
  for (const [id, x] of [
    ['desk-a', -3],
    ['desk-b', 0],
    ['desk-manager', 3],
  ] as const) {
    send(runtime, {
      type: 'registerWorkstation',
      workstation: {
        id,
        departmentId: 'engineering',
        position: [x, 0, 0],
        headingRadians: 0,
      },
    })
  }
  for (const [id, desk, kind] of [
    ['manager', 'desk-manager', 'manager'],
    ['a', 'desk-a', 'standard-worker'],
    ['b', 'desk-b', 'standard-worker'],
  ] as const) {
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        name: `Agent ${id}`,
        role: kind === 'manager' ? 'Manager' : 'Engineer',
        kind,
        departmentId: 'engineering',
        capabilities: ['review'],
        workstationId: desk,
        managerId: kind === 'manager' ? null : 'manager',
        position: [0, 0, 2],
        headingRadians: 0,
        status: 'sleeping',
      },
    })
  }
  return runtime
}

function createTask(
  runtime: OfficeRuntime,
  id = 'task-a',
  dependencies: readonly string[] = [],
) {
  return send(runtime, {
    type: 'createTask',
    task: { id, title: `Task ${id}`, dependencyIds: dependencies },
  })
}

function start(runtime: OfficeRuntime, taskId = 'task-a', agentId = 'a') {
  createTask(runtime, taskId)
  send(runtime, { type: 'assignTask', taskId, agentId })
  return send(runtime, { type: 'startTask', taskId })
}

describe('local runtime lifecycle and atomic external store', () => {
  it('starts empty and disconnected with stable immutable snapshots and bound methods', () => {
    const runtime = createOfficeRuntime({ now: () => NOW })
    const { getSnapshot, subscribe, dispatch, getMetrics } = runtime
    const initial = getSnapshot()
    expect(initial).toMatchObject({
      connection: 'disconnected',
      revision: 0,
      agents: {},
      tasks: {},
      events: [],
      activities: [],
      selectedAgentId: null,
      selectedTaskId: null,
    })
    expect(getSnapshot()).toBe(initial)
    expect(Object.isFrozen(initial.agents)).toBe(true)
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    expect(dispatch({ type: 'connect' }).ok).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getMetrics()).toMatchObject({
      commands: 1,
      commits: 1,
      notifications: 1,
      subscribers: 1,
    })
    unsubscribe()
    dispatch({ type: 'disconnect' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getMetrics().subscribers).toBe(0)
  })

  it('retains records while disconnected, rejects mutations, and does not reseed on reconnect', () => {
    const runtime = seed()
    createTask(runtime)
    const before = runtime.getSnapshot()
    send(runtime, { type: 'disconnect' })
    expect(runtime.getSnapshot().agents).toBe(before.agents)
    expect(runtime.getSnapshot().tasks).toBe(before.tasks)
    reject(runtime, { type: 'startTask', taskId: 'task-a' }, 'DISCONNECTED')
    send(runtime, { type: 'connect' })
    expect(runtime.getSnapshot().agents).toBe(before.agents)
    expect(Object.keys(runtime.getSnapshot().agents)).toHaveLength(3)
  })

  it('does not commit or notify for repeated connection, selection, or identical progress', () => {
    const runtime = seed()
    start(runtime)
    const listener = vi.fn()
    runtime.subscribe(listener)
    const before = runtime.getSnapshot()
    send(runtime, { type: 'connect' })
    send(runtime, { type: 'selectAgent', agentId: null })
    send(runtime, { type: 'selectTask', taskId: null })
    send(runtime, {
      type: 'updateProgress',
      taskId: 'task-a',
      progressPercent: 0,
    })
    expect(runtime.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('isolates listener failures and leaves committed data coherent', () => {
    const runtime = createOfficeRuntime({ now: () => NOW })
    runtime.subscribe(() => {
      throw new Error('View failed')
    })
    const other = vi.fn()
    runtime.subscribe(other)
    expect(runtime.dispatch({ type: 'connect' }).ok).toBe(true)
    expect(runtime.getSnapshot().connection).toBe('local')
    expect(other).toHaveBeenCalledOnce()
    expect(runtime.getMetrics().notifications).toBe(2)
  })

  it('rolls back state, events, activities and notifications when repository commit fails', () => {
    let persisted: RuntimeState | null = null
    let rejectWrites = false
    const repository: OfficeRuntimeRepository = {
      read: () => persisted,
      write: (state) => {
        if (rejectWrites) throw new Error('Disk unavailable')
        persisted = state
      },
    }
    const runtime = seed(createOfficeRuntime({ repository, now: () => NOW }))
    const before = runtime.getSnapshot()
    const listener = vi.fn()
    runtime.subscribe(listener)
    rejectWrites = true
    reject(
      runtime,
      {
        type: 'createTask',
        task: { id: 'failure', title: 'Rejected transaction' },
      },
      'REPOSITORY_ERROR',
    )
    expect(persisted).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    rejectWrites = false
    createTask(runtime)
    expect(runtime.getSnapshot().tasks['task-a']).toBeDefined()
    expect(runtime.getSnapshot().tasks.failure).toBeUndefined()
  })

  it('rehydrates a repository without inventing activity and continues unique deterministic IDs', () => {
    const repository = createInMemoryOfficeRuntimeRepository()
    const first = seed(createOfficeRuntime({ repository, now: () => NOW }))
    start(first)
    const before = first.getSnapshot()
    const next = createOfficeRuntime({ repository, now: () => NOW })
    expect(next.getSnapshot()).toEqual(before)
    send(next, {
      type: 'updateProgress',
      taskId: 'task-a',
      progressPercent: 40,
    })
    const ids = next.getSnapshot().events.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(first.getSnapshot()).toBe(before)
  })

  it('uses injected clock and IDs consistently across an atomic event/activity pair', () => {
    let sequence = 0
    const runtime = createOfficeRuntime({
      now: () => NOW,
      nextId: (scope) => `test-${scope}-${++sequence}`,
    })
    const state = send(runtime, { type: 'connect' })
    expect(state.events[0]).toMatchObject({
      id: 'test-event-1',
      type: 'RUNTIME_CONNECTED',
      occurredAt: NOW,
    })
    expect(state.activities[0]).toMatchObject({
      id: 'activity:test-event-1',
      eventId: 'test-event-1',
      occurredAt: NOW,
    })
  })

  it('rejects duplicate generated IDs and invalid timestamps without partial commit', () => {
    const runtime = createOfficeRuntime({
      now: () => NOW,
      nextId: () => 'fixed-id',
    })
    send(runtime, { type: 'connect' })
    reject(runtime, { type: 'disconnect' }, 'DUPLICATE_ID')
    const invalidClock = createOfficeRuntime({ now: () => 'not-a-date' })
    reject(invalidClock, { type: 'connect' }, 'INVALID_CLOCK')
  })

  it('copies inputs, deeply freezes output, and preserves unrelated entity references', () => {
    const runtime = seed()
    const metadata = { nested: { tags: ['manual'] }, enabled: true }
    send(runtime, {
      type: 'createTask',
      task: { id: 'task-a', title: 'Immutable', metadata },
    })
    metadata.nested.tags[0] = 'mutated'
    expect(runtime.getSnapshot().tasks['task-a'].metadata).toEqual({
      nested: { tags: ['manual'] },
      enabled: true,
    })
    const before = runtime.getSnapshot()
    send(runtime, { type: 'assignTask', taskId: 'task-a', agentId: 'a' })
    const after = runtime.getSnapshot()
    expect(after.agents.a).not.toBe(before.agents.a)
    expect(after.agents.b).toBe(before.agents.b)
    expect(after.workstations).toBe(before.workstations)
    expect(after.departments).toBe(before.departments)
    expect(Object.isFrozen(after.agents.a.position)).toBe(true)
    expect(Object.isFrozen(after.tasks['task-a'].metadata.nested)).toBe(true)
    expect(() => {
      ;(after.agents.a.position as unknown as number[])[0] = 99
    }).toThrow()
    expect(before.tasks['task-a'].status).toBe('queued')
  })

  it('selects existing entities without fabricating business events or task activity', () => {
    const runtime = seed()
    createTask(runtime)
    const before = runtime.getSnapshot()
    send(runtime, { type: 'selectAgent', agentId: 'manager' })
    send(runtime, { type: 'selectTask', taskId: 'task-a' })
    const selected = runtime.getSnapshot()
    expect(selected.selectedAgentId).toBe('manager')
    expect(selected.selectedTaskId).toBe('task-a')
    expect(selected.events).toBe(before.events)
    expect(selected.activities).toBe(before.activities)
    expect(selected.agents).toBe(before.agents)
    reject(runtime, { type: 'selectAgent', agentId: 'missing' }, 'NOT_FOUND')
    reject(runtime, { type: 'selectTask', taskId: 'missing' }, 'NOT_FOUND')
    send(runtime, { type: 'selectAgent', agentId: null })
    expect(runtime.getSnapshot().selectedTaskId).toBe('task-a')
  })
})

describe('task lifecycle', () => {
  it('requires explicit assignment/start/progress/completion and keeps completed context', () => {
    const runtime = seed()
    createTask(runtime)
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('queued')
    reject(runtime, { type: 'startTask', taskId: 'task-a' }, 'UNASSIGNED_TASK')
    send(runtime, { type: 'assignTask', taskId: 'task-a', agentId: 'a' })
    expect(runtime.getSnapshot().agents.a.status).toBe('queued')
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('assigned')
    send(runtime, { type: 'startTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'working',
      destination: {
        destinationType: 'workstation',
        destinationId: 'desk-a',
        arrivalStatus: 'working',
      },
    })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'in_progress',
      startedAt: NOW,
    })
    send(runtime, {
      type: 'updateProgress',
      taskId: 'task-a',
      progressPercent: 100,
    })
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('in_progress')
    send(runtime, { type: 'completeTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'completed',
      progressPercent: 100,
      completedAt: NOW,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'completed',
      currentTaskId: 'task-a',
      destination: null,
    })
    createTask(runtime, 'task-next')
    send(runtime, { type: 'assignTask', taskId: 'task-next', agentId: 'a' })
    expect(runtime.getSnapshot().agents.a.currentTaskId).toBe('task-next')
    expect(runtime.getSnapshot().tasks['task-a'].assignedAgentId).toBe('a')
  })

  it('enforces one current nonterminal task and no silent reassignment', () => {
    const runtime = seed()
    start(runtime)
    createTask(runtime, 'task-b')
    reject(
      runtime,
      { type: 'assignTask', taskId: 'task-b', agentId: 'a' },
      'AGENT_BUSY',
    )
    reject(
      runtime,
      { type: 'assignTask', taskId: 'task-a', agentId: 'b' },
      'INVALID_ASSIGNMENT',
    )
    expect(runtime.getSnapshot().agents.b.currentTaskId).toBeNull()
    expect(runtime.getSnapshot().tasks['task-b'].assignedAgentId).toBeNull()
  })

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid progress %s atomically',
    (progressPercent) => {
      const runtime = seed()
      start(runtime)
      reject(
        runtime,
        { type: 'updateProgress', taskId: 'task-a', progressPercent },
        'INVALID_PROGRESS',
      )
    },
  )

  it('rejects progress/completion before start and every attempted resurrection of a terminal task', () => {
    const runtime = seed()
    createTask(runtime)
    reject(
      runtime,
      { type: 'completeTask', taskId: 'task-a' },
      'INVALID_TRANSITION',
    )
    reject(
      runtime,
      { type: 'updateProgress', taskId: 'task-a', progressPercent: 10 },
      'INVALID_TRANSITION',
    )
    send(runtime, { type: 'cancelTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'cancelled',
      cancelledAt: NOW,
    })
    for (const command of [
      { type: 'startTask', taskId: 'task-a' },
      { type: 'assignTask', taskId: 'task-a', agentId: 'a' },
      { type: 'completeTask', taskId: 'task-a' },
      { type: 'blockTask', taskId: 'task-a', reason: 'No resurrection' },
      { type: 'failTask', taskId: 'task-a', reason: 'No resurrection' },
      { type: 'cancelTask', taskId: 'task-a' },
    ] satisfies RuntimeCommand[])
      reject(runtime, command, 'INVALID_TRANSITION')
  })

  it('records failure truthfully and never converts failed work into success during repair', () => {
    const runtime = seed()
    start(runtime)
    send(runtime, {
      type: 'updateProgress',
      taskId: 'task-a',
      progressPercent: 25,
    })
    send(runtime, {
      type: 'failTask',
      taskId: 'task-a',
      reason: 'Manual validation failed',
    })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'failed',
      progressPercent: 25,
      failedAt: NOW,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'blocked',
      blockers: ['Manual validation failed'],
      currentTaskId: 'task-a',
      destination: null,
    })
    send(runtime, {
      type: 'repairAgent',
      agentId: 'a',
      reason: 'Failure inspected',
    })
    expect(runtime.getSnapshot().agents.a.status).toBe('waiting')
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('failed')
  })

  it('distinguishes blocking, repair entry, acknowledged recovery and explicit restart', () => {
    const runtime = seed()
    start(runtime)
    const initialIntent = runtime.getSnapshot().agents.a.destination
    send(runtime, {
      type: 'blockTask',
      taskId: 'task-a',
      reason: 'Needs inspection',
    })
    expect(runtime.getSnapshot().agents.a.destination).toBe(initialIntent)
    send(runtime, {
      type: 'beginRepair',
      agentId: 'a',
      reason: 'Inspecting the issue',
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'repair',
      destination: initialIntent,
    })
    reject(
      runtime,
      { type: 'startTask', taskId: 'task-a' },
      'INVALID_TRANSITION',
    )
    send(runtime, {
      type: 'repairAgent',
      agentId: 'a',
      reason: 'Issue resolved manually',
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'queued',
      destination: null,
      blockers: [],
    })
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('assigned')
    send(runtime, { type: 'startTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().agents.a.destination?.id).not.toBe(
      initialIntent?.id,
    )
    expect(
      runtime
        .getSnapshot()
        .events.slice(-3)
        .map((event) => event.type),
    ).toEqual(['AGENT_REPAIR_STARTED', 'AGENT_REPAIRED', 'AGENT_STARTED'])
  })

  it('supports Manager tasks through the same business contract without character-specific data', () => {
    const runtime = seed()
    start(runtime, 'manager-review', 'manager')
    const state = runtime.getSnapshot()
    expect(state.agents.manager).toMatchObject({
      kind: 'manager',
      status: 'working',
      currentTaskId: 'manager-review',
      destination: { destinationId: 'desk-manager' },
    })
    expect(JSON.stringify(state)).not.toMatch(/headband|typing|animation|clip/i)
    send(runtime, { type: 'completeTask', taskId: 'manager-review' })
    expect(runtime.getSnapshot().agents.manager.status).toBe('completed')
    expect(runtime.getSnapshot().agents.a.status).toBe('sleeping')
  })
})

describe('dependency graph and readiness', () => {
  it('rejects missing, duplicate, self and transitive cyclic dependencies atomically', () => {
    const runtime = seed()
    createTask(runtime, 'a-task')
    createTask(runtime, 'b-task', ['a-task'])
    createTask(runtime, 'c-task', ['b-task'])
    reject(
      runtime,
      {
        type: 'createTask',
        task: {
          id: 'missing-ref',
          title: 'Missing dependency',
          dependencyIds: ['absent'],
        },
      },
      'NOT_FOUND',
    )
    reject(
      runtime,
      {
        type: 'createTask',
        task: { id: 'self', title: 'Self', dependencyIds: ['self'] },
      },
      'DEPENDENCY_CYCLE',
    )
    reject(
      runtime,
      {
        type: 'setTaskDependencies',
        taskId: 'a-task',
        dependencyIds: ['c-task'],
      },
      'DEPENDENCY_CYCLE',
    )
    reject(
      runtime,
      {
        type: 'setTaskDependencies',
        taskId: 'b-task',
        dependencyIds: ['a-task', 'a-task'],
      },
      'INVALID_DEPENDENCY',
    )
    expect(runtime.getSnapshot().tasks['a-task'].dependencyIds).toEqual([])
  })

  it('unlocks assigned and unassigned dependents without starting them', () => {
    const runtime = seed()
    start(runtime)
    createTask(runtime, 'assigned-dependent', ['task-a'])
    createTask(runtime, 'unassigned-dependent', ['task-a'])
    send(runtime, {
      type: 'assignTask',
      taskId: 'assigned-dependent',
      agentId: 'b',
    })
    expect(runtime.getSnapshot().agents.b.status).toBe('waiting')
    reject(
      runtime,
      { type: 'startTask', taskId: 'assigned-dependent' },
      'DEPENDENCIES_NOT_READY',
    )
    send(runtime, { type: 'completeTask', taskId: 'task-a' })
    const state = runtime.getSnapshot()
    expect(state.tasks['assigned-dependent']).toMatchObject({
      status: 'assigned',
      waitingForDependencies: false,
      startedAt: null,
    })
    expect(state.tasks['unassigned-dependent'].status).toBe('queued')
    expect(state.agents.b).toMatchObject({
      status: 'queued',
      destination: null,
      blockers: [],
    })
    expect(
      state.events.filter((event) => event.type === 'AGENT_STARTED'),
    ).toHaveLength(1)
    expect(
      state.events.filter((event) => event.type === 'TASK_READY'),
    ).toHaveLength(2)
  })

  it.each(['failTask', 'cancelTask'] as const)(
    'keeps dependents waiting with truthful %s reasons',
    (type) => {
      const runtime = seed()
      start(runtime)
      createTask(runtime, 'dependent', ['task-a'])
      send(runtime, { type: 'assignTask', taskId: 'dependent', agentId: 'b' })
      send(runtime, { type, taskId: 'task-a', reason: 'Manual stop' })
      const dependent = runtime.getSnapshot().tasks.dependent
      expect(dependent.status).toBe('waiting')
      expect(dependent.statusReason).toContain(
        type === 'failTask' ? 'failed' : 'cancelled',
      )
      expect(runtime.getSnapshot().agents.b.blockers).toEqual([
        dependent.statusReason,
      ])
      reject(
        runtime,
        { type: 'startTask', taskId: 'dependent' },
        'DEPENDENCIES_NOT_READY',
      )
    },
  )

  it('does not release a manual wait when its prerequisites finish', () => {
    const runtime = seed()
    start(runtime)
    createTask(runtime, 'dependent', ['task-a'])
    send(runtime, { type: 'assignTask', taskId: 'dependent', agentId: 'b' })
    send(runtime, {
      type: 'waitTask',
      taskId: 'dependent',
      reason: 'Waiting for human approval',
    })
    send(runtime, { type: 'completeTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().tasks.dependent).toMatchObject({
      status: 'waiting',
      waitingForDependencies: false,
      statusReason: 'Waiting for human approval',
    })
    expect(runtime.getSnapshot().agents.b.status).toBe('waiting')
    send(runtime, { type: 'startTask', taskId: 'dependent' })
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('in_progress')
  })

  it('pauses active work when a new unmet dependency is explicitly introduced', () => {
    const runtime = seed()
    start(runtime)
    createTask(runtime, 'new-prerequisite')
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'task-a',
      dependencyIds: ['new-prerequisite'],
    })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'waiting',
      waitingForDependencies: true,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'waiting',
      destination: null,
    })
    reject(
      runtime,
      { type: 'updateProgress', taskId: 'task-a', progressPercent: 90 },
      'INVALID_TRANSITION',
    )
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'task-a',
      dependencyIds: [],
    })
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('assigned')
    expect(runtime.getSnapshot().agents.a.status).toBe('queued')
  })
})

describe('spatial intent boundary', () => {
  it('accepts only matching grounded arrival and never completes tasks from spatial feedback', () => {
    const runtime = seed()
    start(runtime)
    const intentId = runtime.getSnapshot().agents.a.destination!.id
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId: 'stale',
        position: [1, 0, 1],
        headingRadians: 0,
      },
      'STALE_INTENT',
    )
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId,
        position: [1, 1, 1],
        headingRadians: 0,
      },
      'INVALID_POSE',
    )
    send(runtime, {
      type: 'arrive',
      agentId: 'a',
      intentId,
      position: [1, 0, 1],
      headingRadians: Math.PI,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'working',
      position: [1, 0, 1],
      headingRadians: Math.PI,
      destination: null,
    })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'in_progress',
      progressPercent: 0,
      completedAt: null,
    })
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId,
        position: [1, 0, 1],
        headingRadians: 0,
      },
      'STALE_INTENT',
    )
  })

  it('keeps collaboration pending until arrival, then returns to working through a fresh explicit intent', () => {
    const runtime = seed()
    start(runtime)
    send(runtime, {
      type: 'requestMovement',
      agentId: 'a',
      intentId: 'collaborate',
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Explicit review meeting',
      arrivalStatus: 'collaborating',
      collaboratorIds: ['b'],
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'walking',
      collaboratorIds: [],
    })
    send(runtime, {
      type: 'arrive',
      agentId: 'a',
      intentId: 'collaborate',
      position: [0, 0, 3],
      headingRadians: 0,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'collaborating',
      collaboratorIds: ['b'],
    })
    expect(runtime.getSnapshot().agents.b.status).toBe('sleeping')
    send(runtime, {
      type: 'requestMovement',
      agentId: 'a',
      intentId: 'return',
      destinationType: 'workstation',
      destinationId: 'desk-a',
      movementReason: 'Return after review',
      arrivalStatus: 'working',
    })
    send(runtime, {
      type: 'arrive',
      agentId: 'a',
      intentId: 'return',
      position: [-2.35, 0, -1.35],
      headingRadians: 0,
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'working',
      collaboratorIds: [],
      destination: null,
    })
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('in_progress')
  })

  it('does not accept completion from a superseded route and does not reuse old route IDs', () => {
    const runtime = seed()
    const movement = {
      type: 'requestMovement',
      agentId: 'a',
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Manual movement',
      arrivalStatus: 'waiting',
    } as const
    send(runtime, { ...movement, intentId: 'outbound' })
    send(runtime, { ...movement, intentId: 'replacement' })
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId: 'outbound',
        position: [0, 0, 3],
        headingRadians: 0,
      },
      'STALE_INTENT',
    )
    reject(runtime, { ...movement, intentId: 'outbound' }, 'DUPLICATE_ID')
    send(runtime, {
      type: 'arrive',
      agentId: 'a',
      intentId: 'replacement',
      position: [0, 0, 3],
      headingRadians: 0,
    })
    reject(runtime, { ...movement, intentId: 'replacement' }, 'DUPLICATE_ID')
  })

  it('holds a route during blocked/repair and rejects paused arrivals without task mutation', () => {
    const runtime = seed()
    start(runtime)
    const intent = runtime.getSnapshot().agents.a.destination!
    send(runtime, {
      type: 'blockTask',
      taskId: 'task-a',
      reason: 'Stop safely',
    })
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId: intent.id,
        position: [0, 0, 0],
        headingRadians: 0,
      },
      'INVALID_TRANSITION',
    )
    send(runtime, { type: 'beginRepair', agentId: 'a', reason: 'Review' })
    expect(runtime.getSnapshot().agents.a.destination).toBe(intent)
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId: intent.id,
        position: [0, 0, 0],
        headingRadians: 0,
      },
      'INVALID_TRANSITION',
    )
    send(runtime, { type: 'repairAgent', agentId: 'a', reason: 'Resolved' })
    reject(
      runtime,
      {
        type: 'arrive',
        agentId: 'a',
        intentId: intent.id,
        position: [0, 0, 0],
        headingRadians: 0,
      },
      'STALE_INTENT',
    )
  })

  it('turns matching navigation rejection into a truthful blocker and clears the failed intent', () => {
    const runtime = seed()
    start(runtime)
    const intentId = runtime.getSnapshot().agents.a.destination!.id
    reject(
      runtime,
      {
        type: 'rejectMovement',
        agentId: 'a',
        intentId: 'wrong',
        reason: 'Cannot route',
      },
      'STALE_INTENT',
    )
    send(runtime, {
      type: 'rejectMovement',
      agentId: 'a',
      intentId,
      reason: 'Unknown corridor waypoint',
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'blocked',
      blockers: ['Unknown corridor waypoint'],
      destination: null,
    })
    expect(runtime.getSnapshot().tasks['task-a']).toMatchObject({
      status: 'blocked',
      progressPercent: 0,
      completedAt: null,
    })
    expect(runtime.getSnapshot().events.at(-1)).toMatchObject({
      type: 'AGENT_BLOCKED',
      payload: { intentId, reason: 'Unknown corridor waypoint' },
    })
  })

  it('validates destination/collaborator IDs and cannot command unstarted work', () => {
    const runtime = seed()
    const movement = {
      type: 'requestMovement',
      agentId: 'a',
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Manual review',
      arrivalStatus: 'waiting',
    } as const
    reject(
      runtime,
      { ...movement, destinationType: 'workstation', destinationId: 'missing' },
      'NOT_FOUND',
    )
    reject(
      runtime,
      { ...movement, destinationType: 'agent', destinationId: 'a' },
      'INVALID_INPUT',
    )
    reject(runtime, { ...movement, collaboratorIds: ['absent'] }, 'NOT_FOUND')
    reject(runtime, { ...movement, collaboratorIds: ['a'] }, 'INVALID_INPUT')
    reject(
      runtime,
      { ...movement, collaboratorIds: ['b', 'b'] },
      'INVALID_INPUT',
    )
    reject(
      runtime,
      { ...movement, arrivalStatus: 'working' },
      'INVALID_TRANSITION',
    )
  })
})

describe('registration and input boundaries', () => {
  it('rejects duplicate IDs, invalid poses, unknown references and reserved record keys', () => {
    const runtime = seed()
    reject(
      runtime,
      {
        type: 'registerDepartment',
        department: { id: 'engineering', name: 'Duplicate' },
      },
      'DUPLICATE_ID',
    )
    reject(
      runtime,
      {
        type: 'registerDepartment',
        department: { id: '__proto__', name: 'Unsafe key' },
      },
      'INVALID_INPUT',
    )
    reject(
      runtime,
      {
        type: 'registerWorkstation',
        workstation: {
          id: 'bad',
          position: [0, Number.NaN, 0],
          headingRadians: 0,
        },
      },
      'INVALID_POSE',
    )
    reject(
      runtime,
      {
        type: 'registerWorkstation',
        workstation: {
          id: 'bad',
          departmentId: 'absent',
          position: [0, 0, 0],
          headingRadians: 0,
        },
      },
      'NOT_FOUND',
    )
    const agent = {
      id: 'c',
      name: 'C',
      role: 'QA',
      kind: 'standard-worker',
      departmentId: 'engineering',
      position: [0, 0, 0],
      headingRadians: 0,
    } as const
    reject(
      runtime,
      { type: 'registerAgent', agent: { ...agent, workstationId: 'desk-a' } },
      'WORKSTATION_OCCUPIED',
    )
    reject(
      runtime,
      { type: 'registerAgent', agent: { ...agent, managerId: 'b' } },
      'INVALID_INPUT',
    )
    reject(
      runtime,
      { type: 'registerAgent', agent: { ...agent, status: 'working' } },
      'INVALID_TRANSITION',
    )
  })

  it('rejects non-JSON or circular metadata and missing parents without creating partial tasks', () => {
    const runtime = seed()
    const cyclic: Record<string, RuntimeJson> = {}
    cyclic.self = cyclic
    reject(
      runtime,
      {
        type: 'createTask',
        task: { id: 'bad', title: 'Bad metadata', metadata: cyclic },
      },
      'INVALID_INPUT',
    )
    reject(
      runtime,
      {
        type: 'createTask',
        task: {
          id: 'bad',
          title: 'Bad metadata',
          metadata: { value: Number.POSITIVE_INFINITY },
        },
      },
      'INVALID_INPUT',
    )
    reject(
      runtime,
      {
        type: 'createTask',
        task: { id: 'bad', title: 'Missing parent', parentTaskId: 'missing' },
      },
      'NOT_FOUND',
    )
    expect(Object.keys(runtime.getSnapshot().tasks)).toEqual([])
  })
})

describe('working arrival destination contract', () => {
  const unsupported = [
    { destinationType: 'hub', destinationId: 'hub:central' },
    { destinationType: 'agent', destinationId: 'b' },
    { destinationType: 'waypoint', destinationId: 'workstation:a' },
    { destinationType: 'workstation', destinationId: 'desk-b' },
  ] as const

  it.each(unsupported)(
    'rejects working movement to $destinationType $destinationId',
    (destination) => {
      const runtime = seed()
      start(runtime)
      reject(
        runtime,
        {
          type: 'requestMovement',
          agentId: 'a',
          ...destination,
          movementReason: 'Invalid working location',
          arrivalStatus: 'working',
        },
        'INVALID_DESTINATION',
      )
      expect(runtime.getSnapshot().agents.a.destination?.destinationId).toBe(
        'desk-a',
      )
    },
  )

  it.each(unsupported)(
    'rejects restored working arrival at $destinationType $destinationId',
    (destination) => {
      const prepared = seed()
      start(prepared)
      const state = prepared.getSnapshot()
      const agent = state.agents.a
      const intent = { ...agent.destination!, ...destination }
      const repository = createInMemoryOfficeRuntimeRepository({
        ...state,
        agents: {
          ...state.agents,
          a: { ...agent, status: 'walking', destination: intent },
        },
      })
      const runtime = createOfficeRuntime({ repository, now: () => NOW })
      reject(
        runtime,
        {
          type: 'arrive',
          agentId: 'a',
          intentId: intent.id,
          position: [0, 0, 3],
          headingRadians: 0,
        },
        'INVALID_DESTINATION',
      )
      expect(runtime.getSnapshot().agents.a.status).toBe('walking')
      expect(runtime.getSnapshot().tasks['task-a'].status).toBe('in_progress')
    },
  )

  it.each(['a', 'manager'] as const)(
    'preserves valid own-workstation working arrivals for %s',
    (agentId) => {
      const runtime = seed()
      start(runtime, 'own-desk-task', agentId)
      const destinationId = runtime.getSnapshot().agents[agentId].workstationId!
      send(runtime, {
        type: 'requestMovement',
        agentId,
        intentId: 'own-desk-return',
        destinationType: 'workstation',
        destinationId,
        movementReason: 'Return to assigned desk',
        arrivalStatus: 'working',
      })
      send(runtime, {
        type: 'arrive',
        agentId,
        intentId: 'own-desk-return',
        position: [0, 0, 2],
        headingRadians: 0,
      })
      expect(runtime.getSnapshot().agents[agentId]).toMatchObject({
        status: 'working',
        destination: null,
      })
      expect(runtime.getSnapshot().tasks['own-desk-task'].status).toBe(
        'in_progress',
      )
    },
  )

  it('continues to support headless task start without a workstation or spatial intent', () => {
    const runtime = seed()
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id: 'headless',
        name: 'Headless worker',
        role: 'Research',
        kind: 'standard-worker',
        departmentId: 'engineering',
        position: [0, 0, 3],
        headingRadians: 0,
      },
    })
    start(runtime, 'headless-task', 'headless')
    expect(runtime.getSnapshot().agents.headless).toMatchObject({
      status: 'working',
      workstationId: null,
      destination: null,
    })
    expect(runtime.getSnapshot().tasks['headless-task'].status).toBe(
      'in_progress',
    )
  })
})

describe('explicit repair acknowledgement barrier', () => {
  function repairing() {
    const runtime = seed()
    start(runtime)
    send(runtime, {
      type: 'blockTask',
      taskId: 'task-a',
      reason: 'Task blocked',
    })
    send(runtime, {
      type: 'beginRepair',
      agentId: 'a',
      reason: 'Repair in progress',
    })
    return runtime
  }

  it('cannot bypass repair by waiting and restarting the task', () => {
    const runtime = repairing()
    send(runtime, {
      type: 'waitTask',
      taskId: 'task-a',
      reason: 'Wait instead',
    })
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('waiting')
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'repair',
      blockers: ['Repair in progress'],
    })
    reject(
      runtime,
      { type: 'startTask', taskId: 'task-a' },
      'INVALID_TRANSITION',
    )
    send(runtime, {
      type: 'repairAgent',
      agentId: 'a',
      reason: 'Repair acknowledged',
    })
    send(runtime, { type: 'startTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().agents.a.status).toBe('working')
  })

  it('cannot bypass repair after a failed task by assigning fresh work', () => {
    const runtime = seed()
    start(runtime)
    send(runtime, {
      type: 'failTask',
      taskId: 'task-a',
      reason: 'Validation failed',
    })
    send(runtime, {
      type: 'beginRepair',
      agentId: 'a',
      reason: 'Inspecting failure',
    })
    createTask(runtime, 'next-task')
    reject(
      runtime,
      { type: 'assignTask', taskId: 'next-task', agentId: 'a' },
      'INVALID_TRANSITION',
    )
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'repair',
      currentTaskId: 'task-a',
      blockers: ['Inspecting failure'],
    })
    expect(runtime.getSnapshot().tasks['next-task'].assignedAgentId).toBeNull()
    send(runtime, {
      type: 'repairAgent',
      agentId: 'a',
      reason: 'Recovery acknowledged',
    })
    send(runtime, { type: 'assignTask', taskId: 'next-task', agentId: 'a' })
    expect(runtime.getSnapshot().agents.a.status).toBe('queued')
    expect(runtime.getSnapshot().tasks['task-a'].status).toBe('failed')
  })

  it.each(['failTask', 'cancelTask'] as const)(
    '%s can resolve the task but cannot silently resolve agent repair',
    (type) => {
      const runtime = repairing()
      send(runtime, {
        type,
        taskId: 'task-a',
        reason: 'Resolve current task explicitly',
      })
      expect(runtime.getSnapshot().tasks['task-a'].status).toBe(
        type === 'failTask' ? 'failed' : 'cancelled',
      )
      expect(runtime.getSnapshot().agents.a).toMatchObject({
        status: 'repair',
        currentTaskId: 'task-a',
        destination: null,
        blockers: ['Repair in progress'],
      })
      send(runtime, {
        type: 'repairAgent',
        agentId: 'a',
        reason: 'Recovery separately acknowledged',
      })
      expect(runtime.getSnapshot().agents.a).toMatchObject({
        status: 'waiting',
        blockers: [],
      })
    },
  )

  it('dependency readiness cannot clear repair in a restored dependency-waiting snapshot', () => {
    const prepared = seed()
    start(prepared)
    createTask(prepared, 'dependent', ['task-a'])
    send(prepared, { type: 'assignTask', taskId: 'dependent', agentId: 'b' })
    const saved = prepared.getSnapshot()
    const repository = createInMemoryOfficeRuntimeRepository({
      ...saved,
      agents: {
        ...saved.agents,
        b: {
          ...saved.agents.b,
          status: 'repair',
          blockers: ['Restored repair still requires acknowledgement'],
        },
      },
    })
    const runtime = createOfficeRuntime({ repository, now: () => NOW })
    send(runtime, { type: 'completeTask', taskId: 'task-a' })
    expect(runtime.getSnapshot().tasks.dependent).toMatchObject({
      status: 'assigned',
      waitingForDependencies: false,
    })
    expect(runtime.getSnapshot().agents.b).toMatchObject({
      status: 'repair',
      blockers: ['Restored repair still requires acknowledgement'],
    })
    reject(
      runtime,
      { type: 'startTask', taskId: 'dependent' },
      'INVALID_TRANSITION',
    )
    send(runtime, { type: 'repairAgent', agentId: 'b', reason: 'Acknowledged' })
    send(runtime, { type: 'startTask', taskId: 'dependent' })
    expect(runtime.getSnapshot().agents.b.status).toBe('working')
  })

  it('late movement rejection and reblocking cannot change repair into a resumable blocked state', () => {
    const runtime = repairing()
    const intentId = runtime.getSnapshot().agents.a.destination!.id
    send(runtime, {
      type: 'rejectMovement',
      agentId: 'a',
      intentId,
      reason: 'Late route failure',
    })
    send(runtime, {
      type: 'blockTask',
      taskId: 'task-a',
      reason: 'Another blocker',
    })
    expect(runtime.getSnapshot().agents.a).toMatchObject({
      status: 'repair',
      destination: null,
      blockers: ['Repair in progress'],
    })
    reject(
      runtime,
      { type: 'startTask', taskId: 'task-a' },
      'INVALID_TRANSITION',
    )
  })

  it('requires acknowledgement for an agent registered in repair before its first assignment', () => {
    const runtime = seed()
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id: 'repair-seed',
        name: 'Repair seed',
        role: 'QA',
        kind: 'standard-worker',
        departmentId: 'engineering',
        position: [0, 0, 3],
        headingRadians: 0,
        status: 'repair',
      },
    })
    createTask(runtime)
    reject(
      runtime,
      { type: 'assignTask', taskId: 'task-a', agentId: 'repair-seed' },
      'INVALID_TRANSITION',
    )
    send(runtime, {
      type: 'repairAgent',
      agentId: 'repair-seed',
      reason: 'Ready for first task',
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'task-a',
      agentId: 'repair-seed',
    })
    expect(runtime.getSnapshot().agents['repair-seed'].status).toBe('queued')
  })
})

describe('complete committed event changes', () => {
  function business(state: RuntimeState) {
    return {
      agents: state.agents,
      tasks: state.tasks,
      workstations: state.workstations,
      departments: state.departments,
      connection: state.connection,
    }
  }

  it('reconstructs every business registry solely from ordered event after-images', () => {
    const runtime = createOfficeRuntime({ now: () => NOW })
    let reconstructed = business(runtime.getSnapshot())
    let consumed = 0
    const observations: {
      state: RuntimeState
      committed: readonly RuntimeEvent[]
      reconstructed: ReturnType<typeof business>
    }[] = []
    const unsubscribe = runtime.subscribe(() => {
      const state = runtime.getSnapshot()
      const committed = state.events.slice(consumed)
      for (const event of committed) {
        const changes = event.changes
        reconstructed = {
          agents: { ...reconstructed.agents, ...changes.agents },
          tasks: { ...reconstructed.tasks, ...changes.tasks },
          workstations: {
            ...reconstructed.workstations,
            ...changes.workstations,
          },
          departments: { ...reconstructed.departments, ...changes.departments },
          connection: changes.connection ?? reconstructed.connection,
        }
      }
      consumed = state.events.length
      observations.push({ state, committed, reconstructed })
    })

    seed(runtime)
    start(runtime)
    send(runtime, {
      type: 'createTask',
      task: {
        id: 'dependent',
        title: 'Dependent review',
        description: 'Complete after prerequisite',
        dependencyIds: ['task-a'],
        parentTaskId: 'task-a',
        priority: 'high',
        metadata: { approvedBy: 'manual-command', version: 2 },
      },
    })
    send(runtime, { type: 'assignTask', taskId: 'dependent', agentId: 'b' })
    send(runtime, { type: 'selectAgent', agentId: 'a' })
    send(runtime, { type: 'selectTask', taskId: 'dependent' })
    send(runtime, {
      type: 'requestMovement',
      agentId: 'a',
      intentId: 'review-trip',
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Manual review',
      arrivalStatus: 'collaborating',
      collaboratorIds: ['b'],
    })
    send(runtime, {
      type: 'arrive',
      agentId: 'a',
      intentId: 'review-trip',
      position: [0, 0, 3],
      headingRadians: Math.PI,
    })
    send(runtime, { type: 'startTask', taskId: 'task-a' })
    send(runtime, {
      type: 'blockTask',
      taskId: 'task-a',
      reason: 'Manual inspection needed',
    })
    send(runtime, {
      type: 'beginRepair',
      agentId: 'a',
      reason: 'Manual inspection started',
    })
    send(runtime, {
      type: 'repairAgent',
      agentId: 'a',
      reason: 'Inspection resolved',
    })
    send(runtime, { type: 'startTask', taskId: 'task-a' })
    send(runtime, {
      type: 'updateProgress',
      taskId: 'task-a',
      progressPercent: 55,
    })
    send(runtime, { type: 'completeTask', taskId: 'task-a' })
    send(runtime, { type: 'startTask', taskId: 'dependent' })
    send(runtime, {
      type: 'failTask',
      taskId: 'dependent',
      reason: 'Explicit validation failure',
    })
    send(runtime, {
      type: 'repairAgent',
      agentId: 'b',
      reason: 'Failure inspected; task remains failed',
    })

    // This previously mutated an unassigned task after the command's last emit.
    createTask(runtime, 'unassigned')
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'unassigned',
      dependencyIds: ['dependent'],
    })
    expect(
      runtime.getSnapshot().events.at(-1)?.changes.tasks?.unassigned.status,
    ).toBe('waiting')
    send(runtime, {
      type: 'setTaskDependencies',
      taskId: 'unassigned',
      dependencyIds: [],
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'unassigned',
      agentId: 'manager',
    })
    send(runtime, { type: 'startTask', taskId: 'unassigned' })
    send(runtime, {
      type: 'waitTask',
      taskId: 'unassigned',
      reason: 'Manual pause',
    })
    send(runtime, { type: 'startTask', taskId: 'unassigned' })
    send(runtime, {
      type: 'cancelTask',
      taskId: 'unassigned',
      reason: 'Manual cancellation',
    })
    start(runtime, 'route-rejected')
    send(runtime, {
      type: 'rejectMovement',
      agentId: 'a',
      intentId: runtime.getSnapshot().agents.a.destination!.id,
      reason: 'No known safe route',
    })
    send(runtime, { type: 'disconnect' })
    send(runtime, { type: 'connect' })

    const created = runtime
      .getSnapshot()
      .events.find(
        (event) =>
          event.type === 'TASK_CREATED' && event.taskId === 'dependent',
      )!
    expect(created.changes.tasks?.dependent).toMatchObject({
      title: 'Dependent review',
      description: 'Complete after prerequisite',
      assignedAgentId: null,
      parentTaskId: 'task-a',
      priority: 'high',
      metadata: { approvedBy: 'manual-command', version: 2 },
    })
    expect(Object.isFrozen(created.changes.tasks?.dependent.metadata)).toBe(
      true,
    )
    expect(created.changes.tasks?.dependent.status).toBe('waiting')
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('failed')
    // Assert outside the subscriber: the store deliberately isolates callback failures.
    for (const observation of observations) {
      expect(observation.reconstructed).toEqual(business(observation.state))
      for (const [index, event] of observation.committed.entries()) {
        expect(event.transactionRevision).toBe(observation.state.revision)
        expect(event.transactionEventIndex).toBe(index)
        expect(event.transactionEventCount).toBe(observation.committed.length)
      }
    }
    expect(reconstructed).toEqual(business(runtime.getSnapshot()))
    unsubscribe()
  })

  it('groups completion and dependency release as one atomic committed transaction', () => {
    const runtime = seed()
    start(runtime)
    createTask(runtime, 'assigned-dependent', ['task-a'])
    createTask(runtime, 'unassigned-dependent', ['task-a'])
    send(runtime, {
      type: 'assignTask',
      taskId: 'assigned-dependent',
      agentId: 'b',
    })
    const previous = runtime.getSnapshot()
    const listener = vi.fn()
    runtime.subscribe(listener)
    const completed = send(runtime, { type: 'completeTask', taskId: 'task-a' })
    const events = completed.events.slice(previous.events.length)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.type)).toEqual([
      'TASK_COMPLETED',
      'TASK_READY',
      'TASK_READY',
    ])
    expect(events.map((event) => event.transactionEventIndex)).toEqual([
      0, 1, 2,
    ])
    for (const event of events) {
      expect(event.transactionRevision).toBe(completed.revision)
      expect(event.transactionEventCount).toBe(3)
    }
    expect(events[0].changes.tasks?.['task-a'].status).toBe('completed')
    expect(events[0].changes.agents?.a.currentTaskId).toBe('task-a')
    expect(events[1].changes.tasks?.['assigned-dependent'].status).toBe(
      'assigned',
    )
    expect(events[1].changes.agents?.b.status).toBe('queued')
    expect(events[2].changes.tasks?.['unassigned-dependent'].status).toBe(
      'queued',
    )
    expect(events[0].changes.departments).toBeUndefined()
    expect(events[0].changes.workstations).toBeUndefined()
  })

  it('publishes complete event changes only after the repository commits successfully', () => {
    let runtime: OfficeRuntime
    let stored: RuntimeState | null = null
    let fail = false
    const repository: OfficeRuntimeRepository = {
      read: () => stored,
      write: (candidate) => {
        expect(runtime.getSnapshot()).not.toBe(candidate)
        expect(candidate.events.at(-1)?.changes).toBeDefined()
        if (fail) throw new Error('Write rejected')
        stored = candidate
      },
    }
    runtime = createOfficeRuntime({ repository, now: () => NOW })
    const observed: RuntimeState[] = []
    runtime.subscribe(() => {
      expect(runtime.getSnapshot()).toBe(stored)
      observed.push(runtime.getSnapshot())
    })
    send(runtime, { type: 'connect' })
    expect(observed[0].events[0].changes).toEqual({ connection: 'local' })
    fail = true
    reject(
      runtime,
      {
        type: 'registerDepartment',
        department: { id: 'not-committed', name: 'Not committed' },
      },
      'REPOSITORY_ERROR',
    )
    expect(observed).toHaveLength(1)
    expect(runtime.getSnapshot().events).toHaveLength(1)
    expect(runtime.getSnapshot().departments).toEqual({})
  })

  it('allows nested subscriber commands without stale reads or corrupting the outer command result', () => {
    const runtime = createOfficeRuntime({ now: () => NOW })
    const observed: string[] = []
    let issuedNested = false
    runtime.subscribe(() => {
      observed.push(`first:${runtime.getSnapshot().revision}`)
      if (!issuedNested) {
        issuedNested = true
        send(runtime, {
          type: 'registerDepartment',
          department: { id: 'nested', name: 'Nested explicit command' },
        })
      }
    })
    runtime.subscribe(() => {
      observed.push(`second:${runtime.getSnapshot().revision}`)
    })
    const outerCommit = send(runtime, { type: 'connect' })
    expect(outerCommit.revision).toBe(1)
    expect(outerCommit.departments).toEqual({})
    expect(runtime.getSnapshot().revision).toBe(2)
    expect(runtime.getSnapshot().departments.nested.name).toBe(
      'Nested explicit command',
    )
    expect(observed).toEqual(['first:1', 'first:2', 'second:2', 'second:2'])
    expect(runtime.getMetrics()).toMatchObject({
      commands: 2,
      commits: 2,
      notifications: 4,
      subscribers: 2,
    })
  })
})
