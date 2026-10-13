import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecruitmentClient, RecruitmentTransport } from './recruitmentClient'
import { emptyRealtimeView, realtimeSnapshot } from '../realtime/realtimeCodec'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))
function server() {
  const hello = { type: 'realtime-ready', streamId: 'recruitment-stream' }
  const streams: ReadableStreamDefaultController<Uint8Array>[] = []
  const requests: {
    endpoint: string
    body: unknown
    init: RequestInit | undefined
  }[] = []
  const json = (value: unknown) => {
    const body = `${JSON.stringify(value)}\n`
    return new Response(body, {
      headers: {
        'Content-Length': String(new TextEncoder().encode(body).length),
      },
    })
  }
  const view = emptyRealtimeView()
  const snapshot = realtimeSnapshot(hello.streamId, {
    ...view,
    state: { ...view.state, revision: 8 },
  })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const endpoint = String(url).split('/').at(-1)!
    requests.push({ endpoint, body: JSON.parse(String(init?.body)), init })
    if (endpoint === 'status')
      return json({
        authenticated: true,
        configured: true,
        ceoId: 'ceo',
        modelId: 'gpt-6-astra',
        openaiAvailable: false,
      })
    if (endpoint === 'connect') return json(hello)
    if (endpoint === 'snapshot') return json(snapshot)
    if (endpoint !== 'stream') return json({ ok: true })
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
  return { requests, fetcher, streams, snapshot }
}

