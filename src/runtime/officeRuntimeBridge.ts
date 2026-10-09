import {
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from '../office/characterMotion'
import {
  createOfficeNavigation,
  type NavigationPlan,
  type OfficeNavigation,
} from '../office/officeNavigation'
import type {
  AgentContext,
  AgentMotion,
  AgentRuntimeActivity,
  AgentSpatialSnapshot,
  DepartmentContext,
  OfficeRuntimeSnapshot,
  WorldPosition,
} from '../office/officeState'
import type {
  AgentSpatialIntent,
  RuntimeAgent,
  RuntimeCommand,
  RuntimeState,
} from './runtimeTypes'

export type RuntimeSpatialFeedback = Extract<
  RuntimeCommand,
  { type: 'arrive' | 'rejectMovement' }
>

export const RECENT_RUNTIME_ACTIVITY_LIMIT = 10

type SpatialViews = ReadonlyMap<string, AgentSpatialSnapshot>
interface RouteEntry {
  intent: Readonly<AgentSpatialIntent>
  stage: 'deferred' | 'planned' | 'settling' | 'arrived' | 'rejected'
  motion?: Readonly<AgentMotion>
  diagnostic?: string
  graphKey: string
}

const seatedPhases = new Set([
  'seated',
  'sitting',
  'standing-up',
  'equipping',
  'removing',
])
const paused = (agent: RuntimeAgent) =>
  agent.status === 'blocked' || agent.status === 'repair'
const transitionalSeat = (view: AgentSpatialSnapshot) =>
  view.phase === 'sitting' || view.phase === 'standing-up'
const distance = (a: WorldPosition, b: WorldPosition) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function sameValues(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = Object.entries(a),
    right = Object.entries(b)
  return (
    left.length === right.length &&
    left.every(
      ([key, value], index) =>
        key === right[index][0] && sameValues(value, right[index][1]),
    )
  )
}

function sameSources(a: RuntimeState | undefined, b: RuntimeState) {
  return (
    a?.connection === b.connection &&
    a.agents === b.agents &&
    a.tasks === b.tasks &&
    a.workstations === b.workstations &&
    a.departments === b.departments &&
    a.activities === b.activities
  )
}

function sameReferences<T>(
  a: Readonly<Record<string, T>>,
  b: Readonly<Record<string, T>>,
) {
  const ids = Object.keys(a)
  return (
    ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id])
  )
}

/**
 * Local presentation adapter. Planning happens on new intents or changed layout,
 * never on frame ticks; only the runtime may accept feedback or advance tasks.
 */
