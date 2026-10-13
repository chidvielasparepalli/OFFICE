import {
  applyRealtimeDelta,
  emptyRealtimeView,
  equalRealtime,
  readRealtimeEnvelope,
  reconcileRealtime,
} from './realtimeCodec'
import type {
  RealtimeConnection,
  RealtimeConnectionState,
  RealtimeEnvelope,
  RealtimeStatus,
  RealtimeTransport,
} from './realtimeTypes'

interface StoreOptions {
  reconnectDelayMs?: number
  maxReconnectAttempts?: number
}

/** Read-only materialized view. It has no commands, reducer, persistence, or business decisions. */
export class RealtimeStore {
  private readonly transport: RealtimeTransport
  private readonly options: Required<StoreOptions>
  private view = emptyRealtimeView()
  private connectionState: RealtimeConnectionState = Object.freeze({
    status: 'disconnected',
    revision: null,
    error: null,
  })
  private connection: RealtimeConnection | null = null
  private streamId: string | null = null
  private readonly listeners = new Set<() => void>()
  private pending: RealtimeEnvelope[] = []
  private generation = 0
  private syncing = false
  private disposed = false
  private desired = false
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private opening: Promise<void> | null = null
  private synchronization: Promise<void> | null = null
  private counters = {
    received: 0,
    applied: 0,
    duplicates: 0,
    stale: 0,
    gaps: 0,
    invalid: 0,
    snapshots: 0,
    reconnects: 0,
  }

