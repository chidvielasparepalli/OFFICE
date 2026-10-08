import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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
    const { container } = render(<App />)

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
    expect(container.querySelector('canvas')).toBeNull()
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

  it('provides access to the canonical repository and the preserved source inventory', () => {
    render(<App />)

    const repository = screen.getByRole('link', { name: 'View repository' })
    expect(repository.getAttribute('href')).toBe(
      'https://github.com/chidvielasparepalli/OFFICE',
    )
    expect(repository.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('View prototype source')).toBeDefined()
    expect(screen.getByText('AgentCharacter.tsx')).toBeDefined()
    expect(screen.getByText('CameraController.tsx')).toBeDefined()
  })
})
