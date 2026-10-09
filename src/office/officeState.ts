/** Read-only input from the future normalized state layer. No simulation lives here. */
export type WorldPosition = readonly [number, number, number]
export type OfficeAgentStatus =
  | 'sleeping'
  | 'queued'
  | 'working'
  | 'walking'
  | 'collaborating'
  | 'waiting'
  | 'completed'
  | 'blocked'
  | 'repair'

export type OfficeSelection =
  | { kind: 'company' }
  | { kind: 'department'; id: string }
  | { kind: 'agent'; id: string }

export type OfficeSelectionHandler = (selection: OfficeSelection) => void

/** Y-up meters and radians; this is a spatial pose, not a task/runtime status. */
export interface AgentRuntimePosition {
  position: WorldPosition
  headingRadians: number
}

export interface AgentRuntimeWorkstation extends AgentRuntimePosition {
  id?: string
}

export interface AgentSpatialDestination {
  id: string | null
  position: WorldPosition
}

/** Explicit ground route. Change id to issue a new command; repeated ids do not restart it. */
export interface AgentMotion {
  id: string
  points: readonly WorldPosition[]
  speedMetersPerSecond: number
  destination?: Readonly<AgentSpatialDestination>
}

export interface AgentRuntimeTask {
  id: string
  title: string
  description: string
  progressPercent: number | null
}

export interface AgentRuntimeActivity {
  id: string
  occurredAt: string
  summary: string
}

export interface AgentRuntimeDependency {
  id: string
  title?: string | null
}

export interface AgentRuntimeContext extends AgentRuntimePosition {
  id: string
  kind: 'standard-worker' | 'manager'
  name: string
  role: string
  departmentId: string
  status: OfficeAgentStatus
  /** Assigned desk stays fixed while the worker's ground position changes. */
  workstation?: Readonly<AgentRuntimeWorkstation>
  motion?: Readonly<AgentMotion>
  /** Explicit visual destination entity; does not fabricate a runtime collaborator. */
  collaborationTargetId?: string | null
  manager: string | null
  task: Readonly<AgentRuntimeTask> | null
  /** String IDs remain supported for existing normalized snapshots. */
  dependencies: readonly (string | Readonly<AgentRuntimeDependency>)[] | null
  collaborator: string | null
  nextAction: string | null
  blockers: readonly string[] | null
  activity: readonly Readonly<AgentRuntimeActivity>[] | null
  artifacts: readonly { id: string; title: string; url: string | null }[] | null
  providerUsage:
    | readonly {
        provider: string
        model: string
        requests: number | null
        tokens: number | null
      }[]
    | null
  cost: { amount: number; currency: string } | null
}

/** Compatibility name retained for existing snapshot producers and consumers. */
export type AgentContext = AgentRuntimeContext

/**
 * Local deterministic presentation feedback, never authoritative business state.
 * Mutable scene refs may update each frame; inspectors receive copied snapshots
 * only on selection, discrete movement events, or an explicit refresh.
 */
export interface AgentSpatialSnapshot extends AgentRuntimePosition {
  agentId: string
  workstation: Readonly<AgentRuntimeWorkstation> | null
  destination: Readonly<AgentSpatialDestination> | null
  movementState: 'stationary' | 'turning' | 'moving' | 'paused'
  speedMetersPerSecond: number
  /** Normalized path distance, 0..1; null means no path progress is available. */
  pathProgress: number | null
  collaborationTargetId: string | null
  phase: string
  diagnostic: string | null
  motionId: string | null
  /** Arrival feedback for a consumed local route; not task completion. */
  completedMotionId: string | null
}

export interface DepartmentContext {
  id: string
  name: string
  description: string | null
  manager: string | null
  agentIds: readonly string[]
}

export interface OfficeRuntimeSnapshot {
  agents: Readonly<Record<string, Readonly<AgentContext>>>
  departments: Readonly<Record<string, Readonly<DepartmentContext>>>
}

export function safeArtifactUrl(value: string | null) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.username || url.password) return undefined
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
