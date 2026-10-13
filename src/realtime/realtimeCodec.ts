import type { RuntimeState } from '../runtime/runtimeTypes'
import {
  REALTIME_CHANNEL,
  REALTIME_MAPS,
  REALTIME_VALUES,
  type RealtimeDelta,
  type RealtimeEnvelope,
  type RealtimeSnapshot,
  type RealtimeView,
} from './realtimeTypes'
import { validateRealtimeView } from './realtimeValidation'

export function realtimeAssert(value: unknown): asserts value {
  if (!value) throw new Error('Invalid realtime message.')
}
function object(
  value: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  realtimeAssert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  )
  realtimeAssert(
    Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null,
  )
  const record = value as Record<string, unknown>
  if (keys)
    realtimeAssert(Object.keys(record).every((key) => keys.includes(key)))
  return record
}
export function freezeRealtime<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeRealtime(child)
    Object.freeze(value)
  }
  return value
}
export function equalRealtime(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
export function emptyRealtimeView(): RealtimeView {
  return freezeRealtime({
    state: {
      agents: {},
      tasks: {},
      workstations: {},
      departments: {},
      requests: {},
      plans: {},
      toolExecutions: {},
      memories: {},
      qaRequests: {},
      repairRequests: {},
      artifacts: {},
      providerRequests: {},
      recruitments: {},
      employees: {},
      creditLedger: [],
      events: [],
      activities: [],
      connection: 'disconnected',
      revision: 0,
      selectedAgentId: null,
      selectedTaskId: null,
    },
    notifications: [],
    handoffs: [],
    costs: {
      unit: 'credit-micros',
      chargedMicros: '0',
      reservedMicros: '0',
      unresolvedRequests: 0,
      requestCount: 0,
    },
  })
}

/** Retain entity references so a transport tick cannot remount or rebuild the R3F office. */
export function reconcileRealtime(
  previous: RealtimeView,
  next: RealtimeView,
): RealtimeView {
  const state = { ...next.state }
  for (const key of REALTIME_MAPS) {
    const oldMap = previous.state[key] as Readonly<Record<string, unknown>>
    const newMap = next.state[key] as Readonly<Record<string, unknown>>
    const entries = Object.fromEntries(
      Object.entries(newMap).map(([id, record]) => [
        id,
        equalRealtime(oldMap[id], record) ? oldMap[id] : record,
      ]),
    )
    Object.assign(state, {
      [key]: equalRealtime(oldMap, entries) ? oldMap : entries,
    })
  }
  for (const key of REALTIME_VALUES)
    if (equalRealtime(previous.state[key], state[key]))
      Object.assign(state, { [key]: previous.state[key] })
  return freezeRealtime({
    state,
    notifications: equalRealtime(previous.notifications, next.notifications)
      ? previous.notifications
      : next.notifications,
    handoffs: equalRealtime(previous.handoffs, next.handoffs)
      ? previous.handoffs
      : next.handoffs,
    costs: equalRealtime(previous.costs, next.costs)
      ? previous.costs
      : next.costs,
  })
}

export function diffRealtime(
  previous: RealtimeView,
  next: RealtimeView,
): RealtimeDelta {
  const records: Record<string, Record<string, unknown>> = {}
  for (const key of REALTIME_MAPS) {
    const oldMap = previous.state[key] as Readonly<Record<string, unknown>>
    const newMap = next.state[key] as Readonly<Record<string, unknown>>
    const changed: Record<string, unknown> = {}
    for (const id of new Set([...Object.keys(oldMap), ...Object.keys(newMap)]))
      if (!equalRealtime(oldMap[id], newMap[id]))
        changed[id] = newMap[id] ?? null
    if (Object.keys(changed).length) records[key] = changed
  }
  const values: Partial<Pick<RuntimeState, (typeof REALTIME_VALUES)[number]>> =
    {}
  for (const key of REALTIME_VALUES)
    if (!equalRealtime(previous.state[key], next.state[key]))
      Object.assign(values, { [key]: next.state[key] })
  return freezeRealtime({
    records,
    values,
    ...(!equalRealtime(previous.notifications, next.notifications)
      ? { notifications: next.notifications }
      : {}),
    ...(!equalRealtime(previous.handoffs, next.handoffs)
      ? { handoffs: next.handoffs }
      : {}),
    ...(!equalRealtime(previous.costs, next.costs)
      ? { costs: next.costs }
      : {}),
  }) as RealtimeDelta
}

/** The wire is untrusted even for a local adapter. Never return raw parser/validation details. */
export function readRealtimeEnvelope(input: unknown): RealtimeEnvelope {
  try {
    const raw = object(input)
    realtimeAssert(JSON.stringify(raw).length <= 4 * 1024 * 1024)
    const value = structuredClone(raw)
    object(
      value,
      value.kind === 'snapshot'
        ? ['protocol', 'channel', 'streamId', 'revision', 'kind', 'view']
        : [
            'protocol',
            'channel',
            'streamId',
            'revision',
            'kind',
            'baseRevision',
            'changes',
          ],
    )
    realtimeAssert(value.protocol === 1 && value.channel === REALTIME_CHANNEL)
    realtimeAssert(
      typeof value.streamId === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/u.test(value.streamId),
    )
    realtimeAssert(
      Number.isSafeInteger(value.revision) && (value.revision as number) >= 0,
    )
    if (value.kind === 'snapshot') {
      const view = validateRealtimeView(value.view)
      realtimeAssert(view.state.revision === value.revision)
    } else {
      realtimeAssert(
        value.kind === 'delta' &&
          Number.isSafeInteger(value.baseRevision) &&
          (value.baseRevision as number) >= 0,
      )
      realtimeAssert(value.revision === (value.baseRevision as number) + 1)
      const changes = object(value.changes, [
        'records',
        'values',
        'notifications',
        'handoffs',
        'costs',
      ])
      const records = object(changes.records, REALTIME_MAPS)
      object(changes.values, REALTIME_VALUES)
      for (const map of Object.values(records)) {
        for (const [id, record] of Object.entries(object(map))) {
          realtimeAssert(
            /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/u.test(id) &&
              !['constructor', 'prototype', '__proto__'].includes(id),
          )
          if (record !== null) object(record)
        }
      }
    }
    return freezeRealtime(value) as unknown as RealtimeEnvelope
  } catch {
    throw new Error('Invalid realtime message.')
  }
}

export function applyRealtimeDelta(
  previous: RealtimeView,
  event: Extract<RealtimeEnvelope, { kind: 'delta' }>,
): RealtimeView {
  const state = {
    ...previous.state,
    ...event.changes.values,
    revision: event.revision,
  }
  for (const key of REALTIME_MAPS) {
    const changes = event.changes.records[key]
    if (!changes) continue
    const map: Record<string, unknown> = { ...previous.state[key] }
    for (const [id, record] of Object.entries(changes)) {
      if (record === null) delete map[id]
      else map[id] = record
    }
    Object.assign(state, { [key]: map })
  }
  const view = {
    state,
    notifications: Object.hasOwn(event.changes, 'notifications')
      ? event.changes.notifications!
      : previous.notifications,
    handoffs: Object.hasOwn(event.changes, 'handoffs')
      ? event.changes.handoffs!
      : previous.handoffs,
    costs: Object.hasOwn(event.changes, 'costs')
      ? event.changes.costs!
      : previous.costs,
  }
  validateRealtimeView(view)
  return reconcileRealtime(previous, view)
}

export function realtimeSnapshot(
  streamId: string,
  view: RealtimeView,
): RealtimeSnapshot {
  return freezeRealtime({
    protocol: 1,
    channel: REALTIME_CHANNEL,
    streamId,
    revision: view.state.revision,
    kind: 'snapshot',
    view,
  })
}
