import type {
  AgentRuntimeContext,
  AgentRuntimePosition,
  OfficeAgentStatus,
  WorldPosition,
} from '../office/officeState'
import type {
  ExecutionPlan,
  ManagerRequest,
  OrchestrationCommand,
} from '../orchestration/orchestrationTypes'

export type RuntimeTaskStatus =
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type RuntimeTaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type RuntimeJson =
  | null
  | boolean
  | number
  | string
  | readonly RuntimeJson[]
  | { readonly [key: string]: RuntimeJson }

/** An authoritative intent. The spatial bridge resolves destinations and routes. */
export interface AgentSpatialIntent {
  readonly id: string
  readonly destinationType: 'workstation' | 'hub' | 'agent' | 'waypoint'
  readonly destinationId: string
  readonly movementReason: string
  readonly arrivalStatus: 'working' | 'waiting' | 'collaborating'
  readonly collaboratorIds: readonly string[]
}

export interface RuntimeAgent extends Readonly<AgentRuntimePosition> {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly departmentId: string
  readonly kind: AgentRuntimeContext['kind']
  readonly capabilities: readonly string[]
  readonly status: OfficeAgentStatus
  readonly workstationId: string | null
  readonly managerId: string | null
  readonly currentTaskId: string | null
  readonly destination: Readonly<AgentSpatialIntent> | null
  readonly collaboratorIds: readonly string[]
  readonly blockers: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RuntimeTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: RuntimeTaskStatus
  readonly priority: RuntimeTaskPriority
  readonly progressPercent: number
  readonly assignedAgentId: string | null
  readonly dependencyIds: readonly string[]
  readonly parentTaskId: string | null
  readonly statusReason: string | null
  /** Only dependency-induced waits may be released automatically when prerequisites finish. */
  readonly waitingForDependencies: boolean
  readonly metadata: Readonly<Record<string, RuntimeJson>>
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly failedAt: string | null
  readonly cancelledAt: string | null
}

export interface RuntimeDepartment {
  readonly id: string
  readonly name: string
  readonly description: string | null
}

export interface RuntimeWorkstation extends Readonly<AgentRuntimePosition> {
  readonly id: string
  readonly departmentId: string | null
}

/** Changed records are complete after-images. No entity deletion commands exist yet. */
export interface RuntimeBusinessChanges {
  readonly agents?: Readonly<Record<string, Readonly<RuntimeAgent>>>
  readonly tasks?: Readonly<Record<string, Readonly<RuntimeTask>>>
  readonly workstations?: Readonly<Record<string, Readonly<RuntimeWorkstation>>>
  readonly departments?: Readonly<Record<string, Readonly<RuntimeDepartment>>>
  readonly connection?: 'disconnected' | 'local'
  readonly requests?: Readonly<Record<string, Readonly<ManagerRequest>>>
  readonly plans?: Readonly<Record<string, Readonly<ExecutionPlan>>>
}

export type RuntimeEventType =
  | 'RUNTIME_CONNECTED'
  | 'RUNTIME_DISCONNECTED'
  | 'DEPARTMENT_REGISTERED'
  | 'WORKSTATION_REGISTERED'
  | 'AGENT_REGISTERED'
  | 'TASK_CREATED'
  | 'TASK_ASSIGNED'
  | 'TASK_DEPENDENCIES_CHANGED'
  | 'TASK_PROGRESS_UPDATED'
  | 'TASK_READY'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELLED'
  | 'AGENT_STARTED'
  | 'AGENT_WAITING'
  | 'AGENT_WALKING'
  | 'AGENT_ARRIVED'
  | 'AGENT_COLLABORATING'
  | 'AGENT_BLOCKED'
  | 'AGENT_REPAIR_STARTED'
  | 'AGENT_REPAIRED'
  | 'REQUEST_RECEIVED'
  | 'PLANNING_STARTED'
  | 'PLAN_ACCEPTED'
  | 'PLAN_REJECTED'
  | 'PLAN_DISPATCHED'
  | 'PLAN_STATUS_CHANGED'
  | 'REQUEST_CANCELLED'

export interface RuntimeEvent {
  readonly id: string
  readonly type: RuntimeEventType
  readonly occurredAt: string
  readonly agentId: string | null
  readonly taskId: string | null
  readonly payload: Readonly<Record<string, RuntimeJson>>
  /** Apply these after-images in committed event order; UI selections are excluded. */
  readonly changes: Readonly<RuntimeBusinessChanges>
  /** One command's events publish atomically. UI-only commits may leave revision gaps. */
  readonly transactionRevision: number
  readonly transactionEventIndex: number
  readonly transactionEventCount: number
}

