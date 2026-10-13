// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RealtimeStore } from './RealtimeStore'
import { RealtimePublisher } from './RealtimePublisher'
import { LocalRealtimeTransport } from './LocalRealtimeTransport'
import {
  applyRealtimeDelta,
  diffRealtime,
  emptyRealtimeView,
  readRealtimeEnvelope,
  realtimeSnapshot,
} from './realtimeCodec'
import {
  REALTIME_CHANNEL,
  type RealtimeEvent,
  type RealtimeObserver,
  type RealtimeTransport,
  type RealtimeView,
} from './realtimeTypes'

const stream = 'test:office'
function view(revision: number, name = `Department ${revision}`): RealtimeView {
  const empty = emptyRealtimeView()
  return {
    ...empty,
    state: {
      ...empty.state,
      revision,
      connection: 'local',
      departments: {
        engineering: { id: 'engineering', name, description: null },
      },
    },
  }
}
function event(previous: RealtimeView, next: RealtimeView): RealtimeEvent {
  return {
    protocol: 1,
    channel: REALTIME_CHANNEL,
    streamId: stream,
    kind: 'delta',
    baseRevision: previous.state.revision,
    revision: next.state.revision,
    changes: diffRealtime(previous, next),
  }
}
class ManualTransport implements RealtimeTransport {
  current = view(1)
  observer: RealtimeObserver | null = null
  closed = 0
  connected = 0
  snapshots = 0
  snapshotHook?: () => Promise<unknown>
  onConnect?: () => void
  async connect(observer: RealtimeObserver) {
    this.observer = observer
    this.connected++
    this.onConnect?.()
    return {
      streamId: stream,
      close: () => {
        this.closed++
        this.observer = null
      },
      requestSnapshot: async () => {
        this.snapshots++
        return this.snapshotHook
          ? this.snapshotHook()
          : realtimeSnapshot(stream, this.current)
      },
    }
  }
  send(value: unknown) {
    this.observer?.message(value)
  }
}
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn())
  vi.useRealTimers()
})
async function setup() {
  const transport = new ManualTransport()
  const store = new RealtimeStore(transport, { reconnectDelayMs: 1 })
  cleanup.push(store.dispose)
  await store.connect()
  return { transport, store }
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('realtime ordering and atomic read cache', () => {
  it('connects via snapshot and freezes the published cache', async () => {
    const { store, transport } = await setup()
    expect(store.getConnection()).toEqual({
      status: 'connected',
      revision: 1,
      error: null,
    })
    expect(transport.snapshots).toBe(1)
    expect(Object.isFrozen(store.getSnapshot().departments.engineering)).toBe(
      true,
    )
  })
  it('applies ordered updates, retaining unrelated collection/entity references', async () => {
    const { store, transport } = await setup()
    const before = store.getSnapshot()
    transport.send(event(view(1), view(2)))
    expect(store.getSnapshot().departments.engineering.name).toBe(
      'Department 2',
    )
    expect(store.getSnapshot().agents).toBe(before.agents)
    expect(store.getSnapshot().activities).toBe(before.activities)
    const department = store.getSnapshot().departments.engineering
    transport.send(event(view(2), view(3, 'Department 2')))
    expect(store.getSnapshot().departments.engineering).toBe(department)
  })
  it('ignores duplicate and stale events without rolling back', async () => {
    const { store, transport } = await setup()
    transport.send(event(view(1), view(2)))
    transport.send(event(view(1), view(2)))
    transport.send(event(view(0), view(1)))
    expect(store.getSnapshot().revision).toBe(2)
    expect(store.getMetrics()).toMatchObject({ duplicates: 1, stale: 1 })
    expect(transport.snapshots).toBe(1)
  })
  it('detects a gap, keeps last known state, and recovers an authoritative snapshot', async () => {
    const { store, transport } = await setup()
    let release!: (value: unknown) => void
    transport.snapshotHook = () =>
      new Promise((resolve) => {
        release = resolve
      })
    transport.send(event(view(3), view(4)))
    expect(store.getSnapshot().revision).toBe(1)
    expect(store.getConnection().status).toBe('resyncing')
    transport.send(event(view(1), view(2)))
    await settle()
    release(realtimeSnapshot(stream, view(4)))
    await settle()
    expect(store.getSnapshot().revision).toBe(4)
    expect(store.getConnection().status).toBe('connected')
    expect(store.getMetrics()).toMatchObject({ gaps: 1, stale: 1 })
  })
  it('buffers updates arriving while the first snapshot is pending', async () => {
    const transport = new ManualTransport()
    const store = new RealtimeStore(transport)
    cleanup.push(store.dispose)
    let release!: (value: unknown) => void
    transport.snapshotHook = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const connection = store.connect()
    await settle()
    transport.send(event(view(1), view(2)))
    release(realtimeSnapshot(stream, view(1)))
    await connection
    expect(store.getSnapshot().revision).toBe(2)
  })
  it('installs the observer before requesting a snapshot', async () => {
    const transport = new ManualTransport()
    transport.onConnect = () => transport.send(event(view(1), view(2)))
    const store = new RealtimeStore(transport)
    cleanup.push(store.dispose)
    await store.connect()
    expect(store.getSnapshot().revision).toBe(2)
  })
  it('does not duplicate state for duplicate or older snapshots', async () => {
    const { store, transport } = await setup()
    const previous = store.getSnapshot()
    transport.send(realtimeSnapshot(stream, view(1)))
    transport.send(realtimeSnapshot(stream, view(0)))
    expect(store.getSnapshot()).toBe(previous)
    expect(store.getMetrics()).toMatchObject({ duplicates: 1, stale: 1 })
  })
  it('rejects conflicting same-revision snapshot and restores authority', async () => {
    const { store, transport } = await setup()
    transport.send(realtimeSnapshot(stream, view(1, 'Unaccepted change')))
    await settle()
    expect(store.getSnapshot().departments.engineering.name).toBe(
      'Department 1',
    )
    expect(store.getMetrics().invalid).toBe(1)
  })
  it('validates the entire atomic delta before applying any of it', async () => {
    const { store, transport } = await setup()
    const delta = event(view(1), view(2))
    transport.send({
      ...delta,
      changes: {
        ...delta.changes,
        records: {
          ...delta.changes.records,
          tasks: {
            unsafe: {
              id: 'unsafe',
              metadata: { password: 'SYNTHETIC-DO-NOT-USE' },
            },
          },
        },
      },
    })
    await settle()
    expect(store.getSnapshot().revision).toBe(1)
    expect(store.getSnapshot().tasks).toEqual({})
    expect(JSON.stringify(store.getView())).not.toContain(
      'SYNTHETIC-DO-NOT-USE',
    )
  })
  it('rejects an unrelated stream without applying its revision', async () => {
    const { store, transport } = await setup()
    transport.send(realtimeSnapshot('another:office', view(9)))
    await settle()
    expect(store.getSnapshot().revision).toBe(1)
    expect(store.getMetrics().invalid).toBe(1)
  })
  it('bounds resync retries when the transport cannot supply missing revisions', async () => {
    const { store, transport } = await setup()
    transport.snapshotHook = async () => {
      transport.send(event(view(3), view(4)))
      return realtimeSnapshot(stream, view(1))
    }
    transport.send(event(view(3), view(4)))
    await settle()
    expect(store.getConnection().status).toBe('degraded')
    expect(transport.snapshots).toBe(4)
    expect(store.getSnapshot().revision).toBe(1)
  })
})

describe('realtime lifecycle and cleanup', () => {
  it('disconnects without discarding truth and reconnects to missed changes', async () => {
    const { store, transport } = await setup()
    store.disconnect()
    expect(store.getSnapshot().revision).toBe(1)
    expect(store.getConnection().status).toBe('disconnected')
    transport.current = view(6)
    await store.reconnect()
    expect(store.getSnapshot().revision).toBe(6)
    expect(transport.connected).toBe(2)
  })
  it('reconnects on transport loss without polling while healthy', async () => {
    vi.useFakeTimers()
    const { store, transport } = await setup()
    transport.current = view(3)
    transport.observer!.closed()
    expect(store.getConnection().status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1)
    expect(store.getSnapshot().revision).toBe(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(transport.connected).toBe(2)
    expect(transport.snapshots).toBe(2)
  })
  it('resynchronizes on explicit browser resume', async () => {
    const { store, transport } = await setup()
    transport.current = view(7)
    await store.resume()
    expect(store.getSnapshot().revision).toBe(7)
    expect(transport.connected).toBe(1)
  })
  it('drains events triggered during snapshot and buffer reconciliation', async () => {
    const { store, transport } = await setup()
    let emitted = 1
    store.subscribe(() => {
      const revision = store.getSnapshot().revision
      if (revision >= 2 && revision < 4 && emitted < revision) {
        emitted = revision
        transport.send(event(view(revision), view(revision + 1)))
      }
    })
    transport.current = view(2)
    await store.resume()
    expect(store.getSnapshot().revision).toBe(4)
    expect(store.getMetrics().pendingMessages).toBe(0)
  })
  it('ignores old connection messages and late snapshots after reconnect', async () => {
    const { store, transport } = await setup()
    const oldObserver = transport.observer!
    let release!: (value: unknown) => void
    transport.snapshotHook = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const pending = store.resume()
    await settle()
    store.disconnect()
    transport.snapshotHook = undefined
    transport.current = view(4)
    await store.connect()
    oldObserver.message(realtimeSnapshot(stream, view(100)))
    release(realtimeSnapshot(stream, view(50)))
    await pending
    expect(store.getSnapshot().revision).toBe(4)
  })
  it('honors disconnect requested by a snapshot subscriber', async () => {
    const { store, transport } = await setup()
    store.subscribe(() => {
      if (
        store.getSnapshot().revision === 2 &&
        store.getConnection().status === 'resyncing'
      )
        store.disconnect()
    })
    transport.current = view(2)
    await store.resume()
    expect(store.getConnection().status).toBe('disconnected')
    expect(transport.observer).toBeNull()
  })
  it('can connect again when a lifecycle subscriber cancels initial connection', async () => {
    const transport = new ManualTransport(),
      store = new RealtimeStore(transport)
    cleanup.push(store.dispose)
    const cancel = store.subscribe(() => {
      if (store.getConnection().status === 'connecting') store.disconnect()
    })
    await store.connect()
    cancel()
    expect(transport.connected).toBe(0)
    await store.connect()
    expect(store.getConnection().status).toBe('connected')
  })
  it('can recover when a lifecycle subscriber cancels initial resync', async () => {
    const { transport, store } = await setup()
    const cancel = store.subscribe(() => {
      if (store.getConnection().status === 'resyncing') store.disconnect()
    })
    await store.resume()
    cancel()
    expect(store.getConnection().status).toBe('disconnected')
    await store.connect()
    expect(transport.connected).toBe(2)
    expect(store.getConnection().status).toBe('connected')
  })
  it('finishes disconnect even when a transport close throws', async () => {
    const transport = new ManualTransport()
    const store = new RealtimeStore({
      async connect(observer) {
        const connection = await transport.connect(observer)
        return {
          ...connection,
          close() {
            connection.close()
            throw new Error('SYNTHETIC-HOST-DIAGNOSTIC')
          },
        }
      },
    })
    cleanup.push(store.dispose)
    await store.connect()
    expect(() => store.disconnect()).not.toThrow()
    expect(store.getConnection().status).toBe('disconnected')
    expect(transport.observer).toBeNull()
    expect(store.getMetrics().pendingMessages).toBe(0)
  })
  it('recovers from an adapter that throws synchronously during connect', async () => {
    vi.useFakeTimers()
    const transport = new ManualTransport()
    let attempts = 0
    const store = new RealtimeStore(
      {
        connect(observer) {
          if (++attempts === 1) throw new Error('Unavailable')
          return transport.connect(observer)
        },
      },
      { reconnectDelayMs: 1 },
    )
    cleanup.push(store.dispose)
    await store.connect()
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)
    expect(store.getConnection().status).toBe('connected')
  })
  it('can reconnect after a synchronous snapshot failure', async () => {
    const transport = new ManualTransport()
    let attempts = 0
    const store = new RealtimeStore({
      async connect(observer) {
        const connection = await transport.connect(observer)
        return {
          ...connection,
          requestSnapshot() {
            if (++attempts === 1) throw new Error('Unavailable')
            return connection.requestSnapshot()
          },
        }
      },
    })
    cleanup.push(store.dispose)
    await store.connect()
    expect(store.getConnection().status).toBe('degraded')
    await store.reconnect()
    expect(store.getConnection().status).toBe('connected')
  })
  it('unsubscribes and disposes timers/connections safely', async () => {
    vi.useFakeTimers()
    const { store, transport } = await setup()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    transport.observer!.closed()
    store.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(listener).not.toHaveBeenCalled()
    expect(transport.connected).toBe(1)
    expect(store.getMetrics().subscribers).toBe(0)
    await expect(store.connect()).rejects.toThrow('disposed')
  })
  it('bounds automatic connection failures', async () => {
    vi.useFakeTimers()
    const connect = vi.fn(async () => {
      throw new Error('Unpublished host diagnostic.')
    })
    const store = new RealtimeStore(
      { connect },
      { reconnectDelayMs: 1, maxReconnectAttempts: 2 },
    )
    cleanup.push(store.dispose)
    await store.connect()
    await vi.advanceTimersByTimeAsync(100)
    expect(connect).toHaveBeenCalledTimes(3)
    expect(store.getConnection()).toMatchObject({
      status: 'degraded',
      error: 'UNAVAILABLE',
    })
    expect(JSON.stringify(store.getView())).not.toContain('Unpublished')
  })
  it('uses one runtime subscription and releases local listeners', async () => {
    let state = view(1).state
    const listeners = new Set<() => void>()
    const publisher = new RealtimePublisher({
      streamId: stream,
      runtime: {
        getSnapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => {
            listeners.delete(fn)
          }
        },
      },
      project: (state) => ({ ...emptyRealtimeView(), state }),
    })
    cleanup.push(publisher.dispose)
    const store = new RealtimeStore(new LocalRealtimeTransport(publisher))
    cleanup.push(store.dispose)
    await store.connect()
    expect(listeners.size).toBe(1)
    state = view(2).state
    for (const listener of listeners) listener()
    expect(store.getSnapshot().revision).toBe(2)
    store.disconnect()
    expect(publisher.getMetrics().subscribers).toBe(0)
    await store.connect()
    expect(publisher.getMetrics().subscribers).toBe(1)
    publisher.dispose()
    expect(listeners.size).toBe(0)
  })
  it('quarantines an unsafe publication and closes every subscriber', () => {
    let state = view(1).state
    let commit = () => {}
    const publisher = new RealtimePublisher({
      streamId: stream,
      runtime: {
        getSnapshot: () => state,
        subscribe(fn) {
          commit = fn
          return () => {}
        },
      },
      project(state) {
        if (state.revision > 1) throw new Error('SYNTHETIC-HOST-DIAGNOSTIC')
        return { ...emptyRealtimeView(), state }
      },
    })
    cleanup.push(publisher.dispose)
    const messages = vi.fn(),
      closed = vi.fn()
    publisher.subscribe(messages, () => {
      throw new Error('Consumer failure')
    })
    publisher.subscribe(() => {}, closed)
    state = view(2).state
    commit()
    expect(messages).not.toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
    expect(publisher.getMetrics().subscribers).toBe(0)
    expect(() => publisher.snapshot()).toThrow('Realtime unavailable.')
  })
  it('disposes every publisher subscriber even if one close callback throws', () => {
    const unsubscribe = vi.fn(),
      closed = vi.fn()
    const publisher = new RealtimePublisher({
      streamId: stream,
      runtime: {
        getSnapshot: () => view(1).state,
        subscribe: () => unsubscribe,
      },
      project: (state) => ({ ...emptyRealtimeView(), state }),
    })
    publisher.subscribe(
      () => {},
      () => {
        throw new Error('Consumer failure')
      },
    )
    publisher.subscribe(() => {}, closed)
    expect(() => publisher.dispose()).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
    expect(publisher.getMetrics().subscribers).toBe(0)
  })
})

