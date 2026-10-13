import type { RealtimePublisher } from './RealtimePublisher'
import type { RealtimeObserver, RealtimeTransport } from './realtimeTypes'

/** Deterministic in-process adapter; no second store and no polling. */
export class LocalRealtimeTransport implements RealtimeTransport {
  private readonly publisher: RealtimePublisher
  constructor(publisher: RealtimePublisher) {
    this.publisher = publisher
  }
  async connect(observer: RealtimeObserver) {
    let open = true
    const unsubscribe = this.publisher.subscribe(
      (message) => {
        if (open) observer.message(message)
      },
      () => {
        if (open) {
          open = false
          observer.closed()
        }
      },
    )
    try {
      const streamId = this.publisher.snapshot().streamId
      return {
        streamId,
        requestSnapshot: async () => {
          if (!open) throw new Error('Realtime unavailable.')
          return this.publisher.snapshot()
        },
        close: () => {
          open = false
          unsubscribe()
        },
      }
    } catch {
      unsubscribe()
      throw new Error('Realtime unavailable.')
    }
  }
}