export interface RuntimeActivity {
  readonly id: string
  readonly eventId: string
  readonly occurredAt: string
  readonly agentId: string | null
  readonly taskId: string | null
  readonly summary: string
}

export interface RuntimeState {
  readonly connection: 'disconnected' | 'local'
  readonly revision: number
  readonly agents: Readonly<Record<string, Readonly<RuntimeAgent>>>
  readonly tasks: Readonly<Record<string, Readonly<RuntimeTask>>>
  readonly workstations: Readonly<Record<string, Readonly<RuntimeWorkstation>>>
  readonly departments: Readonly<Record<string, Readonly<RuntimeDepartment>>>
  readonly requests: Readonly<Record<string, Readonly<ManagerRequest>>>
  readonly plans: Readonly<Record<string, Readonly<ExecutionPlan>>>
  readonly events: readonly Readonly<RuntimeEvent>[]
  readonly activities: readonly Readonly<RuntimeActivity>[]
  readonly selectedAgentId: string | null
  readonly selectedTaskId: string | null
}

export interface RegisterAgentInput extends Readonly<AgentRuntimePosition> {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly departmentId: string
  readonly kind: RuntimeAgent['kind']
  readonly capabilities?: readonly string[]
  readonly status?: OfficeAgentStatus
  readonly workstationId?: string | null
  readonly managerId?: string | null
}

export interface CreateTaskInput {
  readonly id?: string
  readonly title: string
  readonly description?: string
  readonly priority?: RuntimeTaskPriority
  readonly dependencyIds?: readonly string[]
  readonly parentTaskId?: string | null
  readonly metadata?: Readonly<Record<string, RuntimeJson>>
}

export type RuntimeCommand =
  | OrchestrationCommand
  | { readonly type: 'connect' | 'disconnect' }
  | {
      readonly type: 'registerDepartment'
      readonly department: Omit<RuntimeDepartment, 'description'> & {
        readonly description?: string | null
      }
    }
  | {
      readonly type: 'registerWorkstation'
      readonly workstation: Omit<RuntimeWorkstation, 'departmentId'> & {
        readonly departmentId?: string | null
      }
    }
  | { readonly type: 'registerAgent'; readonly agent: RegisterAgentInput }
  | { readonly type: 'createTask'; readonly task: CreateTaskInput }
  | {
      readonly type: 'assignTask'
      readonly taskId: string
      readonly agentId: string
    }
  | { readonly type: 'startTask' | 'completeTask'; readonly taskId: string }
  | {
      readonly type: 'updateProgress'
      readonly taskId: string
      readonly progressPercent: number
    }
  | {
      readonly type: 'failTask' | 'waitTask' | 'blockTask'
      readonly taskId: string
      readonly reason: string
    }
  | {
      readonly type: 'cancelTask'
      readonly taskId: string
      readonly reason?: string
    }
  | {
      readonly type: 'setTaskDependencies'
      readonly taskId: string
      readonly dependencyIds: readonly string[]
    }
  | {
      readonly type: 'beginRepair' | 'repairAgent'
      readonly agentId: string
      readonly reason: string
    }
  | ({
      readonly type: 'requestMovement'
      readonly agentId: string
      readonly intentId?: string
      readonly collaboratorIds?: readonly string[]
    } & Omit<AgentSpatialIntent, 'id' | 'collaboratorIds'>)
  | {
      readonly type: 'arrive'
      readonly agentId: string
      readonly intentId: string
      readonly position: WorldPosition
      readonly headingRadians: number
    }
  | {
      readonly type: 'rejectMovement'
      readonly agentId: string
      readonly intentId: string
      readonly reason: string
    }
  | { readonly type: 'selectAgent'; readonly agentId: string | null }
  | { readonly type: 'selectTask'; readonly taskId: string | null }

export type RuntimeResult =
  | { readonly ok: true; readonly state: RuntimeState }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

/** A synchronous transaction boundary, deliberately independent of persistence technology. */
export interface OfficeRuntimeRepository {
  read(): RuntimeState | null
  /** Must either persist the complete snapshot or throw without modifying storage. */
  write(snapshot: RuntimeState): void
}

export interface OfficeRuntimeOptions {
  readonly repository?: OfficeRuntimeRepository
  readonly now?: () => string
  readonly nextId?: (scope: string) => string
}

export interface RuntimeMetrics {
  readonly commands: number
  readonly commits: number
  readonly notifications: number
  readonly subscribers: number
  readonly rejectedCommands: number
}