describe('CEO recruitment client boundary', () => {
  it('uses same-origin HttpOnly cookie authentication without storing or supplying actor authority', async () => {
    const host = server(),
      client = new RecruitmentClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.login('synthetic-test-password')
    expect(host.requests.map((item) => item.endpoint)).toEqual([
      'login',
      'status',
    ])
    expect(host.requests[0].body).toEqual({
      password: 'synthetic-test-password',
    })
    for (const request of host.requests) {
      expect(request.init?.credentials).toBe('same-origin')
      expect(request.init?.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Office-Recruitment': '1',
      })
      expect(JSON.stringify(request.body)).not.toContain('actorId')
    }
    expect(JSON.stringify(client.getSnapshot())).not.toContain(
      'synthetic-test-password',
    )
  })
  it('subscribes before snapshot and reuses the Phase 12 ordered cache', async () => {
    const host = server(),
      client = new RecruitmentClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.connect()
    expect(host.requests.map((item) => item.endpoint)).toEqual([
      'connect',
      'stream',
      'snapshot',
    ])
    expect(client.getSnapshot().revision).toBe(8)
    const before = client.getSnapshot()
    host.streams[0].enqueue(
      new TextEncoder().encode(`${JSON.stringify(host.snapshot)}\n`),
    )
    await vi.waitFor(() =>
      expect(client.getMetrics().duplicates).toBeGreaterThan(0),
    )
    expect(client.getSnapshot()).toBe(before)
  })
  it('never treats an action acknowledgement as employee activation or capability success', async () => {
    const host = server(),
      client = new RecruitmentClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.connect()
    const before = client.getSnapshot()
    await client.action({
      action: 'start',
      recruitmentId: 'approved-test-session',
    })
    expect(client.getSnapshot()).toBe(before)
    expect(client.getSnapshot().employees).toEqual({})
    const requests = host.requests.length
    expect(
      (await client.dispatch({ type: 'completeTask', taskId: 'forged' })).ok,
    ).toBe(false)
    expect(host.requests.length).toBe(requests)
  })
  it('reconnects through a fresh authoritative snapshot without creating client-owned state', async () => {
    const host = server(),
      client = new RecruitmentClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.connect()
    client.disconnect()
    expect(client.getSnapshot().revision).toBe(8)
    await client.connect()
    expect(client.getConnection().status).toBe('connected')
    expect(
      host.requests.filter((item) => item.endpoint === 'snapshot'),
    ).toHaveLength(2)
    expect(client.getSnapshot().revision).toBe(8)
  })
  it('clears the cached private view at logout and notifies existing UI subscriptions', async () => {
    const host = server(),
      client = new RecruitmentClient(host.fetcher)
    cleanups.push(() => client.dispose())
    await client.connect()
    const changed = vi.fn(),
      unsubscribe = client.subscribe(changed)
    await client.logout()
    expect(client.getSnapshot().revision).toBe(0)
    expect(client.getConnection().status).toBe('disconnected')
    expect(changed).toHaveBeenCalled()
    unsubscribe()
  })
  it('does not reflect raw host errors or credential-like response bodies in public errors', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response('synthetic-sensitive-host-detail', { status: 403 }),
    )
    const client = new RecruitmentClient(fetcher)
    cleanups.push(() => client.dispose())
    await expect(
      client.action({ action: 'start', recruitmentId: 'test' }),
    ).rejects.toThrow('denied or')
    try {
      await client.status()
    } catch (error) {
      expect(String(error)).not.toContain('synthetic-sensitive-host-detail')
    }
  })
  it('bounds stalled setup and disposes pending subscriptions', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('Synthetic interruption.')),
            { once: true },
          ),
        ),
    )
    const transport = new RecruitmentTransport(fetcher, 10)
    cleanups.push(() => transport.close())
    await expect(
      transport.connect({ message: () => {}, closed: () => {} }),
    ).rejects.toThrow()
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('consumes exactly framed UTF-8 JSON without cancelling a successful fetch', async () => {
    const body = JSON.stringify({ ok: true, label: 'Synthetíc fixture' })
    const response = new Response(body, {
      headers: {
        'Content-Length': String(new TextEncoder().encode(body).length),
      },
    })
    const cancel = vi.spyOn(response.body!, 'cancel')
    const transport = new RecruitmentTransport(async () => response)
    cleanups.push(() => transport.close())

    await expect(transport.request('action', {})).resolves.toEqual({
      ok: true,
      label: 'Synthetíc fixture',
    })

    expect(cancel).not.toHaveBeenCalled()
  })
  it.each([undefined, '-1', '1.5', 'Infinity', '4000001', '01'])(
    'rejects unsafe declared length %s before reading and cancels the body',
    async (length) => {
      const response = new Response('Synthetic untrusted body', {
        headers: length === undefined ? {} : { 'Content-Length': length },
      })
      const consume = vi.spyOn(response, 'text')
      const cancel = vi.spyOn(response.body!, 'cancel')
      const transport = new RecruitmentTransport(async () => response)
      cleanups.push(() => transport.close())

      await expect(transport.request('action', {})).rejects.toThrow('framing')

      expect(consume).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
    },
  )
  it.each(['Content-Encoding', 'Transfer-Encoding'])(
    'rejects %s before consuming a potentially unbounded body',
    async (header) => {
      const response = new Response('{}', {
        headers: { 'Content-Length': '2', [header]: 'synthetic-encoding' },
      })
      const consume = vi.spyOn(response, 'text')
      const cancel = vi.spyOn(response.body!, 'cancel')
      const transport = new RecruitmentTransport(async () => response)
      cleanups.push(() => transport.close())

      await expect(transport.request('action', {})).rejects.toThrow('framing')

      expect(consume).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
    },
  )
  it('rejects a response that does not match its declared UTF-8 byte size', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'Content-Length': '2' },
    })
    const transport = new RecruitmentTransport(async () => response)
    cleanups.push(() => transport.close())

    await expect(transport.request('action', {})).rejects.toThrow(
      'declared size',
    )
  })
  it('still interrupts a stalled finite body at its bounded deadline', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(
                  new Error('Synthetic finite-body interruption.'),
                ),
              )
            },
          }),
          { headers: { 'Content-Length': '2' } },
        ),
    )
    const transport = new RecruitmentTransport(fetcher, 10)
    cleanups.push(() => transport.close())

    await expect(transport.request('action', {})).rejects.toThrow(
      'interruption',
    )

    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('closes malformed/oversized streams without exposing input to consumers', async () => {
    const host = server(),
      transport = new RecruitmentTransport(host.fetcher)
    cleanups.push(() => transport.close())
    const closed = vi.fn(),
      message = vi.fn()
    await transport.connect({ message, closed })
    host.streams[0].enqueue(new TextEncoder().encode('x'.repeat(4_000_001)))
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(message).not.toHaveBeenCalled()
  })
})
