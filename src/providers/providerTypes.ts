import type { RuntimeJson } from '../runtime/runtimeTypes'
import type { ArtifactContentReference } from '../artifacts/artifactTypes'

export type ProviderCapability =
  'text' | 'structured' | 'research' | 'image' | 'video'
export type CreditUnit = 'credit-micros'
export interface ProviderPricing {
  readonly inputMicrosPerUnit: number
  readonly outputMicrosPerUnit: number
}
export interface ProviderModelDescriptor {
  readonly id: string
  readonly capabilities: readonly ProviderCapability[]
  readonly pricing: ProviderPricing
  readonly maxInputUnits: number
  readonly maxOutputUnits: number
}
/** Browser-safe descriptors contain no credentials, configuration paths or environment names. */
export interface ProviderDescriptor {
  readonly id: string
  readonly displayName: string
  readonly enabled: boolean
  readonly status: 'available' | 'unavailable'
  readonly capabilities: readonly ProviderCapability[]
  readonly models: readonly ProviderModelDescriptor[]
  readonly fallbacks: readonly {
    readonly providerId: string
    readonly modelId: string
  }[]
}
export interface ProviderRequestInput {
  readonly providerId: string
  readonly modelId: string
  readonly capability: ProviderCapability
  readonly input: RuntimeJson
  readonly maxOutputUnits: number
  readonly maxCostMicros: number
  readonly allowFallback: boolean
}
export interface ProviderUsage {
  readonly inputUnits: number
  readonly outputUnits: number
}
export type ProviderErrorCode =
  | 'UNKNOWN_PROVIDER'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_DISABLED'
  | 'MODEL_UNAVAILABLE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_PROVIDER_REQUEST'
  | 'PROVIDER_REQUEST_CONFLICT'
  | 'PROVIDER_PERMISSION_DENIED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_FAILED'
  | 'PROVIDER_OUTPUT_INVALID'
  | 'PROVIDER_USAGE_INVALID'
  | 'PROVIDER_ACCOUNTING_UNRESOLVED'
  | 'PROVIDER_RECONCILIATION_REQUIRED'
export class ProviderFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
/** Passed only by the trusted broker; raw prompt/output and credentials never enter this record. */
export interface ProviderReservationInput {
  readonly requestId: string
  readonly agentId: string
  readonly taskId: string
  readonly requestedProviderId: string
  readonly requestedModelId: string
  readonly selectedProviderId: string
  readonly selectedModelId: string
  readonly capability: ProviderCapability
  readonly requestFingerprint: string
  readonly pricing: ProviderPricing
  readonly inputUnits: number
  readonly maxOutputUnits: number
  readonly maxCostMicros: number
  readonly fallbackReasons: readonly ProviderErrorCode[]
}
export type ProviderRequestStatus =
  'reserved' | 'succeeded' | 'failed' | 'cancelled' | 'denied'
export type ProviderChargeDisposition =
  'reserved' | 'charged' | 'released' | 'unknown' | 'denied'
export interface ProviderRequestRecord extends ProviderReservationInput {
  readonly unit: CreditUnit
  readonly estimateMicros: number
  readonly actualMicros: number | null
  readonly usage: ProviderUsage | null
  readonly status: ProviderRequestStatus
  readonly disposition: ProviderChargeDisposition
  readonly errorCode: ProviderErrorCode | null
  /** Only an availability-related preflight denial is eligible for a new explicit request. */
  readonly retryable: boolean
  readonly createdAt: string
  readonly settledAt: string | null
  readonly reconciliationId: string | null
  readonly reconciliationEvidence: string | null
}
/** Append-only cost history; each entry records the resulting liability, not a second source of truth. */
export interface CreditLedgerEntry {
  readonly ledgerId: string
  readonly requestId: string
  readonly agentId: string
  readonly taskId: string
  readonly providerId: string
  readonly modelId: string
  readonly kind: 'reserved' | 'settled' | 'unresolved' | 'reconciled' | 'denied'
  readonly unit: CreditUnit
  readonly capability: ProviderCapability
  readonly estimateMicros: number
  readonly actualMicros: number | null
  readonly status: ProviderRequestStatus
  readonly reservedMicros: number
  readonly chargedMicros: number
  readonly occurredAt: string
  readonly reconciliationId: string | null
}
export interface ProviderExecutionResult {
  readonly requestId: string
  readonly providerId: string
  readonly modelId: string
  readonly capability: ProviderCapability
  readonly status: 'succeeded' | 'failed' | 'denied' | 'cancelled'
  readonly output: RuntimeJson
  readonly usage: ProviderUsage | null
  readonly estimateMicros: number
  readonly actualMicros: number | null
  readonly unit: CreditUnit
  readonly errorCode: ProviderErrorCode | null
  readonly retryable: boolean
  readonly content?: ArtifactContentReference
}
/** Lifetime limits for this repository. No automatic refill, exchange rates or implicit unlimited grants. */
export interface ProviderBudgetPolicy {
  readonly unit: CreditUnit
  readonly globalLimitMicros: number
  readonly perAgentLimitMicros: number
  readonly perTaskLimitMicros: number
  readonly perRequestLimitMicros: number
  readonly requestQuota?: number
}
export type ProviderRuntimeCommand =
  | {
      readonly type: 'reserveProviderRequest'
      readonly request: ProviderReservationInput
    }
  | {
      readonly type: 'denyProviderRequest'
      readonly request: ProviderReservationInput
      readonly errorCode: ProviderErrorCode
    }
  | {
      readonly type: 'settleProviderRequest'
      readonly requestId: string
      readonly status: 'succeeded' | 'failed' | 'cancelled'
      readonly disposition: 'charged' | 'released' | 'unknown'
      readonly usage?: ProviderUsage
      readonly errorCode?: ProviderErrorCode
    }
  | {
      readonly type: 'reconcileProviderCharge'
      readonly requestId: string
      readonly reconciliationId: string
      readonly usage: ProviderUsage
      /** Host assertion reference, not raw billing evidence or an independent verification claim. */
      readonly evidenceReference: string
    }
