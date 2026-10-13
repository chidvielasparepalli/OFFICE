import type { RuntimeState } from '../runtime/runtimeTypes'
import type { providerCostSummary } from '../providers/costPolicy'

export const REALTIME_CHANNEL = 'office:runtime' as const
export const REALTIME_MAPS = [
  'agents',
  'tasks',
  'workstations',
  'departments',
  'requests',
  'plans',
  'toolExecutions',
  'memories',
  'qaRequests',
  'repairRequests',
  'artifacts',
  'providerRequests',
] as const
export type RealtimeMap = (typeof REALTIME_MAPS)[number]
export const REALTIME_VALUES = [
  'connection',
  'creditLedger',
  'events',
  'activities',
  'selectedAgentId',
  'selectedTaskId',
] as const
export type RealtimeValue = (typeof REALTIME_VALUES)[number]

/** Read models of accepted runtime events/links, never independent business entities. */
export interface RealtimeNotification {
  readonly id: string
  readonly eventId: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly text: string
  readonly agentId: string | null
  readonly taskId: string | null
  readonly occurredAt: string
}
export interface RealtimeHandoff {
  readonly id: string
  readonly artifactId: string
  readonly fromTaskId: string | null
  readonly toTaskId: string
  readonly toAgentId: string | null
}
/** Metadata-only recipient projection, structurally compatible with the existing office bridge. */
export interface RealtimeView {
  readonly state: RuntimeState
  readonly notifications: readonly RealtimeNotification[]
  readonly handoffs: readonly RealtimeHandoff[]
  readonly costs: ReturnType<typeof providerCostSummary>
}
export type RealtimeDelta = {
  readonly records: {
    readonly [K in RealtimeMap]?: Readonly<
      Record<string, RuntimeState[K][string] | null>
    >
  }
  readonly values: Partial<Pick<RuntimeState, RealtimeValue>>
  readonly notifications?: RealtimeView['notifications']
  readonly handoffs?: RealtimeView['handoffs']
  readonly costs?: RealtimeView['costs']
}
interface EnvelopeIdentity {
  readonly protocol: 1
  readonly channel: typeof REALTIME_CHANNEL
  readonly streamId: string
  readonly revision: number
}
export interface RealtimeSnapshot extends EnvelopeIdentity {
  readonly kind: 'snapshot'
  readonly view: RealtimeView
}
export interface RealtimeEvent extends EnvelopeIdentity {
  readonly kind: 'delta'
  readonly baseRevision: number
  readonly changes: RealtimeDelta
}
export type RealtimeEnvelope = RealtimeSnapshot | RealtimeEvent
export type RealtimeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'resyncing'
  | 'degraded'
export interface RealtimeConnectionState {
  readonly status: RealtimeStatus
  readonly revision: number | null
  readonly error:
    | 'TRANSPORT_CLOSED'
    | 'INVALID_MESSAGE'
    | 'SNAPSHOT_REQUIRED'
    | 'UNAVAILABLE'
    | null
}
export interface RealtimeObserver {
  message(value: unknown): void
  closed(): void
}
export interface RealtimeConnection {
  readonly streamId: string
  /** Called after the live subscription is installed; recovery never requires perfect history. */
  requestSnapshot(): Promise<unknown>
  close(): void
}
export interface RealtimeTransport {
  /** Authority/audience belongs to this host-bound adapter, not to browser selection. */
  connect(observer: RealtimeObserver): Promise<RealtimeConnection>
}
