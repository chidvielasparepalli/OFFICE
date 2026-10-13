// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { RealtimeEnvelope } from '../../src/realtime/realtimeTypes'
import type { RealtimePreviewSession } from './realtimeSession'
import { openRealtimeStream } from './realtimeStream'

describe('bounded host realtime stream', () => {
  it('unsubscribes slow consumers at the queue limit and stops all subsequent writes', () => {
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      write: vi.fn(() => false),
      end: vi.fn(),
      setHeader: vi.fn(),
    })
    let publish!: (envelope: RealtimeEnvelope) => void
    const unsubscribe = vi.fn()
    const session = {
      sessionId: 'bounded-session',
      streamId: 'bounded-stream',
      subscribe(message: typeof publish) {
        publish = message
        return unsubscribe
      },
    } as unknown as RealtimePreviewSession
    openRealtimeStream(session, response as unknown as ServerResponse)
    const envelope = {
      protocol: 1,
      channel: 'office:runtime',
      streamId: 'bounded-stream',
      kind: 'delta',
      baseRevision: 1,
      revision: 2,
      changes: { records: {}, values: {} },
    } as const
    for (let index = 0; index < 140; index++) publish(envelope)
    expect(response.write).toHaveBeenCalledOnce()
    expect(response.end).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    response.emit('drain')
    expect(response.write).toHaveBeenCalledOnce()
  })
})
