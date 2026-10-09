import type {
  RuntimeAgent,
  RuntimeEvent,
  RuntimeTask,
  RuntimeTaskPriority,
} from '../runtime/runtimeTypes'

export type RequestStatus =
  | 'received'
  | 'planning'
  | 'planned'
  | 'executing'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PlanStatus =
  | 'planned'
  | 'executing'
  | 'needs_attention'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RequestInput {
  readonly requestId: string
  readonly title: string
  readonly description: string
  readonly requestedBy: string
  readonly priority: RuntimeTaskPriority
  readonly constraints: readonly string[]
}

export interface OrchestrationIssue {
  readonly code: string
  readonly message: string
  readonly taskId: string | null
  readonly agentId: string | null
}

export interface ManagerRequest extends RequestInput {
  readonly managerId: string
  readonly status: RequestStatus
  readonly planId: string | null
  readonly planningAttemptId: string | null
  readonly coordinationTaskId: string | null
  readonly issues: readonly OrchestrationIssue[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Proposed definitions become ordinary RuntimeTasks; live task state is never copied here. */
export interface PlanTaskProposal {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly priority: RuntimeTaskPriority
  readonly status: 'queued'
  readonly dependencyIds: readonly string[]
  readonly requiredCapabilities: readonly string[]
  readonly preferredAgentId: string | null
}

export interface PlanProposal {
  readonly planId: string
  readonly requestId: string
  readonly objective: string
  readonly tasks: readonly PlanTaskProposal[]
  readonly constraints: readonly string[]
  readonly expectedOutputs: readonly string[]
}

export interface TaskRequirements {
  readonly capabilities: readonly string[]
  readonly preferredAgentId: string | null
}

export interface ExecutionPlan {
  readonly planId: string
  readonly requestId: string
  readonly managerId: string
  readonly objective: string
  readonly taskIds: readonly string[]
  readonly requirements: Readonly<Record<string, Readonly<TaskRequirements>>>
  readonly constraints: readonly string[]
  readonly expectedOutputs: readonly string[]
  readonly status: PlanStatus
  readonly issues: readonly OrchestrationIssue[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Artifact references may be supplied by a future artifact system; none are fabricated. */
export interface ExecutionArtifact {
  readonly id: string
  readonly taskId: string
  readonly title: string
  readonly uri: string | null
}

export interface ExecutionResult {
  readonly requestId: string
  readonly status: PlanStatus
  readonly completedTaskIds: readonly string[]
  readonly failedTaskIds: readonly string[]
  readonly blockedTaskIds: readonly string[]
  readonly artifacts: readonly ExecutionArtifact[]
  readonly summary: string
}

export interface PlanningContext {
  readonly managerId: string
  readonly agents: readonly Readonly<
    Pick<
      RuntimeAgent,
      'id' | 'name' | 'kind' | 'capabilities' | 'status' | 'managerId'
    >
  >[]
  readonly existingTaskIds: readonly string[]
}

/** The only reasoning capability in this phase is a structured proposal, never execution. */
export interface ReasoningProvider {
  plan(
    request: Readonly<ManagerRequest>,
    context: Readonly<PlanningContext>,
  ): Promise<unknown>
}

export type Planner = ReasoningProvider

export interface ManagerContext {
  readonly manager: Readonly<RuntimeAgent> | null
  readonly request: Readonly<ManagerRequest> | null
  readonly plan: Readonly<ExecutionPlan> | null
  readonly activeTasks: readonly Readonly<RuntimeTask>[]
  readonly blockedTasks: readonly Readonly<RuntimeTask>[]
  readonly completedTasks: readonly Readonly<RuntimeTask>[]
  readonly activeAgents: readonly Readonly<RuntimeAgent>[]
  readonly dependencies: Readonly<Record<string, readonly string[]>>
  readonly events: readonly Readonly<RuntimeEvent>[]
  readonly result: Readonly<ExecutionResult> | null
}

export type OrchestrationCommand =
  | {
      readonly type: 'receiveRequest'
      readonly managerId: string
      readonly request: RequestInput
    }
  | {
      readonly type: 'beginPlanning'
      readonly managerId: string
      readonly requestId: string
    }
  | {
      readonly type: 'acceptPlan'
      readonly managerId: string
      readonly requestId: string
      readonly attemptId: string
      readonly proposal: unknown
    }
  | {
      readonly type: 'rejectPlan'
      readonly managerId: string
      readonly requestId: string
      readonly attemptId: string
      readonly reason: string
    }
  | {
      readonly type: 'dispatchPlanTask'
      readonly managerId: string
      readonly planId: string
      readonly taskId: string
      readonly agentId: string
    }
  | {
      readonly type: 'recordDispatchIssue'
      readonly managerId: string
      readonly planId: string
      readonly issue: OrchestrationIssue
    }
  | {
      readonly type: 'synchronizePlan'
      readonly managerId: string
      readonly planId: string
    }
  | {
      readonly type: 'cancelRequest'
      readonly managerId: string
      readonly requestId: string
      readonly reason: string
    }
