import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MemoryPreview from './MemoryPreview'
import {
  createMemoryPreviewSession,
  MEMORY_PREVIEW as ids,
} from './memoryFixtures'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: () => (
    <div data-testid="office-preserved">Existing runtime office</div>
  ),
}))
afterEach(cleanup)
async function click(id: string) {
  fireEvent.click(screen.getByTestId(`memory-${id}`))
  await waitFor(() =>
    expect(
      (screen.getByTestId('memory-reset') as HTMLButtonElement).disabled,
    ).toBe(false),
  )
}
const result = () => screen.getByTestId('memory-result').textContent ?? ''
describe('isolated memory preview', () => {
  it('starts empty/disconnected and connects without fabricating tasks or memories', async () => {
    render(<MemoryPreview />)
    expect(screen.getByTestId('memory-summary').textContent).toContain(
      '0 memory records · 0 tasks',
    )
    await click('connect')
    expect(screen.getByTestId('memory-summary').textContent).toContain(
      '0 memory records · 0 tasks',
    )
    expect(screen.getByTestId('office-preserved')).toBeTruthy()
  })
  it('builds later-task context from explicit preference and completed-task writes', async () => {
    render(<MemoryPreview />)
    await click('connect')
    await click('preference')
    await click('earlier')
    await click('complete')
    expect(screen.getByTestId('memory-summary').textContent).toContain(
      '1 memory records',
    )
    await click('lesson')
    await click('later')
    await click('context')
    expect(result()).toContain(ids.preference)
    expect(result()).toContain(ids.lesson)
    expect(result()).toContain('approximateTokens')
    expect(result()).toContain(ids.laterTask)
  })
  it('clears displayed private content when another worker or Manager is denied', async () => {
    render(<MemoryPreview />)
    await click('connect')
    await click('private')
    await click('recall-private')
    expect(result()).toContain('Private development lesson')
    for (const actor of ['worker', 'manager']) {
      await click(`deny-${actor}`)
      expect(screen.getByTestId('memory-notice').textContent).toContain(
        'MEMORY_ACCESS_DENIED',
      )
      expect(result()).toBe('No context exposed.')
    }
    await click('disconnect')
    expect(JSON.parse(result())).toEqual({ connection: 'disconnected' })
  })
  it('shows explicit Manager decision replacement in subsequent planning context', async () => {
    render(<MemoryPreview />)
    await click('connect')
    await click('manager-task')
    await click('decision')
    await click('supersede')
    await click('manager-context')
    expect(result()).toContain('revised naming convention')
    expect(result()).not.toContain('original naming convention')
    expect(screen.getByTestId('memory-audit').textContent).toContain(
      'MEMORY_SUPERSEDED',
    )
  })
  it('uses the existing tool executor but stores evidence only on explicit memory write', async () => {
    render(<MemoryPreview />)
    await click('connect')
    await click('earlier')
    await click('research')
    expect(result()).toContain('No web search')
    expect(screen.getByTestId('memory-summary').textContent).toContain(
      '0 memory records',
    )
    await click('finding')
    expect(result()).toContain('unverified')
    await click('deny-verify')
    expect(screen.getByTestId('memory-notice').textContent).toContain(
      'MEMORY_ACCESS_DENIED',
    )
    await click('reset')
    expect(screen.getByTestId('memory-summary').textContent).toContain(
      '0 memory records · 0 tasks',
    )
  })
  it('does not change worker or Manager business state when memory is written or retrieved', () => {
    const session = createMemoryPreviewSession()
    session.connect()
    session.begin(ids.managerTask, ids.manager)
    const before = session.runtime.getSnapshot()
    session.write(ids.manager, { content: 'Explicit architecture decision.' })
    session.services[ids.manager].forTask({ taskId: ids.managerTask })
    expect(session.runtime.getSnapshot().agents).toBe(before.agents)
    expect(session.runtime.getSnapshot().tasks).toBe(before.tasks)
    expect(session.runtime.getSnapshot().agents[ids.manager].kind).toBe(
      'manager',
    )
  })
})
