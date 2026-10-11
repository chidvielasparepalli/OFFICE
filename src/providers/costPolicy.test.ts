import { describe, expect, it } from 'vitest'
import {
  assertProviderBudget,
  calculateProviderCost,
  copyProviderBudgetPolicy,
  copyProviderReservation,
  providerCostSummary,
} from './costPolicy'
import type {
  ProviderBudgetPolicy,
  ProviderRequestRecord,
  ProviderReservationInput,
} from './providerTypes'

const policy: ProviderBudgetPolicy = {
  unit: 'credit-micros',
  globalLimitMicros: 100,
  perAgentLimitMicros: 80,
  perTaskLimitMicros: 60,
  perRequestLimitMicros: 50,
  requestQuota: 3,
}
const input: ProviderReservationInput = {
  requestId: 'request',
  agentId: 'worker',
  taskId: 'task',
  requestedProviderId: 'local',
  requestedModelId: 'fixture',
  selectedProviderId: 'local',
  selectedModelId: 'fixture',
  capability: 'text',
  requestFingerprint: 'a'.repeat(64),
  pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
  inputUnits: 2,
  maxOutputUnits: 3,
  maxCostMicros: 50,
  fallbackReasons: [],
}
function record(
  overrides: Partial<ProviderRequestRecord> = {},
): ProviderRequestRecord {
  return {
    ...input,
    unit: 'credit-micros',
    estimateMicros: 13,
    actualMicros: null,
    usage: null,
    status: 'reserved',
    disposition: 'reserved',
    errorCode: null,
    retryable: false,
    createdAt: '2026-10-11T00:00:00Z',
    settledAt: null,
    reconciliationId: null,
    reconciliationEvidence: null,
    ...overrides,
  }
}
describe('provider cost policy', () => {
  it('prices exact integer input/output units and explicit zero-cost requests', () => {
    expect(
      calculateProviderCost(input.pricing, { inputUnits: 2, outputUnits: 3 }),
    ).toBe(13)
    expect(
      calculateProviderCost(
        { inputMicrosPerUnit: 0, outputMicrosPerUnit: 0 },
        { inputUnits: 10, outputUnits: 10 },
      ),
    ).toBe(0)
  })
  it.each([-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe unit value %s',
    (value) => {
      expect(() =>
        calculateProviderCost(input.pricing, {
          inputUnits: value,
          outputUnits: 0,
        }),
      ).toThrow()
    },
  )
  it('uses checked BigInt multiplication and never rounds an overflowing charge', () => {
    expect(() =>
      calculateProviderCost(
        { inputMicrosPerUnit: Number.MAX_SAFE_INTEGER, outputMicrosPerUnit: 1 },
        { inputUnits: 2, outputUnits: 0 },
      ),
    ).toThrow(/accounting range/u)
  })
  it('copies/freezes policies, price snapshots and fallback history', () => {
    const copy = copyProviderReservation(input)
    expect(copy).toEqual(input)
    expect(copy.pricing).not.toBe(input.pricing)
    expect(Object.isFrozen(copy.pricing)).toBe(true)
    expect(Object.isFrozen(copy.fallbackReasons)).toBe(true)
    expect(Object.isFrozen(copyProviderBudgetPolicy(policy))).toBe(true)
  })
  it('rejects credentials, unknown fields, sparse fallback arrays and invalid fingerprints', () => {
    expect(() =>
      copyProviderReservation({
        ...input,
        agentId: 'password=synthetic-test-value',
      }),
    ).toThrow()
    expect(() =>
      copyProviderReservation({ ...input, requestFingerprint: 'freeform' }),
    ).toThrow()
    expect(() =>
      copyProviderReservation({ ...input, fallbackReasons: new Array(1) }),
    ).toThrow()
    expect(() =>
      copyProviderBudgetPolicy({
        ...policy,
        unit: 'USD',
      } as unknown as ProviderBudgetPolicy),
    ).toThrow()
    expect(() =>
      copyProviderReservation({
        ...input,
        metadata: { password: 'synthetic' },
      } as unknown as ProviderReservationInput),
    ).toThrow()
  })
  it('respects request ceilings and every budget scope', () => {
    expect(() => assertProviderBudget(policy, {}, input, 51)).toThrow(/limit/u)
    expect(() =>
      assertProviderBudget(policy, {}, { ...input, maxCostMicros: 12 }, 13),
    ).toThrow(/limit/u)
    expect(() =>
      assertProviderBudget(
        policy,
        { a: record({ estimateMicros: 55 }) },
        input,
        13,
      ),
    ).toThrow(/exhausted/u)
    expect(() =>
      assertProviderBudget(
        policy,
        { a: record({ taskId: 'another', estimateMicros: 70 }) },
        input,
        13,
      ),
    ).toThrow(/exhausted/u)
    expect(() =>
      assertProviderBudget(
        policy,
        {
          a: record({
            agentId: 'another',
            taskId: 'another',
            estimateMicros: 90,
          }),
        },
        input,
        13,
      ),
    ).toThrow(/exhausted/u)
  })
  it('unknown liability remains reserved; releases do not count as charges', () => {
    const unknown = record({
      status: 'cancelled',
      disposition: 'unknown',
      estimateMicros: 50,
    })
    expect(() =>
      assertProviderBudget(policy, { a: unknown }, input, 13),
    ).toThrow()
    const released = record({ status: 'cancelled', disposition: 'released' })
    expect(() =>
      assertProviderBudget(policy, { a: released }, input, 13),
    ).not.toThrow()
    expect(providerCostSummary({ a: unknown, b: released })).toMatchObject({
      chargedMicros: '0',
      reservedMicros: '50',
      unresolvedRequests: 1,
    })
  })
  it('records overrun debt in future budget checks and sums beyond safe integer exactly', () => {
    const charged = record({
      status: 'succeeded',
      disposition: 'charged',
      actualMicros: 101,
    })
    expect(() =>
      assertProviderBudget(policy, { a: charged }, input, 0),
    ).toThrow()
    const large = record({
      status: 'succeeded',
      disposition: 'charged',
      actualMicros: Number.MAX_SAFE_INTEGER,
    })
    expect(providerCostSummary({ a: large, b: large }).chargedMicros).toBe(
      '18014398509481982',
    )
  })
  it('counts reserved, charged and released attempts against quota, excluding denied preflight requests', () => {
    expect(() =>
      assertProviderBudget(
        { ...policy, requestQuota: 1 },
        { a: record({ status: 'cancelled', disposition: 'released' }) },
        input,
        13,
      ),
    ).toThrow(/quota/u)
    expect(() =>
      assertProviderBudget(
        { ...policy, requestQuota: 1 },
        { a: record({ status: 'denied', disposition: 'denied' }) },
        input,
        13,
      ),
    ).not.toThrow()
  })
})
