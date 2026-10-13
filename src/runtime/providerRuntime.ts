import { memoryId, memoryObject, memorySafeJson } from '../memory/memoryPolicy'
import {
  assertProviderBudget,
  calculateProviderCost,
  copyProviderReservation,
  copyProviderUsage,
  creditInteger,
  providerAssert as ensure,
  providerErrorCode,
  providerReservedMicros,
  providerRetryable,
} from '../providers/costPolicy'
import type {
  CreditLedgerEntry,
  ProviderBudgetPolicy,
  ProviderRequestRecord,
  ProviderReservationInput,
  ProviderRuntimeCommand,
} from '../providers/providerTypes'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type { RuntimeCommand, RuntimeState } from './runtimeTypes'

interface ProviderTransaction extends OrchestrationTransaction {
  readonly providerBudgetPolicy: ProviderBudgetPolicy
}
const commands = new Set([
  'reserveProviderRequest',
  'denyProviderRequest',
  'settleProviderRequest',
  'reconcileProviderCharge',
])
export function isProviderRuntimeCommand(
  command: RuntimeCommand,
): command is ProviderRuntimeCommand {
  return commands.has(command.type)
}
function ownedExecution(
  tx: ProviderTransaction,
  input: ProviderReservationInput,
) {
  const execution = tx.state.toolExecutions[input.requestId]
  const task = tx.task(input.taskId)
  const agent = tx.agent(input.agentId)
  ensure(
    execution?.status === 'running' &&
      execution.permission.allowed &&
      execution.metadata.providerBroker === true &&
      execution.permission.requiredPermissions.includes('network') &&
      execution.agentId === input.agentId &&
      execution.taskId === input.taskId &&
      task.status === 'in_progress' &&
      task.assignedAgentId === agent.id &&
      agent.currentTaskId === task.id,
    'PROVIDER_PERMISSION_DENIED',
    'Provider requests require an active approved broker tool execution and its current task owner.',
  )
}
function sameInput(
  record: ProviderRequestRecord,
  input: ProviderReservationInput,
) {
  const subset = Object.fromEntries(
    Object.keys(input).map((key) => [
      key,
      record[key as keyof ProviderRequestRecord],
    ]),
  )
  return JSON.stringify(subset) === JSON.stringify(input)
}
function get(tx: ProviderTransaction, requestId: string) {
  memoryId(requestId)
  ensure(
    Object.hasOwn(tx.state.providerRequests, requestId),
    'INVALID_PROVIDER_REQUEST',
    'Provider accounting request is unavailable.',
  )
  return tx.state.providerRequests[requestId]
}
function write(
  tx: ProviderTransaction,
  record: ProviderRequestRecord,
  kind: CreditLedgerEntry['kind'],
) {
  memorySafeJson(record)
  const entry: CreditLedgerEntry = {
    ledgerId: tx.id('credit'),
    requestId: record.requestId,
    agentId: record.agentId,
    taskId: record.taskId,
    providerId: record.selectedProviderId,
    modelId: record.selectedModelId,
    capability: record.capability,
    kind,
    unit: 'credit-micros',
    estimateMicros: record.estimateMicros,
    actualMicros: record.actualMicros,
    status: record.status,
    reservedMicros: providerReservedMicros(record),
    chargedMicros: record.actualMicros ?? 0,
    occurredAt: tx.time,
    reconciliationId: record.reconciliationId,
  }
  memorySafeJson(entry)
  tx.state = {
    ...tx.state,
    providerRequests: {
      ...tx.state.providerRequests,
      [record.requestId]: record,
    },
    creditLedger: [...tx.state.creditLedger, entry],
  }
}
export function applyProviderRuntimeCommand(
  tx: ProviderTransaction,
  command: ProviderRuntimeCommand,
): void {
  memorySafeJson(command)
  if (
    command.type === 'reserveProviderRequest' ||
    command.type === 'denyProviderRequest'
  ) {
    memoryObject(
      command,
      command.type === 'reserveProviderRequest'
        ? ['type', 'request']
        : ['type', 'request', 'errorCode'],
    )
    const input = copyProviderReservation(command.request)
    const errorCode =
      command.type === 'denyProviderRequest'
        ? providerErrorCode(command.errorCode)
        : null
    const existing = tx.state.providerRequests[input.requestId]
    if (existing) {
      ensure(
        sameInput(existing, input) &&
          (command.type === 'reserveProviderRequest'
            ? existing.status !== 'denied'
            : existing.status === 'denied' && existing.errorCode === errorCode),
        'PROVIDER_REQUEST_CONFLICT',
        'This provider request identity is already committed.',
      )
      return
    }
    ensure(
      tx.state.connection === 'local',
      'DISCONNECTED',
      'Provider dispatch requires a connected runtime.',
    )
    ownedExecution(tx, input)
    const estimateMicros = calculateProviderCost(input.pricing, {
      inputUnits: input.inputUnits,
      outputUnits: input.maxOutputUnits,
    })
    if (command.type === 'reserveProviderRequest')
      assertProviderBudget(
        tx.providerBudgetPolicy,
        tx.state.providerRequests,
        input,
        estimateMicros,
      )
    const record: ProviderRequestRecord = {
      ...input,
      unit: 'credit-micros',
      estimateMicros,
      actualMicros: null,
      usage: null,
      status: errorCode === null ? 'reserved' : 'denied',
      disposition: errorCode === null ? 'reserved' : 'denied',
      errorCode,
      retryable: providerRetryable(
        errorCode === null ? 'reserved' : 'denied',
        errorCode,
      ),
      createdAt: tx.time,
      settledAt: errorCode === null ? null : tx.time,
      reconciliationId: null,
      reconciliationEvidence: null,
    }
    write(tx, record, errorCode === null ? 'reserved' : 'denied')
    tx.emit(
      errorCode === null
        ? 'PROVIDER_REQUEST_RESERVED'
        : 'PROVIDER_REQUEST_DENIED',
      errorCode === null
        ? 'Provider cost reserved before execution.'
        : 'Provider request denied before execution.',
      input.agentId,
      input.taskId,
      { requestId: input.requestId, ...(errorCode ? { errorCode } : {}) },
    )
    if (errorCode === null && input.fallbackReasons.length > 0)
      tx.emit(
        'PROVIDER_FALLBACK_SELECTED',
        'A configured compatible fallback was selected before provider execution.',
        input.agentId,
        input.taskId,
        {
          requestId: input.requestId,
          providerId: input.selectedProviderId,
          modelId: input.selectedModelId,
          reasons: [...input.fallbackReasons],
        },
      )
    if (errorCode === 'BUDGET_EXCEEDED' || errorCode === 'QUOTA_EXCEEDED')
      tx.emit(
        'PROVIDER_BUDGET_EXCEEDED',
        'Provider budget or request quota denied execution.',
        input.agentId,
        input.taskId,
        { requestId: input.requestId, errorCode },
      )
    if (
      errorCode === 'UNKNOWN_PROVIDER' ||
      errorCode === 'PROVIDER_UNAVAILABLE' ||
      errorCode === 'PROVIDER_DISABLED' ||
      errorCode === 'CREDENTIAL_UNAVAILABLE' ||
      errorCode === 'MODEL_UNAVAILABLE'
    )
      tx.emit(
        'PROVIDER_UNAVAILABLE',
        'Requested provider service is unavailable.',
        input.agentId,
        input.taskId,
        { requestId: input.requestId, errorCode },
      )
    return
  }
  if (command.type === 'settleProviderRequest') {
    memoryObject(command, [
      'type',
      'requestId',
      'status',
      'disposition',
      'usage',
      'errorCode',
    ])
    const record = get(tx, command.requestId)
    ensure(
      ['succeeded', 'failed', 'cancelled'].includes(command.status) &&
        ['charged', 'released', 'unknown'].includes(command.disposition),
      'INVALID_PROVIDER_REQUEST',
      'Invalid provider settlement state.',
    )
    const errorCode =
      command.errorCode === undefined
        ? null
        : providerErrorCode(command.errorCode)
    ensure(
      command.status === 'succeeded'
        ? errorCode === null && command.disposition === 'charged'
        : errorCode !== null,
      'INVALID_PROVIDER_REQUEST',
      'Provider result requires a consistent fixed failure code and charge disposition.',
    )
    const usage =
      command.usage === undefined ? null : copyProviderUsage(command.usage)
    ensure(
      command.disposition === 'charged' ? usage !== null : usage === null,
      'INVALID_PROVIDER_REQUEST',
      'Only known charges carry authoritative usage; ambiguous submission retains its reservation.',
    )
    const actualMicros =
      usage === null ? null : calculateProviderCost(record.pricing, usage)
    if (record.status !== 'reserved') {
      ensure(
        record.status === command.status &&
          record.disposition === command.disposition &&
          record.errorCode === errorCode &&
          JSON.stringify(record.usage) === JSON.stringify(usage),
        'PROVIDER_REQUEST_CONFLICT',
        'Settlement cannot replace a previously recorded provider outcome.',
      )
      return
    }
    // Accounting is allowed after tool cancellation/disconnection; no task, tool output or agent is revived.
    const next: ProviderRequestRecord = {
      ...record,
      status: command.status,
      disposition: command.disposition,
      usage,
      actualMicros,
      errorCode,
      retryable: providerRetryable(command.status, errorCode),
      settledAt: tx.time,
    }
    write(
      tx,
      next,
      command.disposition === 'unknown' ? 'unresolved' : 'settled',
    )
    tx.emit(
      command.disposition === 'unknown'
        ? 'PROVIDER_CHARGE_UNRESOLVED'
        : 'PROVIDER_REQUEST_SETTLED',
      command.disposition === 'unknown'
        ? 'Provider charge remains unresolved; reservation retained.'
        : 'Provider usage and cost recorded.',
      record.agentId,
      record.taskId,
      { requestId: record.requestId, disposition: command.disposition },
    )
    tx.emit(
      command.status === 'succeeded'
        ? 'PROVIDER_REQUEST_COMPLETED'
        : 'PROVIDER_REQUEST_FAILED',
      command.status === 'succeeded'
        ? 'Provider request completed.'
        : 'Provider request did not complete successfully.',
      record.agentId,
      record.taskId,
      {
        requestId: record.requestId,
        status: command.status,
        ...(errorCode ? { errorCode } : {}),
      },
    )
    if (usage !== null)
      tx.emit(
        'USAGE_RECORDED',
        'Authoritative provider usage recorded.',
        record.agentId,
        record.taskId,
        {
          requestId: record.requestId,
          inputUnits: usage.inputUnits,
          outputUnits: usage.outputUnits,
          actualMicros,
        },
      )
    return
  }
  memoryObject(command, [
    'type',
    'requestId',
    'reconciliationId',
    'usage',
    'evidenceReference',
  ])
  const record = get(tx, command.requestId)
  const reconciliationId = memoryId(command.reconciliationId)
  const evidenceReference = memoryId(command.evidenceReference)
  const usage = copyProviderUsage(command.usage)
  const actualMicros = calculateProviderCost(record.pricing, usage)
  if (record.reconciliationId !== null) {
    ensure(
      record.reconciliationId === reconciliationId &&
        record.reconciliationEvidence === evidenceReference &&
        JSON.stringify(record.usage) === JSON.stringify(usage),
      'PROVIDER_REQUEST_CONFLICT',
      'A reconciliation assertion cannot be silently replaced.',
    )
    return
  }
  ensure(
    record.disposition === 'unknown',
    'PROVIDER_RECONCILIATION_REQUIRED',
    'Explicit reconciliation is limited to unresolved provider charges.',
  )
  ensure(
    !tx.state.creditLedger.some(
      (entry) => entry.reconciliationId === reconciliationId,
    ),
    'PROVIDER_REQUEST_CONFLICT',
    'Reconciliation identity is already used.',
  )
  const next: ProviderRequestRecord = {
    ...record,
    disposition: 'charged',
    usage,
    actualMicros,
    reconciliationId,
    reconciliationEvidence: evidenceReference,
  }
  write(tx, next, 'reconciled')
  tx.emit(
    'PROVIDER_CHARGE_RECONCILED',
    'Unresolved provider cost reconciled from an explicit host assertion.',
    record.agentId,
    record.taskId,
    { requestId: record.requestId, reconciliationId },
  )
  tx.emit(
    'USAGE_RECORDED',
    'Late authoritative provider usage recorded without restarting work.',
    record.agentId,
    record.taskId,
    {
      requestId: record.requestId,
      inputUnits: usage.inputUnits,
      outputUnits: usage.outputUnits,
      actualMicros,
    },
  )
}

