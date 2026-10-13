import type { WorldPosition } from '../office/officeState'

export type RecruitmentAdapterMode =
  | 'openai'
  | 'mock-success'
  | 'mock-capability-failure'
  | 'mock-technical-failure'
export interface RecruitmentSkill {
  readonly id: string
  readonly description: string
  readonly mandatory: boolean
  readonly prompt: string
  readonly expectedIncludes: readonly string[]
}
export interface RecruitmentSpec {
  readonly name: string
  readonly role: string
  readonly departmentId: string
  readonly mission: string
  readonly responsibilities: readonly string[]
  readonly skills: readonly RecruitmentSkill[]
  readonly instructions: string
  readonly personality: string
  readonly modelId: string
  readonly providerId: string
  readonly toolIds: readonly string[]
  readonly memoryScopes: readonly string[]
  readonly knowledgeIds: readonly string[]
  readonly collaboratorIds: readonly string[]
  readonly managerId: string
  readonly budgetMicros: number
  readonly maxOutputUnits: number
  readonly adapterMode: RecruitmentAdapterMode
}
export type RecruitmentState =
  | 'requested'
  | 'pending_ceo_approval'
  | 'changes_requested'
  | 'approved'
  | 'candidate_arriving'
  | 'interview_in_progress'
  | 'agent_configuration_created'
  | 'runtime_initializing'
  | 'capability_checks_running'
  | 'capability_checks_passed'
  | 'capability_checks_failed'
  | 'recruitment_committing'
  | 'employee_activating'
  | 'hired'
  | 'rejected'
  | 'technical_failure'
  | 'pending_retry'
  | 'cancelled'
export interface RecruitmentProposal {
  readonly version: number
  readonly spec: RecruitmentSpec
  readonly createdAt: string
  readonly createdBy: string
}
export interface RecruitmentApproval {
  readonly version: number
  readonly decision: 'approve' | 'reject' | 'changes'
  readonly actorId: string
  readonly reason: string
  readonly occurredAt: string
}
export interface RecruitmentAssessmentInput {
  readonly testId: string
  readonly status: 'passed' | 'failed' | 'blocked'
  readonly mode: 'live' | 'simulation'
  readonly evidence: readonly string[]
}
export interface RecruitmentAssessment extends RecruitmentAssessmentInput {
  readonly assessmentId: string
  readonly attempt: number
  readonly version: number
  readonly occurredAt: string
}
export interface RecruitmentFailure {
  readonly code: string
  readonly stage: RecruitmentState
  readonly retryable: boolean
  readonly attempt: number
  readonly occurredAt: string
}
export interface RecruitmentScene {
  readonly phase:
    | 'arrival'
    | 'interview'
    | 'waiting'
    | 'welcome'
    | 'workstation'
    | 'exit'
    | 'departed'
  readonly intentId: string
  readonly from: WorldPosition
  readonly to: WorldPosition
  readonly headingRadians: number
  readonly arrived: boolean
}
export interface RecruitmentSession {
  readonly recruitmentId: string
  readonly candidateId: string
  readonly requestedBy: string
  readonly state: RecruitmentState
  readonly proposals: readonly RecruitmentProposal[]
  readonly approvedVersion: number | null
  readonly approvals: readonly RecruitmentApproval[]
  readonly assessments: readonly RecruitmentAssessment[]
  readonly failures: readonly RecruitmentFailure[]
  readonly attempt: number
  readonly maxAttempts: number
  readonly scene: RecruitmentScene | null
  readonly workstationId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
export interface EmployeeRecord {
  readonly employeeId: string
  readonly agentId: string
  readonly recruitmentId: string
  readonly status: 'active' | 'terminated'
  readonly mode: 'live' | 'simulation'
  readonly currentVersion: number
  readonly versions: readonly RecruitmentProposal[]
  readonly activatedAt: string
  readonly terminatedAt: string | null
  readonly terminationReason: string | null
}
export interface RecruitmentPolicy {
  readonly ceoIds: readonly string[]
  readonly managerIds: readonly string[]
  readonly serviceIds: readonly string[]
}
interface SessionCommand {
  readonly actorId: string
  readonly recruitmentId: string
}
interface ApprovedCommand extends SessionCommand {
  readonly approvedVersion: number
}
export type RecruitmentCommand =
  | (SessionCommand & {
      readonly type: 'requestRecruitment'
      readonly candidateId: string
      readonly spec: RecruitmentSpec
    })
  | (SessionCommand & {
      readonly type: 'reviseRecruitment'
      readonly spec: RecruitmentSpec
    })
  | (SessionCommand & {
      readonly type: 'decideRecruitment'
      readonly version: number
      readonly decision: RecruitmentApproval['decision']
      readonly reason: string
    })
  | (ApprovedCommand & {
      readonly type: 'advanceRecruitment'
      readonly state: RecruitmentState
    })
  | (ApprovedCommand & {
      readonly type: 'recordRecruitmentAssessment'
      readonly assessment: RecruitmentAssessmentInput
    })
  | (ApprovedCommand & {
      readonly type: 'failRecruitment'
      readonly code: string
      readonly stage: RecruitmentState
      readonly retryable: boolean
    })
  | (SessionCommand & { readonly type: 'retryRecruitment' })
  | (SessionCommand & {
      readonly type: 'cancelRecruitment'
      readonly reason: string
    })
  | (ApprovedCommand & {
      readonly type: 'activateRecruitment'
      readonly workstationId: string
      readonly position: WorldPosition
      readonly headingRadians: number
    })
  | {
      readonly type: 'terminateEmployee'
      readonly actorId: string
      readonly employeeId: string
      readonly reason: string
    }
  | (SessionCommand & {
      readonly type: 'setRecruitmentScene'
      readonly scene: RecruitmentScene
    })
  | (SessionCommand & {
      readonly type: 'arriveRecruitmentScene'
      readonly intentId: string
    })

export class RecruitmentFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function currentProposal(
  session: RecruitmentSession,
): RecruitmentProposal {
  const proposal = session.proposals.at(-1)
  if (!proposal)
    throw new RecruitmentFault(
      'INVALID_RECRUITMENT',
      'Recruitment proposal is unavailable.',
    )
  return proposal
}

export function recruitmentInstructions(spec: RecruitmentSpec): string {
  return `${spec.instructions}\nRole: ${spec.role}\nMission: ${spec.mission}\nResponsibilities: ${spec.responsibilities.join('; ')}\nWorking style: ${spec.personality}\nRespond with the requested work sample only. You cannot execute tools or grant permissions.`
}
/** Authored open-office interview anchor, shared by host validation and runtime. */
export const RECRUITMENT_MANAGER_INTERVIEW_POSITION = [0.8, 0, 10] as const
