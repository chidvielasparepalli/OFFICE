import { describe, expect, it, vi } from 'vitest'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import { ToolPreviewClient } from './toolPreviewClient'
import type {
  ToolPreviewMessage,
  ToolPreviewSnapshot,
} from './toolPreviewProtocol'

function snapshot(sessionId = 'session-a', revision = 1): ToolPreviewSnapshot {
  return {
    sessionId,
    state: {
      ...createOfficeRuntime().getSnapshot(),
      connection: 'local',
      revision,
    },
    scenario: null,
    taskId: null,
    requestId: null,
    executionId: null,
  }
}
function response(...messages: ToolPreviewMessage[]) {
  const text =
    messages.map((message) => JSON.stringify(message)).join('\n') + '\n'
  return new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(text)
        controller.enqueue(bytes.slice(0, 13))
        controller.enqueue(bytes.slice(13))
        controller.close()
      },
    }),
    { status: 200 },
  )
}
const done = { type: 'result', ok: true, message: 'Accepted.' } as const

describe('host snapshot client', () => {
  it('does not send scene selection or actions before a host session exists', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = new ToolPreviewClient(fetcher)
    expect(
      await client.dispatch({ type: 'selectAgent', agentId: null }),
    ).toMatchObject({ ok: false })
    expect(
      await client.dispatch({ type: 'selectTask', taskId: null }),
    ).toMatchObject({ ok: false })
    await expect(client.action({ action: 'complete' })).rejects.toThrow(
      'SESSION_REQUIRED',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('calls native browser transport with its required global receiver', async () => {
    const nativeLikeFetch: typeof fetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(
        response({ type: 'snapshot', snapshot: snapshot() }, done),
      )
    }
    const client = new ToolPreviewClient(nativeLikeFetch)
    await expect(client.connect()).resolves.toBe('Accepted.')
    expect(client.getSnapshot().connection).toBe('local')
  })
  it('hides the live scene on network loss while retaining host history, then resynchronizes the same revision', async () => {
    const initial = snapshot('session-a', 7)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: initial }, done),
      )
      .mockRejectedValueOnce(new TypeError('Network connection lost'))
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: initial }, done),
      )
    const client = new ToolPreviewClient(fetcher)
    await client.connect()
    const actual = client.getPreview()!.state
    await expect(client.action({ action: 'complete' })).rejects.toThrow(
      'Transport disconnected',
    )
    expect(client.getSnapshot()).toMatchObject({
      connection: 'disconnected',
      revision: 7,
    })
    expect(client.getSnapshot().tasks).toBe(actual.tasks)
    expect(client.getSnapshot().events).toBe(actual.events)
    expect(client.getPreview()!.state).toBe(actual)
    expect(actual.connection).toBe('local')
    expect(
      await client.dispatch({ type: 'selectAgent', agentId: null }),
    ).toMatchObject({ ok: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await client.action({ action: 'reconnect' })
    expect(client.getSnapshot()).toBe(actual)
    expect(client.getSnapshot().connection).toBe('local')
  })

  it('does not disconnect for a structured command rejection, but does for a dropped stream', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: snapshot() }, done),
      )
      .mockResolvedValueOnce(
        response({
          type: 'error',
          code: 'ACTIVE_TASK',
          message: 'Complete the current task.',
        }),
      )
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: snapshot('session-a', 2) }),
      )
    const client = new ToolPreviewClient(fetcher)
    await client.connect()
    await expect(
      client.action({ action: 'prepare', scenario: 'research' }),
    ).rejects.toThrow('ACTIVE_TASK')
    expect(client.getSnapshot().connection).toBe('local')
    await expect(client.action({ action: 'cancel' })).rejects.toThrow(
      'without a confirmed result',
    )
    expect(client.getSnapshot()).toMatchObject({
      connection: 'disconnected',
      revision: 2,
    })
    expect(client.getPreview()!.state.connection).toBe('local')
  })
  it('streams stable snapshots and sends only discrete feedback, without a client reducer', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: snapshot() }, done),
      )
      .mockResolvedValueOnce(
        response(
          { type: 'snapshot', snapshot: snapshot('session-a', 2) },
          done,
        ),
      )
    const client = new ToolPreviewClient(fetcher)
    expect(client.getSnapshot().connection).toBe('disconnected')
    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    await client.connect()
    expect(client.getSnapshot().connection).toBe('local')
    const state = client.getSnapshot()
    expect(client.getSnapshot()).toBe(state)
    expect(
      (await client.dispatch({ type: 'completeTask', taskId: 'forged' })).ok,
    ).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(
      (await client.dispatch({ type: 'selectAgent', agentId: null })).ok,
    ).toBe(true)
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      'X-Tools-Session': 'session-a',
    })
    expect(client.getSnapshot().revision).toBe(2)
    unsubscribe()
    expect(client.getMetrics().subscribers).toBe(0)
  })

  it('ignores stale revisions and foreign sessions while accepting final metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          { type: 'snapshot', snapshot: snapshot('session-a', 7) },
          done,
        ),
      )
      .mockResolvedValueOnce(
        response(
          { type: 'snapshot', snapshot: snapshot('session-a', 6) },
          { type: 'snapshot', snapshot: snapshot('foreign', 99) },
          {
            type: 'snapshot',
            snapshot: {
              ...snapshot('session-a', 7),
              executionId: 'execution-1',
            },
          },
          done,
        ),
      )
    const client = new ToolPreviewClient(fetcher)
    await client.connect()
    const state = client.getSnapshot()
    await client.action({ action: 'cancel' })
    expect(client.getSnapshot()).toBe(state)
    expect(client.getPreview()?.executionId).toBe('execution-1')
    expect(client.getPreview()?.sessionId).toBe('session-a')
  })

  it('aborts old sessions and does not accept a delayed old connect result', async () => {
    let release!: (response: Response) => void
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce(
        response(
          { type: 'snapshot', snapshot: snapshot('new-session', 2) },
          done,
        ),
      )
    const client = new ToolPreviewClient(fetcher)
    const old = client.connect().catch((error: unknown) => error)
    await client.connect()
    release(
      response(
        { type: 'snapshot', snapshot: snapshot('old-session', 100) },
        done,
      ),
    )
    expect(await old).toBeInstanceOf(Error)
    expect(client.getPreview()?.sessionId).toBe('new-session')
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true)
  })

  it('keeps streamed failure state and reports a missing final acknowledgment', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: snapshot() }, done),
      )
      .mockResolvedValueOnce(
        response({
          type: 'error',
          code: 'INVALID_ARRIVAL',
          message: 'Wrong workstation.',
        }),
      )
      .mockResolvedValueOnce(
        response({ type: 'snapshot', snapshot: snapshot('session-a', 2) }),
      )
    const client = new ToolPreviewClient(fetcher)
    await client.connect()
    expect(
      await client.dispatch({ type: 'selectAgent', agentId: null }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('INVALID_ARRIVAL') },
    })
    await expect(client.action({ action: 'cancel' })).rejects.toThrow(
      'without a confirmed result',
    )
    expect(client.getSnapshot().revision).toBe(2)
  })
})
