import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RealtimePreviewClient,
  RealtimePreviewTransport,
} from './realtimePreviewClient'
import { emptyRealtimeView, realtimeSnapshot } from '../realtime/realtimeCodec'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
const hello = {
  type: 'realtime-ready',
  sessionId: 'test-session',
  streamId: 'test-stream',
}
const json = (value: unknown) => new Response(`${JSON.stringify(value)}\n`)

function server() {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  const requests: {
    endpoint: string
    body: unknown
    headers: HeadersInit | undefined
  }[] = []
  let snapshot = realtimeSnapshot('test-stream', emptyRealtimeView())
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const endpoint = String(url).split('/').at(-1)!
    requests.push({
      endpoint,
      body: JSON.parse(init!.body as string),
      headers: init?.headers,
    })
    if (endpoint === 'connect') return json(hello)
    if (endpoint === 'snapshot') return json(snapshot)
    if (endpoint === 'action')
      return json({
        type: 'result',
        ok: true,
        message: 'Host accepted named action.',
      })
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller)
          controller.enqueue(
            new TextEncoder().encode(`${JSON.stringify(hello)}\n`),
          )
          init?.signal?.addEventListener(
            'abort',
            () => {
              try {
                controller.close()
              } catch {
                /* Already closed. */
              }
            },
            { once: true },
          )
        },
      }),
    )
  })
  return {
    fetcher,
    requests,
    streams,
    setSnapshot: (value: typeof snapshot) => {
      snapshot = value
    },
  }
}
describe('guarded realtime HTTP adapter', () => {
  it('bounds setup and snapshot waits and aborts unfinished setup on disconnect', async () => {
    const stalled = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('Synthetic interrupted connection.')),
            { once: true },
          )
        }),
    )
    const transport = new RealtimePreviewTransport(stalled, 15)
    cleanups.push(() => transport.reset())
    await expect(
      transport.connect({ message: () => {}, closed: () => {} }),
    ).rejects.toThrow()
    expect(stalled.mock.calls[0][1]?.signal?.aborted).toBe(true)
    const host = server()
    const fetcher: typeof fetch = (url, init) =>
      String(url).endsWith('/snapshot')
        ? stalled(url, init)
        : host.fetcher(url, init)
    const snapshotTransport = new RealtimePreviewTransport(fetcher, 15)
    cleanups.push(() => snapshotTransport.reset())
    const connection = await snapshotTransport.connect({
      message: () => {},
      closed: () => {},
    })
    await expect(connection.requestSnapshot()).rejects.toThrow()
    const client = new RealtimePreviewClient(stalled)
    cleanups.push(() => client.dispose())
    const beforeSetup = stalled.mock.calls.length
    const pending = client.connect()
    await vi.waitFor(() =>
      expect(stalled.mock.calls.length).toBe(beforeSetup + 1),
    )
    client.disconnect()
    await pending
    expect(client.getConnection().status).toBe('disconnected')
    expect(stalled.mock.calls.at(-1)![1]?.signal?.aborted).toBe(true)
  })
  it('installs a live stream before requesting a snapshot and receives updates without an action response', async () => {
    const host = server()
    const transport = new RealtimePreviewTransport(host.fetcher)
    cleanups.push(() => transport.reset())
    const received: unknown[] = []
    const connection = await transport.connect({
      message: (value) => received.push(value),
      closed: () => {},
    })
    expect(host.requests.map((request) => request.endpoint)).toEqual([
      'connect',
      'stream',
    ])
    const snapshot = await connection.requestSnapshot()
    expect(host.requests.map((request) => request.endpoint)).toEqual([
      'connect',
      'stream',
      'snapshot',
    ])
    expect(host.requests[0].body).toEqual({ mode: 'realtime' })
    expect(host.requests[1].body).toEqual({})
    expect(host.requests[1].headers).toMatchObject({
      'X-Tools-Session': 'test-session',
      'X-Tools-Preview': '1',
    })
    host.streams[0].enqueue(
      new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`),
    )
    await vi.waitFor(() => expect(received).toEqual([snapshot]))
    connection.close()
  })
  it('uses the shared projection cache and reconnects to the retained host rather than creating a new runtime', async () => {
    const host = server()
    const client = new RealtimePreviewClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.connect()
    expect(client.getConnection().status).toBe('connected')
    const state = client.getSnapshot()
    client.disconnect()
    expect(client.getSnapshot()).toBe(state)
    await client.reconnect()
    expect(
      host.requests.filter((request) => request.endpoint === 'connect'),
    ).toHaveLength(1)
    expect(
      host.requests.filter((request) => request.endpoint === 'snapshot'),
    ).toHaveLength(2)
    expect(client.getConnection().status).toBe('connected')
    const count = host.requests.length
    expect(
      (
        await client.dispatch({
          type: 'completeTask',
          taskId: 'not-browser-authority',
        })
      ).ok,
    ).toBe(false)
    expect(host.requests).toHaveLength(count)
  })
  it('rejects partial/oversized streaming messages and does not leak raw invalid content into errors', async () => {
    const host = server()
    const transport = new RealtimePreviewTransport(host.fetcher)
    cleanups.push(() => transport.reset())
    const closed = vi.fn()
    await transport.connect({ message: () => {}, closed })
    host.streams[0].enqueue(new TextEncoder().encode('x'.repeat(4_000_001)))
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })
})
