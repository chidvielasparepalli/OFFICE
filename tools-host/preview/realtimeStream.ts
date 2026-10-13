import type { ServerResponse } from 'node:http'
import type { RealtimeEnvelope } from '../../src/realtime/realtimeTypes'

/** One persistent stream per browser; bounded queue closes slow consumers for snapshot recovery. */
export function openRealtimeStream(
  session: {
    sessionId?: string
    streamId: string
    subscribe(
      message: (envelope: RealtimeEnvelope) => void,
      closed: () => void,
    ): () => void
  },
  response: ServerResponse,
) {
  const queue: string[] = []
  let queuedBytes = 0
  let blocked = false
  let ended = false
  let unsubscribe = () => {}
  const close = () => {
    if (ended) return
    ended = true
    unsubscribe()
    queue.length = 0
    queuedBytes = 0
    if (!response.destroyed && !response.writableEnded) response.end()
  }
  const write = (value: unknown) => {
    if (ended || response.destroyed || response.writableEnded) return
    const line = `${JSON.stringify(value)}\n`
    if (Buffer.byteLength(line) > 4_000_000) {
      close()
      return
    }
    if (blocked) {
      queuedBytes += Buffer.byteLength(line)
      if (queue.length >= 128 || queuedBytes > 4_000_000) {
        close()
        return
      }
      queue.push(line)
    } else blocked = !response.write(line)
  }
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/x-ndjson')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.on('drain', () => {
    blocked = false
    while (!blocked && queue.length) {
      const line = queue.shift()!
      queuedBytes -= Buffer.byteLength(line)
      blocked = !response.write(line)
    }
  })
  response.once('close', close)
  unsubscribe = session.subscribe(write, close)
  // Subscription exists before the browser is allowed to request its initial snapshot.
  write({
    type: 'realtime-ready',
    sessionId: session.sessionId,
    streamId: session.streamId,
  })
}