describe('realtime wire contract', () => {
  it.each([
    { protocol: 2 },
    { channel: 'agent:polling' },
    { revision: -1 },
    { revision: 1.5 },
    { streamId: '../host' },
    { privileged: true },
    { kind: 'unknown' },
  ])('rejects invalid envelope %j', (patch) => {
    expect(() =>
      readRealtimeEnvelope({ ...realtimeSnapshot(stream, view(1)), ...patch }),
    ).toThrow('Invalid realtime message.')
  })
  it('rejects delta fields outside the normalized allowlist', () => {
    const delta = event(view(1), view(2))
    expect(() =>
      readRealtimeEnvelope({
        ...delta,
        changes: { ...delta.changes, values: { secretStore: {} } },
      }),
    ).toThrow()
    expect(() =>
      readRealtimeEnvelope({
        ...delta,
        changes: { ...delta.changes, records: { hostAdapters: {} } },
      }),
    ).toThrow()
    expect(() => readRealtimeEnvelope({ ...delta, baseRevision: 0 })).toThrow()
  })
  it('copies envelopes so senders cannot mutate cached data', () => {
    const source = structuredClone(realtimeSnapshot(stream, view(1)))
    const read = readRealtimeEnvelope(source)
    ;(source.view.state.departments.engineering as { name: string }).name =
      'Changed later'
    expect(
      read.kind === 'snapshot' && read.view.state.departments.engineering.name,
    ).toBe('Department 1')
  })
  it('tombstones revoked/deleted records', () => {
    const previous = view(1)
    const next = { ...view(2), state: { ...view(2).state, departments: {} } }
    expect(
      applyRealtimeDelta(previous, event(previous, next)).state.departments,
    ).toEqual({})
  })
  it.each(['notifications', 'handoffs', 'costs'])(
    'rejects a present null %s update',
    (key) => {
      const delta = event(view(1), view(2))
      const parsed = readRealtimeEnvelope({
        ...delta,
        changes: { ...delta.changes, [key]: null },
      })
      expect(() =>
        applyRealtimeDelta(view(1), parsed as RealtimeEvent),
      ).toThrow()
    },
  )
})