export function createOfficeRuntimeBridge() {
  let snapshot: OfficeRuntimeSnapshot | null = null
  let previousState: RuntimeState | undefined
  let navigation: OfficeNavigation | undefined
  let graphKey = ''
  let routeSequence = 0
  let revision = 0
  let projectedRevision = -1
  let feedback: RuntimeSpatialFeedback[] = []
  const routes = new Map<string, RouteEntry>()
  const mounted = new Set<string>()
  const metrics = { projections: 0, plans: 0, graphBuilds: 0, feedback: 0 }

  function enqueue(command: RuntimeSpatialFeedback) {
    if (
      feedback.some(
        (pending) =>
          pending.agentId === command.agentId &&
          pending.intentId === command.intentId,
      )
    )
      return
    feedback.push(command)
    metrics.feedback++
  }

  function reject(agent: RuntimeAgent, entry: RouteEntry, reason: string) {
    entry.stage = 'rejected'
    entry.motion = undefined
    entry.diagnostic = reason
    enqueue({
      type: 'rejectMovement',
      agentId: agent.id,
      intentId: entry.intent.id,
      reason,
    })
  }

  function arrival(
    agent: RuntimeAgent,
    entry: RouteEntry,
    view: AgentSpatialSnapshot,
  ) {
    entry.stage = 'arrived'
    enqueue({
      type: 'arrive',
      agentId: agent.id,
      intentId: entry.intent.id,
      position: [...view.position],
      headingRadians: view.headingRadians,
    })
  }

  function groundStart(
    agent: RuntimeAgent,
    view: AgentSpatialSnapshot,
    state: RuntimeState,
  ) {
    const station = agent.workstationId
      ? state.workstations[agent.workstationId]
      : undefined
    return seatedPhases.has(view.phase) && station
      ? standingWorkstationAnchor(station)
      : view.position
  }

  function plan(
    agent: RuntimeAgent,
    entry: RouteEntry,
    state: RuntimeState,
    views: SpatialViews,
  ) {
    const view = views.get(agent.id)
    if (!view || paused(agent)) return
    const intent = entry.intent
    const target =
      intent.destinationType === 'agent'
        ? state.agents[intent.destinationId]
        : undefined
    if (intent.destinationType === 'agent' && target && !views.has(target.id))
      return
    metrics.plans++
    const start = groundStart(agent, view, state)
    let result: NavigationPlan
    if (intent.destinationType === 'agent') {
      result =
        !target || target.id === agent.id
          ? {
              ok: false,
              diagnostic:
                'A distinct, registered collaboration target is required.',
            }
          : navigation!.planApproach(
              start,
              groundStart(target, views.get(target.id)!, state),
            )
    } else {
      const owner =
        intent.destinationType === 'workstation'
          ? Object.values(state.agents).find(
              (candidate) => candidate.workstationId === intent.destinationId,
            )
          : undefined
      const destination =
        intent.destinationType === 'workstation'
          ? owner
            ? `workstation:${owner.id}`
            : null
          : intent.destinationId
      result = destination
        ? navigation!.planNavigation(start, destination)
        : {
            ok: false,
            diagnostic:
              'The requested workstation has no registered office placement.',
          }
    }
    entry.graphKey = graphKey
    if (!result.ok) {
      reject(agent, entry, result.diagnostic)
      return
    }
    if (result.distanceMeters <= 0.01) {
      // A seated employee is already at their workstation; never issue a route
      // from the chair exit to itself and unnecessarily make them stand up.
      if (transitionalSeat(view)) entry.stage = 'settling'
      else arrival(agent, entry, view)
      return
    }
    entry.stage = 'planned'
    entry.motion = {
      id: `runtime-motion:${agent.id}:${intent.id}:${++routeSequence}`,
      points: result.points,
      speedMetersPerSecond: 0.85,
      destination: result.destination,
    }
  }

  function deferredReady(state: RuntimeState, views: SpatialViews) {
    return [...routes].some(([id, entry]) => {
      const agent = state.agents[id]
      const view = views.get(id)
      if (entry.stage === 'settling')
        return agent && !paused(agent) && view && !transitionalSeat(view)
      return (
        entry.stage === 'deferred' &&
        agent &&
        !paused(agent) &&
        views.has(id) &&
        (entry.intent.destinationType !== 'agent' ||
          !state.agents[entry.intent.destinationId] ||
          views.has(entry.intent.destinationId))
      )
    })
  }

  function project(
    state: RuntimeState,
    views: SpatialViews,
  ): OfficeRuntimeSnapshot | null {
    if (
      sameSources(previousState, state) &&
      projectedRevision === revision &&
      !deferredReady(state, views)
    )
      return snapshot
    metrics.projections++
    if (state.connection === 'disconnected') {
      routes.clear()
      mounted.clear()
      feedback = []
      snapshot = null
      previousState = state
      projectedRevision = revision
      return null
    }
    const stations = Object.values(state.agents)
      .flatMap((agent) => {
        const station = agent.workstationId
          ? state.workstations[agent.workstationId]
          : undefined
        return station
          ? [
              {
                id: agent.id,
                position: station.position,
                headingRadians: station.headingRadians,
              },
            ]
          : []
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    const nextGraphKey = JSON.stringify(stations)
    if (!navigation || nextGraphKey !== graphKey) {
      navigation = createOfficeNavigation(stations)
      graphKey = nextGraphKey
      metrics.graphBuilds++
    }
    for (const id of routes.keys())
      if (!state.agents[id]?.destination) routes.delete(id)
    feedback = feedback.filter(
      (command) =>
        state.agents[command.agentId]?.destination?.id === command.intentId,
    )

    // The runtime retains its full log; the inspector receives the ten latest
    // real events per employee. Index once instead of scanning history per mesh.
    const recentActivity = new Map<string, AgentRuntimeActivity[]>()
    for (let index = state.activities.length - 1; index >= 0; index--) {
      const activity = state.activities[index]
      if (!activity.agentId || !state.agents[activity.agentId]) continue
      let recent = recentActivity.get(activity.agentId)
      if (!recent) {
        recent = []
        recentActivity.set(activity.agentId, recent)
      }
      if (recent.length < RECENT_RUNTIME_ACTIVITY_LIMIT) {
        const { id, occurredAt, summary } = activity
        recent.push({ id, occurredAt, summary })
      }
    }

    const agents: Record<string, Readonly<AgentContext>> = {}
    for (const agent of Object.values(state.agents)) {
      const station = agent.workstationId
        ? state.workstations[agent.workstationId]
        : undefined
      const view = views.get(agent.id)
      if (view) mounted.add(agent.id)
      const intent = agent.destination
      let entry = routes.get(agent.id)
      if (intent) {
        if (!entry || (entry.intent.id !== intent.id && !paused(agent))) {
          entry = { intent, stage: 'deferred', graphKey }
          routes.set(agent.id, entry)
        }
        if (entry.stage === 'planned' && entry.graphKey !== graphKey) {
          if (!navigation.validatePath(entry.motion!.points).ok) {
            entry.stage = 'deferred'
            entry.motion = undefined
          }
          entry.graphKey = graphKey
        }
        if (entry.stage === 'deferred') plan(agent, entry, state, views)
        if (
          entry.stage === 'settling' &&
          view &&
          !paused(agent) &&
          !transitionalSeat(view)
        )
          arrival(agent, entry, view)
      }
      const task = agent.currentTaskId
        ? state.tasks[agent.currentTaskId]
        : undefined
      const position =
        !mounted.has(agent.id) &&
        station &&
        !['sleeping', 'waiting', 'working'].includes(agent.status) &&
        distance(agent.position, seatedWorkstationAnchor(station)) <= 0.01
          ? standingWorkstationAnchor(station)
          : agent.position
      const context: AgentContext = {
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        role: agent.role,
        departmentId: agent.departmentId,
        status: agent.status,
        position,
        headingRadians: agent.headingRadians,
        workstation: station,
        motion: intent ? entry?.motion : undefined,
        navigationDiagnostic: intent ? entry?.diagnostic : undefined,
        destinationId: intent?.destinationId ?? null,
        collaborationTargetId:
          intent?.destinationType === 'agent' ? intent.destinationId : null,
        manager: agent.managerId
          ? (state.agents[agent.managerId]?.name ?? agent.managerId)
          : null,
        task: task
          ? {
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              progressPercent: task.progressPercent,
            }
          : null,
        dependencies: task
          ? task.dependencyIds.map((id) => ({
              id,
              title: state.tasks[id]?.title ?? null,
            }))
          : null,
        collaborator: agent.collaboratorIds.length
          ? agent.collaboratorIds
              .map((id) => state.agents[id]?.name ?? id)
              .join(', ')
          : null,
        nextAction: intent?.movementReason ?? null,
        blockers: agent.blockers,
        activity: recentActivity.get(agent.id) ?? [],
        artifacts: null,
        providerUsage: null,
        cost: null,
      }
      const previous = snapshot?.agents[agent.id]
      agents[agent.id] =
        previous && sameValues(previous, context) ? previous : context
    }
    const departments: Record<string, Readonly<DepartmentContext>> = {}
    for (const department of Object.values(state.departments)) {
      const members = Object.values(state.agents).filter(
        (agent) => agent.departmentId === department.id,
      )
      const managerIds = [
        ...new Set(
          members.flatMap((agent) =>
            agent.managerId ? [agent.managerId] : [],
          ),
        ),
      ]
      const context: DepartmentContext = {
        ...department,
        manager:
          managerIds.length === 1
            ? (state.agents[managerIds[0]]?.name ?? managerIds[0])
            : null,
        agentIds: members.map((agent) => agent.id),
      }
      const previous = snapshot?.departments[department.id]
      departments[department.id] =
        previous && sameValues(previous, context) ? previous : context
    }
    const next = { agents, departments }
    if (
      !snapshot ||
      !sameReferences(snapshot.agents, agents) ||
      !sameReferences(snapshot.departments, departments)
    )
      snapshot = next
    previousState = state
    projectedRevision = revision
    return snapshot
  }

  function onSpatialEvent(
    state: RuntimeState,
    event: AgentSpatialSnapshot,
    views: SpatialViews,
  ) {
    const before = snapshot
    const agent = state.agents[event.agentId]
    const entry = routes.get(event.agentId)
    if (
      agent &&
      !paused(agent) &&
      entry?.stage === 'planned' &&
      agent.destination?.id === entry.intent.id &&
      event.motionId === entry.motion?.id
    ) {
      if (event.completedMotionId === entry.motion.id) {
        // A frame can finish walking and advance into sit_down before this event.
        // Persisting that intermediate root would not be a valid remount pose.
        // Keep the consumed command until the seated/equipping event reports
        // the actual seat; the motion controller continues sitting independently.
        if (!(
          entry.intent.destinationType === 'workstation' &&
          event.phase === 'sitting'
        ))
          arrival(agent, entry, event)
      } else if (event.diagnostic) reject(agent, entry, event.diagnostic)
      if (entry.stage !== 'planned') revision++
    }
    // The caller owns the mutable scene map; no frame data enters React here.
    project(state, views)
    return snapshot !== before
  }

  return {
    project,
    onSpatialEvent,
    drainFeedback() {
      const pending = feedback
      feedback = []
      return pending
    },
    getMetrics: () => ({ ...metrics }),
  }
}