  constructor(transport: RealtimeTransport, options: StoreOptions = {}) {
    this.transport = transport
    this.options = {
      reconnectDelayMs: options.reconnectDelayMs ?? 250,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 3,
    }
    if (
      !Number.isFinite(this.options.reconnectDelayMs) ||
      this.options.reconnectDelayMs < 0 ||
      !Number.isInteger(this.options.maxReconnectAttempts) ||
      this.options.maxReconnectAttempts < 0 ||
      this.options.maxReconnectAttempts > 10
    )
      throw new Error('Invalid realtime recovery limits.')
  }
  getSnapshot = () => this.view.state
  getView = () => this.view
  getConnection = () => this.connectionState
  getMetrics = () => ({
    ...this.counters,
    subscribers: this.listeners.size,
    pendingMessages: this.pending.length,
  })
  subscribe = (listener: () => void) => {
    if (this.disposed) throw new Error('Realtime store disposed.')
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private notify() {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* A view subscriber cannot interrupt ordering or other consumers. */
      }
    }
  }
  private status(
    status: RealtimeStatus,
    error: RealtimeConnectionState['error'] = null,
  ) {
    const next = {
      status,
      revision: this.streamId ? this.view.state.revision : null,
      error,
    }
    if (equalRealtime(next, this.connectionState)) return
    this.connectionState = Object.freeze(next)
    this.notify()
  }
  private current(generation: number) {
    return this.desired && !this.disposed && generation === this.generation
  }
  private clearConnection() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const old = this.connection
    this.connection = null
    this.pending = []
    this.syncing = false
    this.synchronization = null
    this.opening = null
    try {
      old?.close()
    } catch {
      /* Host/transport diagnostics never cross the public state boundary. */
    }
  }
  connect = (): Promise<void> => {
    if (this.disposed)
      return Promise.reject(new Error('Realtime store disposed.'))
    this.desired = true
    if (this.opening) return this.opening
    if (this.connection) return this.synchronization ?? Promise.resolve()
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const generation = ++this.generation
    this.syncing = true
    const operation = (async () => {
      // Register the in-flight operation before a custom adapter can throw synchronously.
      await Promise.resolve()
      if (!this.current(generation)) return
      try {
        const connection = await this.transport.connect({
          message: (value) => this.receive(value, generation),
          closed: () => this.lost(generation),
        })
        if (!this.current(generation)) {
          connection.close()
          return
        }
        this.connection = connection
        if (this.streamId && this.streamId !== connection.streamId) {
          // A new authority may restart revisions. No old stream update may cross this boundary.
          this.streamId = null
        }
        this.syncing = false
        await this.synchronize(generation)
      } catch {
        this.lost(generation)
      } finally {
        if (this.current(generation)) this.opening = null
      }
    })()
    this.opening = operation
    this.status(this.streamId ? 'reconnecting' : 'connecting')
    return operation
  }
  private lost(generation: number) {
    if (!this.current(generation)) return
    ++this.generation
    this.clearConnection()
    if (this.attempts >= this.options.maxReconnectAttempts) {
      this.status('degraded', 'UNAVAILABLE')
      return
    }
    const delay = Math.min(
      this.options.reconnectDelayMs * 2 ** this.attempts++,
      30_000,
    )
    this.status('reconnecting', 'TRANSPORT_CLOSED')
    this.timer = setTimeout(() => {
      this.timer = null
      this.counters.reconnects++
      void this.connect()
    }, delay)
  }
  disconnect = () => {
    this.desired = false
    ++this.generation
    this.clearConnection()
    this.status('disconnected')
  }
  reconnect = async () => {
    this.disconnect()
    this.attempts = 0
    await this.connect()
  }
  /** Visibility/online resume is an explicit reconciliation signal, never a polling loop. */
  resume = async () => {
    if (this.disposed) return
    if (!this.connection) await this.reconnect()
    else await this.synchronize(this.generation)
  }
  private receive(value: unknown, generation: number) {
    if (!this.current(generation)) return
    this.counters.received++
    try {
      const envelope = readRealtimeEnvelope(value)
      if (this.connection && envelope.streamId !== this.connection.streamId)
        throw new Error('Invalid stream.')
      if (this.syncing || !this.connection) {
        if (this.pending.length >= 128)
          throw new Error('Realtime buffer exceeded.')
        this.pending.push(envelope)
        return
      }
      if (!this.consume(envelope)) void this.synchronize(generation)
    } catch {
      this.counters.invalid++
      this.status('degraded', 'INVALID_MESSAGE')
      if (this.connection) void this.synchronize(generation)
      else this.lost(generation)
    }
  }
  /** False means a gap; no part of that transaction is applied. */
  private consume(envelope: RealtimeEnvelope): boolean {
    if (envelope.streamId !== this.connection?.streamId)
      throw new Error('Invalid stream.')
    const hasSnapshot = this.streamId === envelope.streamId
    const revision = hasSnapshot ? this.view.state.revision : -1
    if (envelope.revision < revision) {
      this.counters.stale++
      return true
    }
    if (envelope.revision === revision) {
      if (
        envelope.kind === 'snapshot' &&
        !equalRealtime(envelope.view, this.view)
      )
        throw new Error('Conflicting snapshot.')
      this.counters.duplicates++
      return true
    }
    if (
      envelope.kind === 'delta' &&
      (!hasSnapshot || envelope.baseRevision !== revision)
    ) {
      this.counters.gaps++
      return false
    }
    this.view =
      envelope.kind === 'snapshot'
        ? reconcileRealtime(this.view, envelope.view)
        : applyRealtimeDelta(this.view, envelope)
    this.streamId = envelope.streamId
    this.counters.applied++
    if (envelope.kind === 'snapshot') this.counters.snapshots++
    const oldConnection = this.connectionState
    this.status(oldConnection.status, oldConnection.error)
    if (this.connectionState === oldConnection) this.notify()
    return true
  }
  private synchronize(generation: number): Promise<void> {
    if (this.synchronization) return this.synchronization
    const connection = this.connection
    if (!connection || !this.current(generation)) return Promise.resolve()
    this.syncing = true
    const operation = (async () => {
      await Promise.resolve()
      if (!this.current(generation) || this.connection !== connection) return
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const raw = await connection.requestSnapshot()
          if (!this.current(generation) || this.connection !== connection)
            return
          const snapshot = readRealtimeEnvelope(raw)
          if (
            snapshot.kind !== 'snapshot' ||
            snapshot.streamId !== connection.streamId
          )
            throw new Error('Snapshot required.')
          if (
            this.streamId === snapshot.streamId &&
            snapshot.revision < this.view.state.revision
          ) {
            this.counters.stale++
            continue
          }
          this.consume(snapshot)
          if (!this.current(generation) || this.connection !== connection)
            return
          let gap = false
          let replayed = 0
          // Notifications can synchronously trigger another accepted host command while replaying.
          while (this.pending.length && !gap) {
            const pending = this.pending
            this.pending = []
            for (const event of pending) {
              if (++replayed > 256 || !this.consume(event)) {
                gap = true
                break
              }
              if (!this.current(generation) || this.connection !== connection)
                return
            }
          }
          if (gap) continue
          this.attempts = 0
          this.syncing = false
          this.status('connected')
          return
        }
        throw new Error('Authoritative snapshot unavailable.')
      } catch {
        if (this.current(generation)) {
          this.counters.invalid++
          ++this.generation
          this.clearConnection()
          this.status('degraded', 'INVALID_MESSAGE')
        }
      } finally {
        if (this.current(generation)) {
          this.syncing = false
          this.synchronization = null
        }
      }
    })()
    this.synchronization = operation
    this.status('resyncing', this.streamId ? 'SNAPSHOT_REQUIRED' : null)
    return operation
  }
  dispose = () => {
    if (this.disposed) return
    this.disconnect()
    this.disposed = true
    this.listeners.clear()
  }
}
