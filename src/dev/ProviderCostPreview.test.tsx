import { StrictMode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import ProviderCostPreview from './ProviderCostPreview'
import type { ToolPreviewSnapshot } from './toolPreviewProtocol'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: () => <div>Existing office runtime</div>,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function response(snapshot: ToolPreviewSnapshot, message: string) {
  return new Response(
    `${JSON.stringify({ type: 'snapshot', snapshot })}\n${JSON.stringify({ type: 'result', ok: true, message })}\n`,
  )
}
describe('provider preview boundary', () => {
  it('requires explicit connect under StrictMode and sends only the fixed mode and named scenario', async () => {
    const runtime = createOfficeRuntime()
    runtime.dispatch({ type: 'connect' })
    const snapshot: ToolPreviewSnapshot = {
      sessionId: 'provider-session',
      state: runtime.getSnapshot(),
      scenario: null,
      taskId: null,
      requestId: null,
      executionId: null,
      provider: {
        scenario: null,
        configuration: [],
        budget: {
          unit: 'credit-micros',
          globalLimitMicros: 1000,
          perAgentLimitMicros: 1000,
          perTaskLimitMicros: 1000,
          perRequestLimitMicros: 1000,
        },
      },
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(snapshot, 'Connected.'))
      .mockResolvedValueOnce(response(snapshot, 'Prepared.'))
    vi.stubGlobal('fetch', fetcher)
    render(
      <StrictMode>
        <ProviderCostPreview />
      </StrictMode>,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      screen.getByText(/perform no network calls and spend no money/),
    ).toBeDefined()
    expect(
      (screen.getByTestId('providers-execute') as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByTestId('providers-connect'))
    await waitFor(() =>
      expect(screen.getByTestId('providers-notice').textContent).toBe(
        'Connected.',
      ),
    )
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      mode: 'providers',
    })
    fireEvent.change(screen.getByTestId('providers-scenario'), {
      target: { value: 'unsafe-response' },
    })
    fireEvent.click(screen.getByTestId('providers-prepare'))
    await waitFor(() =>
      expect(screen.getByTestId('providers-notice').textContent).toBe(
        'Prepared.',
      ),
    )
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
      action: 'provider-prepare',
      scenario: 'unsafe-response',
    })
    expect(
      (screen.getByTestId('providers-artifact') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('providers-memory') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('providers-complete') as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
