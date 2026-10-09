import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// WebGL and camera interaction are verified in Chromium, outside jsdom.
vi.mock('./components/3d/OfficeWorld', () => ({
  OfficeWorld: () => <section aria-label="Interactive 3D office" />,
}))

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OFFICE foundation', () => {
  it('identifies the project and reports the disconnected runtime without business metrics', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'AI Corporate Office OS',
    )
    expect(screen.getByRole('status').textContent).toContain(
      'Agent runtime not connected',
    )
    expect(screen.getByRole('status').textContent).toContain(
      'No agents are running here.',
    )
    expect(
      screen.queryByText(
        /active agents|completed tasks|token burn|api credits/i,
      ),
    ).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Interactive 3D office' }),
    ).toBeDefined()
    expect(
      screen.queryByRole('button', { name: /dispatch|approve|run task/i }),
    ).toBeNull()
  })

  it('ignores corrupt prototype storage and starts no simulation or provider requests', () => {
    localStorage.setItem('aether_office_agents', 'invalid prototype JSON')
    const readStorage = vi.spyOn(Storage.prototype, 'getItem')
    const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
    const fetchProvider = vi.fn()
    vi.stubGlobal('fetch', fetchProvider)
    vi.useFakeTimers()

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    act(() => vi.advanceTimersByTime(30_000))

    expect(readStorage).not.toHaveBeenCalled()
    expect(writeStorage).not.toHaveBeenCalled()
    expect(fetchProvider).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(screen.getByRole('status').textContent).toContain(
      'Agent runtime not connected',
    )
  })

  it('provides access to the canonical repository', () => {
    render(<App />)

    const repository = screen.getByRole('link', { name: 'View repository' })
    expect(repository.getAttribute('href')).toBe(
      'https://github.com/chidvielasparepalli/OFFICE',
    )
    expect(repository.getAttribute('rel')).toContain('noopener')
  })
})