/** Restored accounting cannot introduce credentials, broken relationships or inconsistent balances. */
export function validateRestoredProviderState(state: RuntimeState): void {
  const records = state.providerRequests ?? {}
  const ledger = state.creditLedger ?? []
  ensure(
    Array.isArray(ledger),
    'INVALID_PROVIDER_REQUEST',
    'Restored provider ledger must be an ordered list.',
  )
  const ledgerIds = new Set<string>()
  for (const event of state.events) {
    if (event.type.startsWith('PROVIDER_') || event.type === 'USAGE_RECORDED')
      memorySafeJson(event, 32768)
    for (const record of Object.values(event.changes.providerRequests ?? {})) {
      memorySafeJson(record)
      ensure(
        record.retryable === providerRetryable(record.status, record.errorCode),
        'INVALID_PROVIDER_REQUEST',
        'Restored retryability history must match the deterministic preflight policy.',
      )
    }
    for (const entry of event.changes.creditLedger ?? []) memorySafeJson(entry)
  }
  for (const [id, record] of Object.entries(records)) {
    memorySafeJson(record)
    const {
      unit,
      estimateMicros,
      actualMicros,
      usage,
      status,
      disposition,
      errorCode,
      retryable,
      createdAt,
      settledAt,
      reconciliationId,
      reconciliationEvidence,
      ...input
    } = record
    copyProviderReservation(input)
    ensure(
      retryable === providerRetryable(status, errorCode),
      'INVALID_PROVIDER_REQUEST',
      'Restored retryability must match the deterministic preflight policy.',
    )
    ensure(
      id === input.requestId &&
        unit === 'credit-micros' &&
        !!state.agents[input.agentId] &&
        !!state.tasks[input.taskId],
      'INVALID_PROVIDER_REQUEST',
      'Restored provider identity is invalid.',
    )
    const execution = state.toolExecutions[input.requestId]
    ensure(
      execution &&
        execution.agentId === input.agentId &&
        execution.taskId === input.taskId &&
        execution.permission.allowed &&
        execution.metadata.providerBroker === true &&
        execution.permission.requiredPermissions.includes('network'),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider execution relationship is invalid.',
    )
    ensure(
      creditInteger(estimateMicros) ===
        calculateProviderCost(input.pricing, {
          inputUnits: input.inputUnits,
          outputUnits: input.maxOutputUnits,
        }),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider estimate is inconsistent.',
    )
    ensure(
      Number.isFinite(Date.parse(createdAt)) &&
        (settledAt === null || Number.isFinite(Date.parse(settledAt))),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider timestamp is invalid.',
    )
    ensure(
      ['reserved', 'succeeded', 'failed', 'cancelled', 'denied'].includes(
        status,
      ) &&
        ['reserved', 'charged', 'released', 'unknown', 'denied'].includes(
          disposition,
        ),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider status is invalid.',
    )
    if (errorCode !== null) providerErrorCode(errorCode)
    ensure(
      (status === 'reserved') === (disposition === 'reserved') &&
        (status === 'denied') === (disposition === 'denied') &&
        (status === 'reserved') === (settledAt === null),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider lifecycle is inconsistent.',
    )
    ensure(
      status === 'reserved' || status === 'succeeded'
        ? errorCode === null
        : errorCode !== null,
      'INVALID_PROVIDER_REQUEST',
      'Restored provider failure code is inconsistent.',
    )
    ensure(
      status !== 'succeeded' || disposition === 'charged',
      'INVALID_PROVIDER_REQUEST',
      'Successful provider calls require reported usage.',
    )
    if (disposition === 'charged')
      ensure(
        usage !== null &&
          actualMicros === calculateProviderCost(input.pricing, usage),
        'INVALID_PROVIDER_REQUEST',
        'Restored provider actual charge is inconsistent.',
      )
    else
      ensure(
        usage === null && actualMicros === null,
        'INVALID_PROVIDER_REQUEST',
        'Unresolved or unused provider records cannot invent actual usage.',
      )
    ensure(
      (reconciliationId === null) === (reconciliationEvidence === null),
      'INVALID_PROVIDER_REQUEST',
      'Restored reconciliation is incomplete.',
    )
    if (reconciliationId !== null) {
      memoryId(reconciliationId)
      memoryId(reconciliationEvidence)
      ensure(
        disposition === 'charged' && ['failed', 'cancelled'].includes(status),
        'INVALID_PROVIDER_REQUEST',
        'Reconciliation must preserve the unsuccessful original outcome.',
      )
    }
  }
  for (const entry of ledger) {
    memorySafeJson(entry)
    memoryObject(entry, [
      'ledgerId',
      'requestId',
      'agentId',
      'taskId',
      'providerId',
      'modelId',
      'capability',
      'kind',
      'unit',
      'estimateMicros',
      'actualMicros',
      'status',
      'reservedMicros',
      'chargedMicros',
      'occurredAt',
      'reconciliationId',
    ])
    memoryId(entry.ledgerId)
    ensure(
      !ledgerIds.has(entry.ledgerId),
      'INVALID_PROVIDER_REQUEST',
      'Restored ledger identity is duplicated.',
    )
    ledgerIds.add(entry.ledgerId)
    const record = records[entry.requestId]
    ensure(
      record &&
        entry.agentId === record.agentId &&
        entry.taskId === record.taskId &&
        entry.providerId === record.selectedProviderId &&
        entry.modelId === record.selectedModelId &&
        entry.capability === record.capability &&
        entry.unit === 'credit-micros' &&
        entry.estimateMicros === record.estimateMicros &&
        Number.isFinite(Date.parse(entry.occurredAt)),
      'INVALID_PROVIDER_REQUEST',
      'Restored ledger provenance is inconsistent.',
    )
    creditInteger(entry.reservedMicros)
    creditInteger(entry.chargedMicros)
    if (entry.actualMicros !== null) creditInteger(entry.actualMicros)
    ensure(
      entry.chargedMicros === (entry.actualMicros ?? 0),
      'INVALID_PROVIDER_REQUEST',
      'Restored ledger actual charge is inconsistent.',
    )
    if (entry.kind === 'reserved')
      ensure(
        entry.status === 'reserved' &&
          entry.reservedMicros === record.estimateMicros &&
          entry.actualMicros === null &&
          entry.reconciliationId === null,
        'INVALID_PROVIDER_REQUEST',
        'Restored reservation entry is inconsistent.',
      )
    if (entry.kind === 'denied')
      ensure(
        entry.status === 'denied' &&
          entry.reservedMicros === 0 &&
          entry.actualMicros === null &&
          entry.reconciliationId === null,
        'INVALID_PROVIDER_REQUEST',
        'Restored denial entry is inconsistent.',
      )
    if (entry.kind === 'unresolved')
      ensure(
        ['failed', 'cancelled'].includes(entry.status) &&
          entry.reservedMicros === record.estimateMicros &&
          entry.actualMicros === null &&
          entry.reconciliationId === null,
        'INVALID_PROVIDER_REQUEST',
        'Restored unresolved entry is inconsistent.',
      )
    if (entry.kind === 'settled')
      ensure(
        ['succeeded', 'failed', 'cancelled'].includes(entry.status) &&
          entry.reservedMicros === 0 &&
          entry.reconciliationId === null &&
          (entry.status !== 'succeeded' || entry.actualMicros !== null),
        'INVALID_PROVIDER_REQUEST',
        'Restored settlement entry is inconsistent.',
      )
    if (entry.kind === 'reconciled')
      ensure(
        ['failed', 'cancelled'].includes(entry.status) &&
          entry.reservedMicros === 0 &&
          entry.actualMicros !== null &&
          entry.reconciliationId !== null,
        'INVALID_PROVIDER_REQUEST',
        'Restored reconciliation entry is inconsistent.',
      )
  }
  for (const record of Object.values(records)) {
    const history = ledger.filter(
      (entry) => entry.requestId === record.requestId,
    )
    const first = history[0],
      last = history.at(-1)
    ensure(
      first &&
        last &&
        history.length <= 3 &&
        first.kind === (record.status === 'denied' ? 'denied' : 'reserved') &&
        first.chargedMicros === 0 &&
        first.actualMicros === null &&
        first.reservedMicros ===
          (record.status === 'denied' ? 0 : record.estimateMicros),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider reservation history is incomplete.',
    )
    ensure(
      last.status === record.status &&
        last.reservedMicros === providerReservedMicros(record) &&
        last.chargedMicros === (record.actualMicros ?? 0) &&
        last.actualMicros === record.actualMicros &&
        last.reconciliationId === record.reconciliationId,
      'INVALID_PROVIDER_REQUEST',
      'Restored provider ledger does not match its current record.',
    )
    const expectedKinds =
      record.status === 'denied'
        ? ['denied']
        : record.status === 'reserved'
          ? ['reserved']
          : record.reconciliationId !== null
            ? ['reserved', 'unresolved', 'reconciled']
            : [
                'reserved',
                record.disposition === 'unknown' ? 'unresolved' : 'settled',
              ]
    ensure(
      JSON.stringify(history.map((entry) => entry.kind)) ===
        JSON.stringify(expectedKinds),
      'INVALID_PROVIDER_REQUEST',
      'Restored provider ledger lifecycle is invalid.',
    )
  }
}
