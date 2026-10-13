import { StrictMode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyRealtimeView, realtimeSnapshot } from '../realtime/realtimeCodec'
import RealtimePreview from './RealtimePreview'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: () => <div>Existing 3D office</div>,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('realtime development UI', () => {
  it('connects only explicitly under StrictMode and shows truthful disconnected/host-source messaging', async () => {
    const hello = {
      type: 'realtime-ready',
      sessionId: 'ui-session',
      streamId: 'ui-stream',
    }
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/connect'))
        return new Response(`${JSON.stringify(hello)}\n`)
      if (String(url).endsWith('/snapshot'))
        return new Response(
          `${JSON.stringify(realtimeSnapshot('ui-stream', emptyRealtimeView()))}\n`,
        )
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
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
    vi.stubGlobal('fetch', fetcher)
    render(
      <StrictMode>
        <RealtimePreview />
      </StrictMode>,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByText(/Selecting a worker does not change/)).toBeDefined()
    fireEvent.click(screen.getByTestId('realtime-connect'))
    await waitFor(() =>
      expect(screen.getByTestId('realtime-connection').textContent).toContain(
        'connected',
      ),
    )
    expect(
      fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1)),
    ).toEqual(['connect', 'stream', 'snapshot'])
    expect(screen.getByTestId('realtime-artifacts').children).toHaveLength(0)
    fireEvent(window, new Event('online'))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith('/snapshot')),
      ).toHaveLength(2),
    )
    fireEvent.click(screen.getByTestId('realtime-disconnect'))
    await waitFor(() =>
      expect(screen.getByTestId('realtime-connection').textContent).toContain(
        'disconnected',
      ),
    )
    expect(screen.getByTestId('realtime-notice').textContent).toContain(
      'Last known state is retained',
    )
    fireEvent(window, new Event('online'))
    await Promise.resolve()
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/snapshot')),
    ).toHaveLength(2)
  })
})
