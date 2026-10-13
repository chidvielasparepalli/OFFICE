import { describe, expect, it } from 'vitest'
import { ManagerOrchestrator } from '../orchestration/ManagerOrchestrator'
import type {
  ProviderBudgetPolicy,
  ProviderReservationInput,
} from '../providers/providerTypes'
import {
  createOfficeRuntime,
  createEmptyRuntimeState,
  createInMemoryOfficeRuntimeRepository,
  type OfficeRuntime,
} from './officeRuntime'
import type { RuntimeCommand, RuntimeState } from './runtimeTypes'

const policy: ProviderBudgetPolicy = {
  unit: 'credit-micros',
  globalLimitMicros: 100,
  perAgentLimitMicros: 100,
  perTaskLimitMicros: 100,
  perRequestLimitMicros: 100,
  requestQuota: 10,
}
const input: ProviderReservationInput = {
  requestId: 'execution',
  agentId: 'a',
  taskId: 'task',
  requestedProviderId: 'local',
  requestedModelId: 'fixture',
  selectedProviderId: 'local',
  selectedModelId: 'fixture',
  capability: 'text',
  requestFingerprint: 'a'.repeat(64),
  pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
  inputUnits: 2,
  maxOutputUnits: 10,
  maxCostMicros: 100,
  fallbackReasons: [],
}
function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.state
}
function reject(
  runtime: OfficeRuntime,
  command: RuntimeCommand,
  code?: string,
) {
  const before = runtime.getSnapshot()
  const result = runtime.dispatch(command)
  expect(result.ok).toBe(false)
  if (!result.ok && code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(before)
  return result
}
function seed(
  runtime = createOfficeRuntime({
    providerBudgetPolicy: policy,
    now: () => '2026-10-11T00:00:00.000Z',
  }),
) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test' },
  })
  for (const id of ['manager', 'a', 'b'])
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: id,
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        departmentId: 'test',
        managerId: id === 'manager' ? null : 'manager',
        capabilities: ['text'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  return runtime
}
function running(runtime = seed(), request = input, marked = true) {
  if (!runtime.getSnapshot().tasks[request.taskId]) {
    send(runtime, {
      type: 'createTask',
      task: { id: request.taskId, title: request.taskId },
    })
    send(runtime, {
      type: 'assignTask',
      taskId: request.taskId,
      agentId: request.agentId,
    })
  }
  if (runtime.getSnapshot().tasks[request.taskId].status !== 'in_progress')
    send(runtime, { type: 'startTask', taskId: request.taskId })
  send(runtime, {
    type: 'requestToolExecution',
    executionId: request.requestId,
    agentId: request.agentId,
    taskId: request.taskId,
    toolId: 'provider.invoke',
    inputSummary: { capability: 'text' },
    permission: {
      allowed: true,
      code: 'ALLOWED',
      reason: 'Explicit fixture grant.',
      requiredPermissions: ['network'],
    },
    metadata: { providerBroker: marked },
  })
  send(runtime, { type: 'startToolExecution', executionId: request.requestId })
  return runtime
}
function reserve(runtime = running()) {
  send(runtime, { type: 'reserveProviderRequest', request: input })
  return runtime
}
describe('canonical provider accounting', () => {
  it('reserves atomically with source identity, immutable price snapshot, events and activity', () => {
    const runtime = reserve()
    const state = runtime.getSnapshot()
    expect(state.providerRequests.execution).toMatchObject({
      status: 'reserved',
      disposition: 'reserved',
      estimateMicros: 34,
      actualMicros: null,
      unit: 'credit-micros',
    })
    expect(state.creditLedger).toHaveLength(1)
    expect(Object.isFrozen(state.creditLedger[0])).toBe(true)
    expect(Object.isFrozen(state.providerRequests.execution.pricing)).toBe(true)
    expect(state.events.at(-1)?.changes.creditLedger).toEqual(
      state.creditLedger,
    )
    expect(state.events.at(-1)?.type).toBe('PROVIDER_REQUEST_RESERVED')
    expect(state.activities.at(-1)?.summary).toBe(
      'Provider cost reserved before execution.',
    )
  })
  it('denies unconfigured budgets by default without reservation or success events', () => {
    const runtime = running(seed(createOfficeRuntime()))
    reject(
      runtime,
      { type: 'reserveProviderRequest', request: input },
      'QUOTA_EXCEEDED',
    )
    expect(runtime.getSnapshot().providerRequests).toEqual({})
    expect(runtime.getSnapshot().creditLedger).toEqual([])
  })
  it('requires marked broker tool, network permission and exact current ownership', () => {
    reject(
      running(seed(), input, false),
      { type: 'reserveProviderRequest', request: input },
      'PROVIDER_PERMISSION_DENIED',
    )
    const runtime = running()
    reject(
      runtime,
      { type: 'reserveProviderRequest', request: { ...input, agentId: 'b' } },
      'PROVIDER_PERMISSION_DENIED',
    )
    reject(
      runtime,
      {
        type: 'reserveProviderRequest',
        request: { ...input, requestId: 'missing' },
      },
      'PROVIDER_PERMISSION_DENIED',
    )
  })
  it('deduplicates identical reservations but rejects changed request binding', () => {
    const runtime = reserve(),
      before = runtime.getSnapshot()
    send(runtime, { type: 'reserveProviderRequest', request: { ...input } })
    expect(runtime.getSnapshot()).toBe(before)
    reject(
      runtime,
      {
        type: 'reserveProviderRequest',
        request: { ...input, requestFingerprint: 'b'.repeat(64) },
      },
      'PROVIDER_REQUEST_CONFLICT',
    )
    reject(
      runtime,
      {
        type: 'reserveProviderRequest',
        request: { ...input, selectedModelId: 'changed' },
      },
      'PROVIDER_REQUEST_CONFLICT',
    )
  })
  it('serializes concurrent requests against spent plus outstanding reservations', async () => {
    const runtime = running(
      seed(
        createOfficeRuntime({
          providerBudgetPolicy: { ...policy, globalLimitMicros: 50 },
        }),
      ),
    )
    const second = {
      ...input,
      requestId: 'second',
      agentId: 'b',
      taskId: 'other',
    }
    running(runtime, second)
    const results = await Promise.all(
      [input, second].map((request) =>
        Promise.resolve().then(() =>
          runtime.dispatch({ type: 'reserveProviderRequest', request }),
        ),
      ),
    )
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(Object.keys(runtime.getSnapshot().providerRequests)).toEqual([
      'execution',
    ])
  })
  it('does not publish a reservation when canonical persistence fails', () => {
    let fail = false,
      saved: RuntimeState | null = null
    const runtime = running(
      seed(
        createOfficeRuntime({
          providerBudgetPolicy: policy,
          repository: {
            read: () => saved,
            write: (state) => {
              if (fail) throw new Error('fixture persistence unavailable')
              saved = state
            },
          },
        }),
      ),
    )
    fail = true
    reject(
      runtime,
      { type: 'reserveProviderRequest', request: input },
      'REPOSITORY_ERROR',
    )
    expect(runtime.getSnapshot().creditLedger).toHaveLength(0)
  })
  it('records only safe fixed-code denial metadata and no reserved cost', () => {
    const runtime = running()
    const state = send(runtime, {
      type: 'denyProviderRequest',
      request: input,
      errorCode: 'CREDENTIAL_UNAVAILABLE',
    })
    expect(state.providerRequests.execution).toMatchObject({
      status: 'denied',
      disposition: 'denied',
    })
    expect(state.creditLedger[0]).toMatchObject({
      kind: 'denied',
      reservedMicros: 0,
      chargedMicros: 0,
      actualMicros: null,
    })
    const before = runtime.getSnapshot()
    send(runtime, {
      type: 'denyProviderRequest',
      request: input,
      errorCode: 'CREDENTIAL_UNAVAILABLE',
    })
    expect(runtime.getSnapshot()).toBe(before)
    reject(
      runtime,
      { type: 'reserveProviderRequest', request: input },
      'PROVIDER_REQUEST_CONFLICT',
    )
  })
  it.each([
    ['PROVIDER_UNAVAILABLE', true],
    ['MODEL_UNAVAILABLE', true],
    ['UNKNOWN_PROVIDER', false],
    ['CREDENTIAL_UNAVAILABLE', false],
    ['BUDGET_EXCEEDED', false],
    ['PROVIDER_PERMISSION_DENIED', false],
  ] as const)(
    'derives preflight retryability for %s without making another request',
    (errorCode, retryable) => {
      const runtime = running()
      send(runtime, { type: 'denyProviderRequest', request: input, errorCode })
      expect(runtime.getSnapshot().providerRequests.execution.retryable).toBe(
        retryable,
      )
      expect(runtime.getSnapshot().creditLedger).toHaveLength(1)
      const restored = createOfficeRuntime({
        providerBudgetPolicy: policy,
        repository: createInMemoryOfficeRuntimeRepository(
          runtime.getSnapshot(),
        ),
      })
      expect(restored.getSnapshot().providerRequests.execution.retryable).toBe(
        retryable,
      )
    },
  )
  it('never suggests retry after possible submission, including subsequent charge reconciliation', () => {
    const runtime = reserve()
    expect(runtime.getSnapshot().providerRequests.execution.retryable).toBe(
      false,
    )
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'unknown',
      errorCode: 'PROVIDER_UNAVAILABLE',
    })
    expect(runtime.getSnapshot().providerRequests.execution.retryable).toBe(
      false,
    )
    send(runtime, {
      type: 'reconcileProviderCharge',
      requestId: 'execution',
      reconciliationId: 'usage:retry',
      evidenceReference: 'receipt:retry',
      usage: { inputUnits: 1, outputUnits: 1 },
    })
    expect(runtime.getSnapshot().providerRequests.execution.retryable).toBe(
      false,
    )
  })
  it('rejects fabricated retryability in restored current records and historical after-images', () => {
    const snapshot = reserve().getSnapshot()
    const changedRecord = {
      ...snapshot.providerRequests.execution,
      retryable: true,
    }
    expect(() =>
      createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository({
          ...snapshot,
          providerRequests: { execution: changedRecord },
        }),
      }),
    ).toThrow(/retryability/u)
    const changedEvents = snapshot.events.map((event) =>
      event.changes.providerRequests
        ? {
            ...event,
            changes: {
              ...event.changes,
              providerRequests: { execution: changedRecord },
            },
          }
        : event,
    )
    expect(() =>
      createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository({
          ...snapshot,
          events: changedEvents,
        }),
      }),
    ).toThrow(/retryability/u)
  })
  it('settles actual charge, releases unused reservation and never completes the tool/task', () => {
    const runtime = reserve()
    const state = send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'succeeded',
      disposition: 'charged',
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(state.providerRequests.execution).toMatchObject({
      actualMicros: 10,
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(state.creditLedger[1]).toMatchObject({
      reservedMicros: 0,
      chargedMicros: 10,
    })
    expect(state.tasks.task.status).toBe('in_progress')
    expect(state.toolExecutions.execution.status).toBe('running')
    const before = runtime.getSnapshot()
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'succeeded',
      disposition: 'charged',
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(runtime.getSnapshot()).toBe(before)
    reject(
      runtime,
      {
        type: 'settleProviderRequest',
        requestId: 'execution',
        status: 'succeeded',
        disposition: 'charged',
        usage: { inputUnits: 2, outputUnits: 3 },
      },
      'PROVIDER_REQUEST_CONFLICT',
    )
  })
  it('records actual budget overrun without clamping or hiding debt', () => {
    const runtime = reserve()
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'charged',
      usage: { inputUnits: 2, outputUnits: 50 },
      errorCode: 'PROVIDER_USAGE_INVALID',
    })
    expect(runtime.getSnapshot().providerRequests.execution.actualMicros).toBe(
      154,
    )
    const second = {
      ...input,
      requestId: 'second',
      agentId: 'b',
      taskId: 'other',
    }
    running(runtime, second)
    reject(
      runtime,
      { type: 'reserveProviderRequest', request: second },
      'BUDGET_EXCEEDED',
    )
  })
  it('retains unknown liability after cancellation/disconnect and accepts explicit later usage', () => {
    const runtime = reserve()
    send(runtime, { type: 'disconnect' })
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'cancelled',
      disposition: 'unknown',
      errorCode: 'PROVIDER_CANCELLED',
    })
    expect(runtime.getSnapshot().creditLedger.at(-1)?.reservedMicros).toBe(34)
    const oldEntries = runtime.getSnapshot().creditLedger
    const oldTool = runtime.getSnapshot().toolExecutions.execution
    const state = send(runtime, {
      type: 'reconcileProviderCharge',
      requestId: 'execution',
      reconciliationId: 'billing:one',
      evidenceReference: 'receipt:one',
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(state.providerRequests.execution).toMatchObject({
      status: 'cancelled',
      disposition: 'charged',
      actualMicros: 10,
      reconciliationId: 'billing:one',
    })
    expect(state.connection).toBe('disconnected')
    expect(state.toolExecutions.execution).toBe(oldTool)
    expect(state.creditLedger.slice(0, 2)).toEqual(oldEntries)
    expect(state.creditLedger).toHaveLength(3)
    const before = runtime.getSnapshot()
    send(runtime, {
      type: 'reconcileProviderCharge',
      requestId: 'execution',
      reconciliationId: 'billing:one',
      evidenceReference: 'receipt:one',
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(runtime.getSnapshot()).toBe(before)
    reject(
      runtime,
      {
        type: 'reconcileProviderCharge',
        requestId: 'execution',
        reconciliationId: 'billing:two',
        evidenceReference: 'receipt:two',
        usage: { inputUnits: 0, outputUnits: 0 },
      },
      'PROVIDER_REQUEST_CONFLICT',
    )
  })
  it('allows known non-submission cancellation to release but never invents successful no-usage work', () => {
    const runtime = reserve()
    reject(
      runtime,
      {
        type: 'settleProviderRequest',
        requestId: 'execution',
        status: 'succeeded',
        disposition: 'released',
      },
      'INVALID_PROVIDER_REQUEST',
    )
    const state = send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'cancelled',
      disposition: 'released',
      errorCode: 'PROVIDER_CANCELLED',
    })
    expect(state.creditLedger.at(-1)?.reservedMicros).toBe(0)
    expect(state.providerRequests.execution.actualMicros).toBeNull()
    reject(
      runtime,
      {
        type: 'reconcileProviderCharge',
        requestId: 'execution',
        reconciliationId: 'assertion',
        evidenceReference: 'receipt',
        usage: { inputUnits: 1, outputUnits: 1 },
      },
      'PROVIDER_RECONCILIATION_REQUIRED',
    )
  })
  it('rejects credential-like command metadata with no history or context leak', () => {
    const runtime = running()
    const synthetic = 'password=synthetic-fixture-only'
    const result = reject(runtime, {
      type: 'reserveProviderRequest',
      request: { ...input, selectedModelId: synthetic },
    })
    expect(JSON.stringify(result)).not.toContain(synthetic)
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(synthetic)
    reserve(runtime)
    reject(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'unknown',
      errorCode: synthetic,
    } as unknown as RuntimeCommand)
  })
  it('restores valid immutable accounting without replay or lost liabilities', () => {
    const runtime = reserve()
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'unknown',
      errorCode: 'PROVIDER_FAILED',
    })
    const restored = createOfficeRuntime({
      providerBudgetPolicy: policy,
      repository: createInMemoryOfficeRuntimeRepository(runtime.getSnapshot()),
    })
    expect(restored.getSnapshot()).toEqual(runtime.getSnapshot())
    expect(restored.getSnapshot().creditLedger).toHaveLength(2)
  })
  it('rejects tampered restored pricing, balances, ledger history and credential-bearing provider events', () => {
    const original = reserve().getSnapshot()
    const mutations = [
      (s: RuntimeState) => ({
        ...s,
        providerRequests: {
          ...s.providerRequests,
          execution: { ...s.providerRequests.execution, actualMicros: 100 },
        },
      }),
      (s: RuntimeState) => ({ ...s, creditLedger: [] }),
      (s: RuntimeState) => ({
        ...s,
        creditLedger: [{ ...s.creditLedger[0], reservedMicros: 0 }],
      }),
      (s: RuntimeState) => ({
        ...s,
        events: s.events.map((e) =>
          e.type === 'PROVIDER_REQUEST_RESERVED'
            ? { ...e, payload: { password: 'synthetic-fixture' } }
            : e,
        ),
      }),
    ]
    for (const mutate of mutations)
      expect(() =>
        createOfficeRuntime({
          repository: createInMemoryOfficeRuntimeRepository(mutate(original)),
        }),
      ).toThrow()
  })
  it('replays record after-images and append-only ledger deltas through reserve, unresolved and reconcile', () => {
    const runtime = reserve()
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'unknown',
      errorCode: 'PROVIDER_FAILED',
    })
    send(runtime, {
      type: 'reconcileProviderCharge',
      requestId: 'execution',
      reconciliationId: 'billing:replay',
      evidenceReference: 'receipt:replay',
      usage: { inputUnits: 1, outputUnits: 1 },
    })
    let replay = createEmptyRuntimeState()
    for (const event of runtime.getSnapshot().events) {
      replay = {
        ...replay,
        providerRequests: {
          ...replay.providerRequests,
          ...event.changes.providerRequests,
        },
        creditLedger: [
          ...replay.creditLedger,
          ...(event.changes.creditLedger ?? []),
        ],
      }
    }
    expect(replay.providerRequests).toEqual(
      runtime.getSnapshot().providerRequests,
    )
    expect(replay.creditLedger).toEqual(runtime.getSnapshot().creditLedger)
    expect(replay.creditLedger).toHaveLength(3)
  })
  it('preserves the existing tool failure to Manager attention path and character identity', async () => {
    const runtime = seed()
    const manager = new ManagerOrchestrator({
      runtime,
      managerId: 'manager',
      planner: {
        plan: async () => ({
          planId: 'plan',
          requestId: 'request',
          objective: 'Explicit provider fixture',
          tasks: [
            {
              id: 'task',
              title: 'Provider check',
              description: 'Run the explicitly allowed fixture provider.',
              status: 'queued',
              priority: 'normal',
              dependencyIds: [],
              requiredCapabilities: ['text'],
              preferredAgentId: 'a',
            },
          ],
          constraints: [],
          expectedOutputs: [],
        }),
      },
    })
    manager.start()
    expect(
      manager.receiveRequest({
        requestId: 'request',
        title: 'Provider fixture',
        description: 'Explicit development request.',
        requestedBy: 'test',
        priority: 'normal',
        constraints: [],
      }).ok,
    ).toBe(true)
    expect((await manager.planRequest('request')).ok).toBe(true)
    send(runtime, {
      type: 'dispatchPlanTask',
      managerId: 'manager',
      planId: 'plan',
      taskId: 'task',
      agentId: 'a',
    })
    running(runtime)
    reserve(runtime)
    send(runtime, {
      type: 'settleProviderRequest',
      requestId: 'execution',
      status: 'failed',
      disposition: 'released',
      errorCode: 'BUDGET_EXCEEDED',
    })
    send(runtime, {
      type: 'failToolExecution',
      executionId: 'execution',
      error: {
        code: 'BUDGET_EXCEEDED',
        message: 'Provider request could not execute.',
      },
    })
    expect(runtime.getSnapshot().tasks.task.status).toBe('blocked')
    expect(runtime.getSnapshot().agents.a.kind).toBe('standard-worker')
    expect(runtime.getSnapshot().agents.manager.kind).toBe('manager')
    expect(runtime.getSnapshot().plans.plan.status).toBe('needs_attention')
    expect(
      manager
        .getContext('request')
        .events.some((e) => e.type === 'AGENT_BLOCKED'),
    ).toBe(true)
    manager.dispose()
  })
})
