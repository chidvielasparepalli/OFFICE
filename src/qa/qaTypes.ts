import type { RuntimeJson, RuntimeTaskPriority } from '../runtime/runtimeTypes'

export type QAStatus =
  'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled'
export type QASeverity = 'info' | 'warning' | 'error' | 'critical'
export type QACheckType =
  | 'functional'
  | 'correctness'
  | 'structure'
  | 'requirement-compliance'
  | 'formatting'
  | 'security'
  | 'performance'
  | 'accessibility'
export type QAAssertion =
  | { readonly kind: 'exists'; readonly path: readonly string[] }
  | {
      readonly kind: 'equals'
      readonly path: readonly string[]
      readonly value: RuntimeJson
    }
  | {
      readonly kind: 'includes'
      readonly path: readonly string[]
      readonly value: string
    }
  | {
      readonly kind: 'maximum'
      readonly path: readonly string[]
      readonly value: number
    }
  | { readonly kind: 'no-credentials'; readonly path: readonly string[] }

export interface QACheck {
  readonly checkId: string
  readonly title: string
  readonly type: QACheckType
  readonly required: boolean
  readonly severity: QASeverity
  readonly toolId: string
  readonly input: RuntimeJson
  readonly assertion: QAAssertion
}
export interface QARequestInput {
  readonly qaId?: string
  readonly taskId: string
  readonly requestedBy: string
  readonly scope: string
  readonly artifactId?: string | null
  readonly checks: readonly QACheck[]
  readonly priority?: RuntimeTaskPriority
  readonly repairCapabilities: readonly string[]
  readonly maxRepairAttempts?: number
}
export interface ArtifactQABinding {
  readonly artifactId: string
  readonly version: number
  readonly sha256: string
}
export interface QAEvidence {
  readonly executionId: string
  readonly toolId: string
  readonly path: readonly string[]
  readonly matched: boolean | null
  readonly errorCode: string | null
}
export interface QAFinding {
  readonly findingId: string
  readonly checkId: string
  readonly title: string
  readonly description: string
  readonly severity: QASeverity
  readonly evidence: readonly QAEvidence[]
  readonly affectedTaskId: string
  readonly affectedArtifactId: string | null
  readonly suggestedRepairType: QACheckType | null
}
export interface QACheckResult {
  readonly checkId: string
  readonly status: 'passed' | 'failed' | 'blocked'
  readonly evidence: readonly QAEvidence[]
}
export interface QAResult {
  readonly qaId: string
  readonly status: Exclude<QAStatus, 'queued' | 'running'>
  readonly checks: readonly QACheckResult[]
  readonly passedChecks: readonly string[]
  readonly failedChecks: readonly string[]
  readonly findings: readonly QAFinding[]
  readonly evidence: readonly QAEvidence[]
  readonly severity: QASeverity
  readonly verifier: {
    readonly agentId: string
    readonly taskId: string
  } | null
  readonly startedAt: string | null
  readonly completedAt: string
  readonly artifactBinding?: ArtifactQABinding
}
export interface QARequest {
  readonly qaId: string
  readonly taskId: string
  readonly agentId: string | null
  readonly requestedBy: string
  readonly scope: string
  readonly artifactId: string | null
  /** Captured from the registry, never accepted as a caller verification claim. */
  readonly artifactBinding?: ArtifactQABinding
  readonly checks: readonly QACheck[]
  readonly priority: RuntimeTaskPriority
  readonly status: QAStatus
  readonly repairCapabilities: readonly string[]
  readonly maxRepairAttempts: number
  readonly rootQaId: string
  readonly previousQaId: string | null
  readonly repairId: string | null
  readonly attempt: number
  readonly verifierAgentId: string | null
  readonly inspectionTaskId: string | null
  readonly executionIds: Readonly<Record<string, string>>
  readonly result: QAResult | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}
export interface TaskVerification {
  readonly qaId: string
  readonly status:
    'pending' | 'running' | 'verified' | 'failed' | 'blocked' | 'cancelled'
  readonly repairAttempts: number
  readonly maxRepairAttempts: number
  readonly needsAttention: boolean
}
export type RepairStatus =
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
export interface RepairRequest {
  readonly repairId: string
  readonly sourceQaId: string
  readonly sourceTaskId: string
  readonly taskId: string
  readonly responsibleAgentId: string | null
  readonly findings: readonly string[]
  readonly requiredChanges: readonly string[]
  readonly capabilities: readonly string[]
  readonly priority: RuntimeTaskPriority
  readonly status: RepairStatus
  readonly attempt: number
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}
export type QARuntimeCommand =
  | { readonly type: 'requestQA'; readonly request: QARequestInput }
  | {
      readonly type: 'startQA'
      readonly qaId: string
      readonly verifierAgentId: string
    }
  | { readonly type: 'completeQA'; readonly qaId: string }
  | {
      readonly type: 'cancelQA'
      readonly qaId: string
      readonly reason: string
    }
  | {
      readonly type: 'recheckQA'
      readonly qaId: string
      readonly newQaId?: string
      readonly replacementArtifactId?: string
    }
  | { readonly type: 'requestRepair'; readonly qaId: string }
  | {
      readonly type: 'assignRepair'
      readonly repairId: string
      readonly agentId?: string
    }
  | { readonly type: 'startRepair'; readonly repairId: string }

export class QAFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
