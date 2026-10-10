import { describe, expect, it } from 'vitest'
import {
  createCharacterMotion,
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from '../office/characterMotion'
import type {
  AgentSpatialSnapshot,
  OfficeAgentStatus,
} from '../office/officeState'
import { presentedAgents } from '../office/workerPresentation'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
} from './officeRuntime'
import {
  createOfficeRuntimeBridge,
  RECENT_RUNTIME_ACTIVITY_LIMIT,
} from './officeRuntimeBridge'
import type {
  AgentSpatialIntent,
  RuntimeAgent,
  RuntimeState,
  RuntimeTask,
} from './runtimeTypes'

const now = '2026-10-09T12:00:00.000Z'
const station = {
  id: 'desk-worker',
  position: [-8, 0, 0] as const,
  headingRadians: 0,
  departmentId: 'engineering',
}
const executiveStation = {
  id: 'desk-manager',
  position: [8, 0, 0] as const,
  headingRadians: 0,
  departmentId: 'executive',
}

function fixture(): RuntimeState {
  const task: RuntimeTask = {
    id: 'task-primary',
    title: 'Explicit local task',
    description: 'Supplied task description',
    status: 'in_progress',
    priority: 'normal',
    progressPercent: 17,
    assignedAgentId: 'worker',
    dependencyIds: ['task-dependency'],
    parentTaskId: null,
    statusReason: null,
    waitingForDependencies: false,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
  }
  const worker: RuntimeAgent = {
    id: 'worker',
    name: 'Worker One',
    role: 'Engineer',
    departmentId: 'engineering',
    kind: 'standard-worker',
    capabilities: ['code'],
    status: 'queued',
    workstationId: station.id,
    managerId: 'manager',
    currentTaskId: task.id,
    destination: null,
    collaboratorIds: [],
    blockers: [],
    position: [0, 0, 0],
    headingRadians: 0,
    createdAt: now,
    updatedAt: now,
  }
  return {
    connection: 'local',
    requests: {},
    plans: {},
    toolExecutions: {},
    memories: {},
    revision: 1,
    agents: {
      worker,
      manager: {
        ...worker,
        id: 'manager',
        name: 'Company Manager',
        role: 'Manager',
        kind: 'manager',
        departmentId: 'executive',
        managerId: null,
        status: 'waiting',
        workstationId: executiveStation.id,
        currentTaskId: null,
        position: seatedWorkstationAnchor(executiveStation),
      },
    },
    tasks: {
      [task.id]: task,
      'task-dependency': {
        ...task,
        id: 'task-dependency',
        title: 'Supplied prerequisite',
        dependencyIds: [],
        assignedAgentId: null,
        status: 'completed',
        progressPercent: 100,
        completedAt: now,
      },
    },
    workstations: {
      [station.id]: station,
      [executiveStation.id]: executiveStation,
    },
    departments: {
      engineering: {
        id: 'engineering',
        name: 'Engineering',
        description: 'Implementation department',
      },
      executive: { id: 'executive', name: 'Executive', description: null },
    },
    events: [],
    activities: [
      {
        id: 'activity-1',
        eventId: 'event-1',
        occurredAt: now,
        agentId: 'worker',
        taskId: task.id,
        summary: 'Explicit progress changed to 17 percent.',
      },
    ],
    selectedAgentId: null,
    selectedTaskId: null,
  }
}

function changeAgent(
  state: RuntimeState,
  changes: Partial<RuntimeAgent>,
  id = 'worker',
): RuntimeState {
  return {
    ...state,
    revision: state.revision + 1,
    agents: { ...state.agents, [id]: { ...state.agents[id], ...changes } },
  }
}

function intent(
  overrides: Partial<AgentSpatialIntent> = {},
): AgentSpatialIntent {
  return {
    id: 'intent-1',
    destinationType: 'workstation',
    destinationId: station.id,
    arrivalStatus: 'working',
    movementReason: 'Return to assigned workstation',
    collaboratorIds: [],
    ...overrides,
  }
}

