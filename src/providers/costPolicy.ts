import { memoryId, memoryObject, memorySafeJson } from '../memory/memoryPolicy'
import {
  ProviderFault,
  type ProviderBudgetPolicy,
  type ProviderCapability,
  type ProviderErrorCode,
  type ProviderPricing,
  type ProviderRequestRecord,
  type ProviderRequestStatus,
  type ProviderReservationInput,
  type ProviderUsage,
} from './providerTypes'

export function providerAssert(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new ProviderFault(code, message)
}
export const providerErrorCodes: readonly ProviderErrorCode[] = [
  'UNKNOWN_PROVIDER',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_DISABLED',
  'MODEL_UNAVAILABLE',
  'CAPABILITY_UNSUPPORTED',
  'CREDENTIAL_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'QUOTA_EXCEEDED',
  'INVALID_PROVIDER_REQUEST',
  'PROVIDER_REQUEST_CONFLICT',
  'PROVIDER_PERMISSION_DENIED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_CANCELLED',
  'PROVIDER_FAILED',
  'PROVIDER_OUTPUT_INVALID',
  'PROVIDER_USAGE_INVALID',
  'PROVIDER_ACCOUNTING_UNRESOLVED',
  'PROVIDER_RECONCILIATION_REQUIRED',
]
export function providerErrorCode(value: unknown): ProviderErrorCode {
  providerAssert(
    providerErrorCodes.includes(value as ProviderErrorCode),
    'INVALID_PROVIDER_REQUEST',
    'Unsupported provider error code.',
  )
  return value as ProviderErrorCode
}
/** Advice only; never automatically retry a request that may have reached a provider. */
export function providerRetryable(
  status: ProviderRequestStatus,
  errorCode: ProviderErrorCode | null,
): boolean {
  return (
    status === 'denied' &&
    (errorCode === 'PROVIDER_UNAVAILABLE' || errorCode === 'MODEL_UNAVAILABLE')
  )
}
export function creditInteger(value: unknown): number {
  providerAssert(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    'INVALID_PROVIDER_REQUEST',
    'Costs and usage must be nonnegative safe integers.',
  )
  return value
}
export function copyProviderUsage(value: unknown): ProviderUsage {
  memorySafeJson(value)
  const obj = memoryObject(value, ['inputUnits', 'outputUnits'])
  return Object.freeze({
    inputUnits: creditInteger(obj.inputUnits),
    outputUnits: creditInteger(obj.outputUnits),
  })
}
export function copyProviderPricing(value: unknown): ProviderPricing {
  memorySafeJson(value)
  const obj = memoryObject(value, ['inputMicrosPerUnit', 'outputMicrosPerUnit'])
  return Object.freeze({
    inputMicrosPerUnit: creditInteger(obj.inputMicrosPerUnit),
    outputMicrosPerUnit: creditInteger(obj.outputMicrosPerUnit),
  })
}
/** BigInt prevents overflow/rounding before the explicitly checked JSON-safe result. */
export function calculateProviderCost(
  pricing: ProviderPricing,
  usage: ProviderUsage,
): number {
  const rates = copyProviderPricing(pricing)
  const units = copyProviderUsage(usage)
  const result =
    BigInt(rates.inputMicrosPerUnit) * BigInt(units.inputUnits) +
    BigInt(rates.outputMicrosPerUnit) * BigInt(units.outputUnits)
  providerAssert(
    result <= BigInt(Number.MAX_SAFE_INTEGER),
    'PROVIDER_USAGE_INVALID',
    'Reported cost exceeds the supported exact accounting range; retain liability pending reconciliation.',
  )
  return Number(result)
}
export function copyProviderBudgetPolicy(
  value: ProviderBudgetPolicy,
): ProviderBudgetPolicy {
  memorySafeJson(value)
  memoryObject(value, [
    'unit',
    'globalLimitMicros',
    'perAgentLimitMicros',
    'perTaskLimitMicros',
    'perRequestLimitMicros',
    'requestQuota',
  ])
  providerAssert(
    value.unit === 'credit-micros',
    'INVALID_PROVIDER_REQUEST',
    'Unsupported accounting unit.',
  )
  return Object.freeze({
    unit: 'credit-micros',
    globalLimitMicros: creditInteger(value.globalLimitMicros),
    perAgentLimitMicros: creditInteger(value.perAgentLimitMicros),
    perTaskLimitMicros: creditInteger(value.perTaskLimitMicros),
    perRequestLimitMicros: creditInteger(value.perRequestLimitMicros),
    ...(value.requestQuota === undefined
      ? {}
      : { requestQuota: creditInteger(value.requestQuota) }),
  })
}
export function copyProviderReservation(
  value: ProviderReservationInput,
): ProviderReservationInput {
  memorySafeJson(value)
  memoryObject(value, [
    'requestId',
    'agentId',
    'taskId',
    'requestedProviderId',
    'requestedModelId',
    'selectedProviderId',
    'selectedModelId',
    'capability',
    'requestFingerprint',
    'pricing',
    'inputUnits',
    'maxOutputUnits',
    'maxCostMicros',
    'fallbackReasons',
  ])
  const capabilities: readonly ProviderCapability[] = [
    'text',
    'structured',
    'research',
    'image',
    'video',
  ]
  providerAssert(
    capabilities.includes(value.capability),
    'INVALID_PROVIDER_REQUEST',
    'Unsupported provider capability.',
  )
  providerAssert(
    typeof value.requestFingerprint === 'string' &&
      /^[a-f0-9]{64}$/u.test(value.requestFingerprint),
    'INVALID_PROVIDER_REQUEST',
    'Provider request requires a SHA-256 identity fingerprint.',
  )
  providerAssert(
    Array.isArray(value.fallbackReasons) && value.fallbackReasons.length <= 8,
    'INVALID_PROVIDER_REQUEST',
    'Fallback history must be bounded.',
  )
  return Object.freeze({
    requestId: memoryId(value.requestId),
    agentId: memoryId(value.agentId),
    taskId: memoryId(value.taskId),
    requestedProviderId: memoryId(value.requestedProviderId),
    requestedModelId: memoryId(value.requestedModelId),
    selectedProviderId: memoryId(value.selectedProviderId),
    selectedModelId: memoryId(value.selectedModelId),
    capability: value.capability,
    requestFingerprint: value.requestFingerprint,
    pricing: copyProviderPricing(value.pricing),
    inputUnits: creditInteger(value.inputUnits),
    maxOutputUnits: creditInteger(value.maxOutputUnits),
    maxCostMicros: creditInteger(value.maxCostMicros),
    fallbackReasons: Object.freeze(
      Array.from(value.fallbackReasons, providerErrorCode),
    ),
  })
}
export function providerReservedMicros(record: ProviderRequestRecord): number {
  return record.disposition === 'reserved' || record.disposition === 'unknown'
    ? record.estimateMicros
    : 0
}
function committed(record: ProviderRequestRecord): bigint {
  return (
    BigInt(record.actualMicros ?? 0) + BigInt(providerReservedMicros(record))
  )
}
/** Called inside the canonical runtime transaction immediately before reservation. */
export function assertProviderBudget(
  policy: ProviderBudgetPolicy,
  records: Readonly<Record<string, ProviderRequestRecord>>,
  request: ProviderReservationInput,
  estimateMicros: number,
): void {
  const previous = Object.values(records).filter(
    (r) => r.disposition !== 'denied',
  )
  providerAssert(
    policy.requestQuota === undefined || previous.length < policy.requestQuota,
    'QUOTA_EXCEEDED',
    'Provider request quota is exhausted.',
  )
  const estimate = BigInt(creditInteger(estimateMicros))
  providerAssert(
    estimate <= BigInt(policy.perRequestLimitMicros) &&
      estimate <= BigInt(request.maxCostMicros),
    'BUDGET_EXCEEDED',
    'Provider request exceeds its approved cost limit.',
  )
  const scopes: readonly [readonly ProviderRequestRecord[], number][] = [
    [previous, policy.globalLimitMicros],
    [
      previous.filter((r) => r.agentId === request.agentId),
      policy.perAgentLimitMicros,
    ],
    [
      previous.filter((r) => r.taskId === request.taskId),
      policy.perTaskLimitMicros,
    ],
  ]
  for (const [scope, limit] of scopes)
    providerAssert(
      scope.reduce((sum, r) => sum + committed(r), estimate) <= BigInt(limit),
      'BUDGET_EXCEEDED',
      'Provider budget is exhausted or reserved by other requests.',
    )
}
/** Decimal totals remain exact even if accumulated lifetime spend exceeds a JSON safe integer. */
export function providerCostSummary(
  records: Readonly<Record<string, ProviderRequestRecord>>,
) {
  const requests = Object.values(records)
  return Object.freeze({
    unit: 'credit-micros' as const,
    chargedMicros: requests
      .reduce((sum, r) => sum + BigInt(r.actualMicros ?? 0), 0n)
      .toString(),
    reservedMicros: requests
      .reduce((sum, r) => sum + BigInt(providerReservedMicros(r)), 0n)
      .toString(),
    unresolvedRequests: requests.filter((r) => r.disposition === 'unknown')
      .length,
    requestCount: requests.length,
  })
}
