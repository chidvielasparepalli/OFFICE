import type { RuntimeState } from '../runtime/runtimeTypes'
import { diffRealtime, freezeRealtime, realtimeSnapshot } from './realtimeCodec'
import {
  REALTIME_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeView,
} from './realtimeTypes'
import { validateRealtimeView } from './realtimeValidation'

interface PublisherOptions {
  runtime: {
    getSnapshot(): RuntimeState
    subscribe(listener: () => void): () => void
  }
  streamId: string
  project(state: RuntimeState): RealtimeView
}
/** One recipient-bound publisher; the runtime owns all revisions and business decisions. */
export class RealtimePublisher {
  private readonly options: PublisherOptions
  private view: RealtimeView
  private readonly listeners = new Map<
    (message: RealtimeEnvelope) => void,
    (() => void) | undefined
  >()
  private readonly unsubscribe: () => void
  private disposed = false
  private unavailable = false
  private published = 0
  constructor(options: PublisherOptions) {
    this.options = options
    this.view = this.project()
    this.unsubscribe = options.runtime.subscribe(() => this.publish())
  }
  private project() {
    try {
      return freezeRealtime(
        validateRealtimeView(
          this.options.project(this.options.runtime.getSnapshot()),
        ),
      )
    } catch {
      throw new Error('Realtime unavailable.')
    }
  }
  private publish() {
    if (this.disposed) return
    try {
      const state = this.options.runtime.getSnapshot()
      if (state.revision <= this.view.state.revision && !this.unavailable)
        return
      const next = this.project()
      // Reentrant runtime subscribers may coalesce commits; only a snapshot can fill that gap.
      const message: RealtimeEnvelope =
        !this.unavailable &&
        next.state.revision === this.view.state.revision + 1
          ? freezeRealtime({
              protocol: 1,
              channel: REALTIME_CHANNEL,
              streamId: this.options.streamId,
              kind: 'delta',
              baseRevision: this.view.state.revision,
              revision: next.state.revision,
              changes: diffRealtime(this.view, next),
            })
          : realtimeSnapshot(this.options.streamId, next)
      this.view = next
      this.unavailable = false
      this.published++
      for (const listener of [...this.listeners.keys()]) {
        try {
          listener(message)
        } catch {
          /* A failed consumer cannot block other subscribers. */
        }
      }
    } catch {
      this.unavailable = true
      for (const closed of [...this.listeners.values()]) {
        try {
          closed?.()
        } catch {
          /* Never publish unsafe projection errors. */
        }
      }
      this.listeners.clear()
    }
  }
  snapshot = () => {
    if (this.disposed) throw new Error('Realtime unavailable.')
    // Projection is deterministic for this committed revision and fixed audience.
    this.view = this.project()
    this.unavailable = false
    return realtimeSnapshot(this.options.streamId, this.view)
  }
  subscribe = (
    listener: (message: RealtimeEnvelope) => void,
    onUnavailable?: () => void,
  ) => {
    if (this.disposed || this.unavailable)
      throw new Error('Realtime unavailable.')
    this.listeners.set(listener, onUnavailable)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getMetrics = () => ({
    published: this.published,
    subscribers: this.listeners.size,
    disposed: this.disposed,
  })
  dispose = () => {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    for (const closed of [...this.listeners.values()]) {
      try {
        closed?.()
      } catch {
        /* Cleanup must reach every subscriber. */
      }
    }
    this.listeners.clear()
  }
}