function view(
  state: RuntimeState,
  id = 'worker',
  overrides: Partial<AgentSpatialSnapshot> = {},
): AgentSpatialSnapshot {
  const agent = state.agents[id]
  return {
    agentId: id,
    position: agent.position,
    headingRadians: agent.headingRadians,
    workstation: agent.workstationId
      ? state.workstations[agent.workstationId]
      : null,
    destination: null,
    movementState: 'stationary',
    speedMetersPerSecond: 0,
    pathProgress: null,
    collaborationTargetId: null,
    phase: id === 'manager' ? 'seated' : 'standing',
    diagnostic: null,
    motionId: null,
    completedMotionId: null,
    ...overrides,
  }
}

describe('local runtime office bridge', () => {
  it.each([0.016, 0.05, 0.1])(
    'keeps collaboration departure and workstation return diagnostics clear at %ss frames',
    (delta) => {
      const seeded = changeAgent(fixture(), {
        status: 'working',
        position: seatedWorkstationAnchor(station),
      })
      const runtime = createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository(seeded),
        now: () => now,
      })
      const bridge = createOfficeRuntimeBridge(),
        views = new Map<string, AgentSpatialSnapshot>()
      let projected = bridge.project(runtime.getSnapshot(), views)!
      const controller = createCharacterMotion(
        presentedAgents(projected).find((agent) => agent.id === 'worker')!,
      )
      const diagnostics: {
        phase: string
        text: string
        status: OfficeAgentStatus
      }[] = []
      let eventKey = ''
      const inspect = () => {
        const frame = controller.advance(0)
        if (frame.diagnostic)
          diagnostics.push({
            phase: frame.phase,
            text: frame.diagnostic,
            status: runtime.getSnapshot().agents.worker.status,
          })
      }
      const project = () => {
        const next = bridge.project(runtime.getSnapshot(), views)!
        if (next !== projected) {
          projected = next
          controller.update(
            presentedAgents(next).find((agent) => agent.id === 'worker')!,
          )
          inspect()
        }
      }
      const step = () => {
        const frame = controller.advance(delta)
        inspect()
        const current = { ...view(runtime.getSnapshot()), ...frame }
        views.set('worker', current)
        const key = `${runtime.getSnapshot().agents.worker.status}:${frame.phase}:${frame.motionId}:${frame.completedMotionId}:${frame.diagnostic}`
        if (key !== eventKey) {
          eventKey = key
          bridge.onSpatialEvent(runtime.getSnapshot(), current, views)
          for (const command of bridge.drainFeedback())
            expect(runtime.dispatch(command).ok).toBe(true)
        }
        project()
      }
      const until = (predicate: () => boolean) => {
        for (let index = 0; index < 6000 && !predicate(); index++) step()
        expect(predicate()).toBe(true)
      }
      until(() => controller.advance(0).workingHard)
      expect(
        runtime.dispatch({
          type: 'requestMovement',
          agentId: 'worker',
          destinationType: 'hub',
          destinationId: 'hub:central',
          movementReason: 'Explicit collaboration request',
          arrivalStatus: 'collaborating',
        }).ok,
      ).toBe(true)
      project()
      until(
        () => runtime.getSnapshot().agents.worker.status === 'collaborating',
      )
      expect(
        runtime.dispatch({
          type: 'requestMovement',
          agentId: 'worker',
          destinationType: 'workstation',
          destinationId: station.id,
          movementReason: 'Return to working desk',
          arrivalStatus: 'working',
        }).ok,
      ).toBe(true)
      project()
      until(
        () =>
          controller.advance(0).workingHard &&
          runtime.getSnapshot().agents.worker.destination === null,
      )
      expect(runtime.getSnapshot().tasks['task-primary'].status).toBe(
        'in_progress',
      )
      expect(diagnostics).toEqual([])
    },
  )
  it.each<OfficeAgentStatus>(['working', 'walking', 'queued'])(
    'settles a zero-distance %s restart at a real seat or standing exit before acknowledging',
    (status) => {
      const exit = standingWorkstationAnchor(station)
      const initial = changeAgent(fixture(), {
        status: 'working',
        position: [exit[0], 0, exit[2] - 2],
      })
      const initialBridge = createOfficeRuntimeBridge()
      const placement = presentedAgents(
        initialBridge.project(initial, new Map())!,
      ).find((agent) => agent.id === 'worker')!
      const controller = createCharacterMotion({
        ...placement,
        motion: {
          id: 'old-route',
          points: [placement.position, exit],
          speedMetersPerSecond: 0.85,
        },
      })
      const partial = controller.advance(2 / 0.85 + 0.05)
      expect(partial.phase).toBe('sitting')
      const state = changeAgent(initial, {
        status,
        destination: intent({ id: 'restart' }),
      })
      const live = { ...view(state), ...partial },
        views = new Map([['worker', live]])
      const bridge = createOfficeRuntimeBridge()
      const projected = bridge.project(state, views)!
      expect(projected.agents.worker.motion).toBeUndefined()
      expect(bridge.drainFeedback()).toEqual([])
      controller.update(
        presentedAgents(projected).find((agent) => agent.id === 'worker')!,
      )
      const settled = controller.advance(3)
      expect(['seated', 'equipping', 'standing']).toContain(settled.phase)
      const settledEvent = { ...view(state), ...settled }
      views.set('worker', settledEvent)
      bridge.onSpatialEvent(state, settledEvent, views)
      const feedback = bridge.drainFeedback()
      expect(feedback).toHaveLength(1)
      expect(feedback[0]).toMatchObject({
        type: 'arrive',
        intentId: 'restart',
        position:
          status === 'walking' ? exit : seatedWorkstationAnchor(station),
      })
      expect(bridge.getMetrics().plans).toBe(1)
    },
  )
  it.each(['worker', 'manager'] as const)(
    'defers a partial sit arrival and reconnects %s at its actual seated pose',
    (id) => {
      const initial = fixture(),
        desk = id === 'worker' ? station : executiveStation
      const exit = standingWorkstationAnchor(desk)
      const seeded = changeAgent(
        initial,
        {
          status: 'queued',
          position: [exit[0], 0, exit[2] - 2],
          currentTaskId: 'task-primary',
        },
        id,
      )
      const runtime = createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository({
          ...seeded,
          tasks: {
            ...seeded.tasks,
            'task-primary': {
              ...seeded.tasks['task-primary'],
              assignedAgentId: id,
              status: 'assigned',
            },
          },
        }),
        now: () => now,
      })
      const bridge = createOfficeRuntimeBridge(),
        views = new Map<string, AgentSpatialSnapshot>()
      const initialProjection = bridge.project(runtime.getSnapshot(), views)!
      const controller = createCharacterMotion(
        presentedAgents(initialProjection).find((agent) => agent.id === id)!,
      )
      const live = view(runtime.getSnapshot(), id, { phase: 'standing' })
      views.set(id, live)
      expect(
        runtime.dispatch({ type: 'startTask', taskId: 'task-primary' }).ok,
      ).toBe(true)
      const projected = bridge.project(runtime.getSnapshot(), views)!
      controller.update(
        presentedAgents(projected).find((agent) => agent.id === id)!,
      )
      const command = projected.agents[id].motion!
      const partial = controller.advance(
        2 / command.speedMetersPerSecond + 0.05,
      )
      expect(partial.phase).toBe('sitting')
      expect(
        Math.hypot(
          partial.position[0] - exit[0],
          partial.position[2] - exit[2],
        ),
      ).toBeGreaterThan(0.01)
      const partialEvent = { ...live, ...partial }
      views.set(id, partialEvent)
      bridge.onSpatialEvent(runtime.getSnapshot(), partialEvent, views)
      expect(bridge.drainFeedback()).toEqual([])
      expect(
        bridge.project(runtime.getSnapshot(), views)!.agents[id].motion,
      ).toBe(command)
      const seated = controller.advance(3)
      expect(seated.phase).toBe(id === 'worker' ? 'equipping' : 'seated')
      expect(seated.position).toEqual(seatedWorkstationAnchor(desk))
      const seatedEvent = { ...live, ...seated }
      views.set(id, seatedEvent)
      bridge.onSpatialEvent(runtime.getSnapshot(), seatedEvent, views)
      const feedback = bridge.drainFeedback()
      expect(feedback).toHaveLength(1)
      expect(feedback[0]).toMatchObject({
        type: 'arrive',
        position: seated.position,
      })
      expect(runtime.dispatch(feedback[0]).ok).toBe(true)
      expect(runtime.getSnapshot().tasks['task-primary'].status).toBe(
        'in_progress',
      )
      expect(runtime.dispatch({ type: 'disconnect' }).ok).toBe(true)
      expect(bridge.project(runtime.getSnapshot(), views)).toBeNull()
      views.clear()
      expect(runtime.dispatch({ type: 'connect' }).ok).toBe(true)
      const remounted = createCharacterMotion(
        presentedAgents(bridge.project(runtime.getSnapshot(), views)!).find(
          (agent) => agent.id === id,
        )!,
      ).advance(0)
      expect(remounted.position).toEqual(seated.position)
      expect(remounted.diagnostic).toBeNull()
      expect(remounted.clip).toBe(
        id === 'manager' ? 'seated_work' : 'headband_on',
      )
    },
  )
  it.each(['worker', 'manager'] as const)(
    'connects real local task commands to %s navigation without completing work on arrival',
    (id) => {
      const initial = fixture()
      const task = {
        ...initial.tasks['task-primary'],
        assignedAgentId: id,
        status: 'assigned' as const,
      }
      const seeded = changeAgent(
        { ...initial, tasks: { ...initial.tasks, [task.id]: task } },
        {
          position: [0, 0, 0],
          status: 'queued',
          currentTaskId: task.id,
        },
        id,
      )
      const runtime = createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository(seeded),
        now: () => now,
      })
      const bridge = createOfficeRuntimeBridge(),
        views = new Map<string, AgentSpatialSnapshot>()
      const first = bridge.project(runtime.getSnapshot(), views)!
      const controller = createCharacterMotion(
        presentedAgents(first).find((agent) => agent.id === id)!,
      )
      const metrics = bridge.getMetrics()
      expect(runtime.dispatch({ type: 'selectAgent', agentId: id }).ok).toBe(
        true,
      )
      expect(bridge.project(runtime.getSnapshot(), views)).toBe(first)
      expect(bridge.getMetrics()).toEqual(metrics)
      const live = view(runtime.getSnapshot(), id, { phase: 'standing' })
      views.set(id, live)
      expect(runtime.dispatch({ type: 'startTask', taskId: task.id }).ok).toBe(
        true,
      )
      const started = bridge.project(runtime.getSnapshot(), views)!
      const placement = presentedAgents(started).find(
        (agent) => agent.id === id,
      )!
      expect(placement.status).toBe('working')
      expect(placement.motion).toBeDefined()
      controller.update(placement)
      const motion = placement.motion!
      const travel =
        motion.points
          .slice(1)
          .reduce(
            (sum, point, index) =>
              sum +
              Math.hypot(
                point[0] - motion.points[index][0],
                point[2] - motion.points[index][2],
              ),
            0,
          ) / motion.speedMetersPerSecond
      const frame = controller.advance(travel + 0.001)
      expect(frame.completedMotionId).toBe(motion.id)
      const arrived = { ...live, ...frame, agentId: id }
      views.set(id, arrived)
      bridge.onSpatialEvent(runtime.getSnapshot(), arrived, views)
      for (const command of bridge.drainFeedback())
        expect(runtime.dispatch(command).ok).toBe(true)
      expect(runtime.getSnapshot().tasks[task.id].status).toBe('in_progress')
      expect(runtime.getSnapshot().tasks[task.id].progressPercent).toBe(17)
      expect(runtime.getSnapshot().agents[id].destination).toBeNull()
      controller.update(
        presentedAgents(bridge.project(runtime.getSnapshot(), views)!).find(
          (agent) => agent.id === id,
        )!,
      )
      expect(controller.advance(12).clip).toBe(
        id === 'manager' ? 'seated_work' : 'seated_work_hard',
      )
    },
  )
  it('keeps disconnected production empty and projects only supplied runtime context', () => {
    const bridge = createOfficeRuntimeBridge(),
      state = fixture(),
      views = new Map<string, AgentSpatialSnapshot>()
    expect(
      bridge.project({ ...state, connection: 'disconnected' }, views),
    ).toBeNull()
    const projected = bridge.project(state, views)!
    expect(projected.agents.worker).toMatchObject({
      name: 'Worker One',
      role: 'Engineer',
      manager: 'Company Manager',
      status: 'queued',
      task: {
        id: 'task-primary',
        title: 'Explicit local task',
        description: 'Supplied task description',
        status: 'in_progress',
        progressPercent: 17,
      },
      dependencies: [{ id: 'task-dependency', title: 'Supplied prerequisite' }],
      activity: [
        {
          id: 'activity-1',
          occurredAt: now,
          summary: 'Explicit progress changed to 17 percent.',
        },
      ],
      artifacts: null,
      cost: null,
      providerUsage: null,
    })
    expect(projected.agents.manager).toMatchObject({
      kind: 'manager',
      manager: null,
      task: null,
    })
    expect(projected.departments.engineering.agentIds).toEqual(['worker'])
    expect(bridge.drainFeedback()).toEqual([])
  })

  it('reuses the entire snapshot on selection-only changes and unchanged contexts on progress changes', () => {
    const bridge = createOfficeRuntimeBridge(),
      state = fixture(),
      views = new Map<string, AgentSpatialSnapshot>()
    const first = bridge.project(state, views)!,
      counts = bridge.getMetrics()
    expect(
      bridge.project(
        { ...state, revision: 2, selectedAgentId: 'manager' },
        views,
      ),
    ).toBe(first)
    expect(bridge.getMetrics()).toEqual(counts)
    const task = state.tasks['task-primary']
    const changed = bridge.project(
      {
        ...state,
        tasks: { ...state.tasks, [task.id]: { ...task, progressPercent: 33 } },
      },
      views,
    )!
    expect(changed.agents.worker.task?.progressPercent).toBe(33)
    expect(changed.agents.manager).toBe(first.agents.manager)
    expect(changed.departments.engineering).toBe(first.departments.engineering)
  })

  it('projects a bounded recent activity window without truncating the runtime log', () => {
    const bridge = createOfficeRuntimeBridge(),
      state = fixture()
    const activities = Array.from({ length: 23 }, (_, index) => ({
      ...state.activities[0],
      id: `activity-${index}`,
      summary: `Recorded event ${index}`,
    }))
    const expanded = { ...state, activities }
    const result = bridge.project(expanded, new Map())!
    expect(result.agents.worker.activity).toHaveLength(
      RECENT_RUNTIME_ACTIVITY_LIMIT,
    )
    expect(result.agents.worker.activity?.[0]?.id).toBe('activity-22')
    expect(result.agents.worker.activity?.at(-1)?.id).toBe('activity-13')
    expect(expanded.activities).toHaveLength(23)
    expect(result.agents.manager.activity).toEqual([])
  })

  it('defers an intent until the actor mounts, then plans once from its live position', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(fixture(), {
      status: 'working',
      destination: intent(),
    })
    const views = new Map<string, AgentSpatialSnapshot>()
    expect(bridge.project(state, views)!.agents.worker.motion).toBeUndefined()
    expect(bridge.project(state, views)!.agents.worker.destinationId).toBe(
      station.id,
    )
    expect(bridge.getMetrics().plans).toBe(0)
    const live = view(state, 'worker', { position: [0, 0, 2] })
    views.set('worker', live)
    expect(bridge.onSpatialEvent(state, live, views)).toBe(true)
    const planned = bridge.project(state, views)!
    expect(planned.agents.worker.status).toBe('working')
    expect(planned.agents.worker.motion?.points[0]).toEqual([0, 0, 2])
    expect(planned.agents.worker.motion?.destination?.id).toBe(
      'workstation:worker',
    )
    const metrics = bridge.getMetrics()
    for (let index = 0; index < 10; index++) {
      live.position = [0, 0, 2 + index / 100]
      expect(bridge.project(state, views)).toBe(planned)
    }
    expect(bridge.getMetrics()).toEqual(metrics)
  })

  it.each<OfficeAgentStatus>(['queued', 'walking', 'blocked', 'repair'])(
    'uses a safe standing seed for a pre-mount %s input at the old seat',
    (status) => {
      const bridge = createOfficeRuntimeBridge()
      const state = changeAgent(fixture(), {
        status,
        position: seatedWorkstationAnchor(station),
      })
      const projected = bridge.project(state, new Map())!
      expect(projected.agents.worker.position).toEqual(
        standingWorkstationAnchor(station),
      )
      expect(
        createCharacterMotion(presentedAgents(projected)[0]).advance(0)
          .position,
      ).toEqual(standingWorkstationAnchor(station))
      const mounted = view(state, 'worker', { position: [2, 0, 2] })
      const updated = changeAgent(state, {
        status: 'working',
        destination: intent(),
      })
      const route = bridge.project(updated, new Map([['worker', mounted]]))!
        .agents.worker.motion!
      expect(route.points[0]).toEqual(mounted.position)
    },
  )

  it.each(['worker', 'manager'] as const)(
    'acknowledges an occupied desk without a zero route and keeps %s working behavior',
    (id) => {
      const bridge = createOfficeRuntimeBridge()
      const desk = id === 'worker' ? station : executiveStation
      const state = changeAgent(
        fixture(),
        {
          status: 'working',
          position: seatedWorkstationAnchor(desk),
          destination: intent({ destinationId: desk.id }),
        },
        id,
      )
      const live = view(state, id, { phase: 'seated' })
      const projected = bridge.project(state, new Map([[id, live]]))!
      expect(projected.agents[id].motion).toBeUndefined()
      expect(bridge.drainFeedback()).toEqual([
        {
          type: 'arrive',
          agentId: id,
          intentId: 'intent-1',
          position: live.position,
          headingRadians: live.headingRadians,
        },
      ])
      const frame = createCharacterMotion(
        presentedAgents(projected).find((agent) => agent.id === id)!,
      ).advance(0)
      expect(frame.clip).toBe(id === 'manager' ? 'seated_work' : 'headband_on')
      bridge.onSpatialEvent(state, live, new Map([[id, live]]))
      expect(bridge.drainFeedback()).toEqual([])
    },
  )

  it('uses a seated actor’s calibrated exit for departure and emits only matching arrival feedback', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(fixture(), {
      status: 'walking',
      position: seatedWorkstationAnchor(station),
      destination: intent({
        destinationType: 'hub',
        destinationId: 'hub:central',
        arrivalStatus: 'collaborating',
      }),
    })
    const live = view(state, 'worker', { phase: 'removing' }),
      views = new Map([['worker', live]])
    const command = bridge.project(state, views)!.agents.worker.motion!
    expect(command.points[0]).toEqual(standingWorkstationAnchor(station))
    expect(command.destination?.position).toEqual([0, 0, 3])
    bridge.onSpatialEvent(
      state,
      { ...live, motionId: 'stale', completedMotionId: 'stale' },
      views,
    )
    expect(bridge.drainFeedback()).toEqual([])
    const arrived = {
      ...live,
      phase: 'standing',
      position: command.points.at(-1)!,
      motionId: command.id,
      completedMotionId: command.id,
      headingRadians: 1.2,
    }
    bridge.onSpatialEvent(state, arrived, views)
    expect(bridge.drainFeedback()).toEqual([
      {
        type: 'arrive',
        agentId: 'worker',
        intentId: 'intent-1',
        position: [0, 0, 3],
        headingRadians: 1.2,
      },
    ])
    expect(state.tasks['task-primary'].status).toBe('in_progress')
    expect(state.agents.worker.status).toBe('walking')
    bridge.onSpatialEvent(state, arrived, views)
    expect(bridge.drainFeedback()).toEqual([])
  })

  it('retains a paused route, ignores stale or paused arrival, and drops canceled feedback', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(fixture(), {
      status: 'walking',
      destination: intent({
        destinationType: 'hub',
        destinationId: 'hub:central',
      }),
    })
    const live = view(state),
      views = new Map([['worker', live]])
    const command = bridge.project(state, views)!.agents.worker.motion!
    const blocked = changeAgent(state, { status: 'blocked' })
    expect(bridge.project(blocked, views)!.agents.worker.motion).toBe(command)
    bridge.onSpatialEvent(
      blocked,
      { ...live, motionId: command.id, completedMotionId: command.id },
      views,
    )
    expect(bridge.drainFeedback()).toEqual([])
    const replacement = changeAgent(state, {
      destination: intent({ id: 'intent-2' }),
    })
    const next = bridge.project(replacement, views)!.agents.worker.motion!
    expect(next.id).not.toBe(command.id)
    bridge.onSpatialEvent(
      replacement,
      { ...live, motionId: command.id, completedMotionId: command.id },
      views,
    )
    expect(bridge.drainFeedback()).toEqual([])
    bridge.onSpatialEvent(
      replacement,
      { ...live, motionId: next.id, completedMotionId: next.id },
      views,
    )
    const canceled = changeAgent(replacement, {
      destination: null,
      status: 'waiting',
    })
    expect(
      bridge.project(canceled, views)!.agents.worker.motion,
    ).toBeUndefined()
    expect(bridge.drainFeedback()).toEqual([])
  })

  it('reports planner or renderer rejection once without inventing a straight route', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(fixture(), {
      status: 'walking',
      destination: intent({
        destinationType: 'waypoint',
        destinationId: 'missing-node',
      }),
    })
    const live = view(state),
      views = new Map([['worker', live]])
    const rejected = bridge.project(state, views)!.agents.worker
    expect(rejected.motion).toBeUndefined()
    expect(rejected.navigationDiagnostic).toContain('Unknown or obstructed')
    expect(bridge.drainFeedback()).toEqual([
      {
        type: 'rejectMovement',
        agentId: 'worker',
        intentId: 'intent-1',
        reason: rejected.navigationDiagnostic,
      },
    ])
    bridge.project(state, views)
    expect(bridge.drainFeedback()).toEqual([])
    const retry = changeAgent(state, {
      destination: intent({ id: 'intent-retry' }),
    })
    const accepted = bridge.project(retry, views)!.agents.worker.motion!
    bridge.onSpatialEvent(
      retry,
      {
        ...live,
        motionId: accepted.id,
        diagnostic: 'Movement path no longer contains current pose.',
      },
      views,
    )
    expect(bridge.project(retry, views)!.agents.worker.motion).toBeUndefined()
    expect(bridge.drainFeedback()[0]).toMatchObject({
      type: 'rejectMovement',
      intentId: 'intent-retry',
    })
  })

  it('waits for a collaboration target’s live pose and approaches without changing runtime collaborators', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(
      changeAgent(
        fixture(),
        { position: [0, 0, 6], status: 'collaborating' },
        'manager',
      ),
      {
        status: 'walking',
        destination: intent({
          destinationType: 'agent',
          destinationId: 'manager',
          arrivalStatus: 'collaborating',
        }),
      },
    )
    const live = view(state),
      views = new Map([['worker', live]])
    expect(bridge.project(state, views)!.agents.worker.motion).toBeUndefined()
    const target = view(state, 'manager', { phase: 'standing' })
    views.set('manager', target)
    expect(bridge.onSpatialEvent(state, target, views)).toBe(true)
    const projected = bridge.project(state, views)!.agents.worker
    const endpoint = projected.motion!.points.at(-1)!
    expect(
      Math.hypot(
        endpoint[0] - target.position[0],
        endpoint[2] - target.position[2],
      ),
    ).toBeCloseTo(0.85)
    expect(projected.collaborationTargetId).toBe('manager')
    expect(projected.collaborator).toBeNull()
  })

  it('replans once after furniture changes and rejects an unsafe current location', () => {
    const bridge = createOfficeRuntimeBridge()
    const state = changeAgent(fixture(), {
      status: 'walking',
      destination: intent({
        destinationType: 'hub',
        destinationId: 'hub:central',
      }),
    })
    const views = new Map([['worker', view(state)]])
    expect(bridge.project(state, views)!.agents.worker.motion).toBeDefined()
    const movedDesk = { ...executiveStation, position: [0, 0, 1.5] as const }
    const changed = {
      ...state,
      workstations: { ...state.workstations, [movedDesk.id]: movedDesk },
    }
    const rejected = bridge.project(changed, views)!.agents.worker
    expect(rejected.motion).toBeUndefined()
    expect(rejected.navigationDiagnostic).toContain('Current position')
    expect(bridge.getMetrics()).toMatchObject({ plans: 2, graphBuilds: 2 })
    expect(bridge.drainFeedback()[0]?.type).toBe('rejectMovement')
  })
})
