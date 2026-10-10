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
import ToolExecutionPreview from './ToolExecutionPreview'
import type { ToolPreviewSnapshot } from './toolPreviewProtocol'
import type { RuntimeCommand } from '../runtime/runtimeTypes'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: ({ executionNotice }: { executionNotice: string }) => (
    <div>{executionNotice}</div>
  ),
}))
afterEach(cleanup)
function hostResponse(snapshot: ToolPreviewSnapshot, message: string) {
  return new Response(
    `${JSON.stringify({ type: 'snapshot', snapshot })}\n${JSON.stringify({ type: 'result', ok: true, message })}\n`,
    { status: 200 },
  )
}
describe('tools development controls', () => {
  it('keeps execution disabled while the assigned worker walks and enables it after host arrival', async () => {
    const runtime = createOfficeRuntime()
    const issue = (command: RuntimeCommand) => {
      const result = runtime.dispatch(command)
      if (!result.ok) throw new Error(result.error.message)
    }
    issue({ type: 'connect' })
    issue({
      type: 'registerDepartment',
      department: { id: 'engineering', name: 'Engineering' },
    })
    issue({
      type: 'registerWorkstation',
      workstation: { id: 'desk', position: [-11, 0, 0.72], headingRadians: 0 },
    })
    issue({
      type: 'registerAgent',
      agent: {
        id: 'worker',
        name: 'Fixture worker',
        role: 'Fixture coder',
        kind: 'standard-worker',
        departmentId: 'engineering',
        workstationId: 'desk',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
    const connected: ToolPreviewSnapshot = {
      sessionId: 'host-session',
      state: runtime.getSnapshot(),
      scenario: null,
      taskId: null,
      requestId: null,
      executionId: null,
    }
    issue({ type: 'createTask', task: { id: 'task', title: 'Fixture task' } })
    issue({ type: 'assignTask', taskId: 'task', agentId: 'worker' })
    issue({ type: 'startTask', taskId: 'task' })
    issue({
      type: 'requestMovement',
      agentId: 'worker',
      destinationType: 'workstation',
      destinationId: 'desk',
      movementReason: 'Travel to the assigned desk',
      arrivalStatus: 'working',
    })
    const walking: ToolPreviewSnapshot = {
      ...connected,
      state: runtime.getSnapshot(),
      scenario: 'coding',
      taskId: 'task',
    }
    issue({
      type: 'arrive',
      agentId: 'worker',
      intentId: runtime.getSnapshot().agents.worker.destination!.id,
      position: [-10.35, 0, -0.63],
      headingRadians: 0,
    })
    const working: ToolPreviewSnapshot = {
      ...walking,
      state: runtime.getSnapshot(),
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hostResponse(connected, 'Connected.'))
      .mockResolvedValueOnce(hostResponse(walking, 'Worker travelling.'))
      .mockResolvedValueOnce(hostResponse(working, 'Host arrival confirmed.'))
    vi.stubGlobal('fetch', fetcher)
    render(<ToolExecutionPreview />)
    fireEvent.click(screen.getByTestId('tools-connect'))
    await waitFor(() =>
      expect(screen.getByTestId('tools-notice').textContent).toBe('Connected.'),
    )
    fireEvent.click(screen.getByTestId('tools-prepare'))
    await waitFor(() =>
      expect(screen.getByTestId('tools-notice').textContent).toBe(
        'Worker travelling.',
      ),
    )
    const execute = screen.getByTestId(
      'tools-execute-read',
    ) as HTMLButtonElement
    expect(execute.disabled).toBe(true)
    fireEvent.click(execute)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      screen.getByText(/Tool execution requires the assigned worker/),
    ).toBeDefined()
    fireEvent.click(screen.getByTestId('tools-focus-worker'))
    await waitFor(() => expect(execute.disabled).toBe(false))
  })
  it('requires explicit connection even under StrictMode and labels fixture research truthfully', async () => {
    const runtime = createOfficeRuntime()
    runtime.dispatch({ type: 'connect' })
    const snapshot: ToolPreviewSnapshot = {
      sessionId: 'host-session',
      state: runtime.getSnapshot(),
      scenario: null,
      taskId: null,
      requestId: null,
      executionId: null,
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hostResponse(snapshot, 'Connected to host.'))
    vi.stubGlobal('fetch', fetcher)
    render(
      <StrictMode>
        <ToolExecutionPreview />
      </StrictMode>,
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Research is an explicit fixture with no web search/),
    ).toBeDefined()
    fireEvent.click(screen.getByTestId('tools-connect'))
    await waitFor(() =>
      expect(screen.getByTestId('tools-notice').textContent).toBe(
        'Connected to host.',
      ),
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/__tools-preview/connect')
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({})
  })

  it.each([
    { scenario: 'coding' as const, operations: ['read', 'terminal'] },
    { scenario: 'timeout' as const, operations: ['timeout', 'cancellable'] },
  ])(
    'sends named $scenario actions without browser-owned authority',
    async ({ scenario, operations }) => {
      const runtime = createOfficeRuntime()
      runtime.dispatch({ type: 'connect' })
      const snapshot: ToolPreviewSnapshot = {
        sessionId: 'host-session',
        state: runtime.getSnapshot(),
        scenario: null,
        taskId: null,
        requestId: null,
        executionId: null,
      }
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(hostResponse(snapshot, 'Connected.'))
        .mockResolvedValueOnce(
          hostResponse({ ...snapshot, scenario }, 'Prepared by host.'),
        )
      vi.stubGlobal('fetch', fetcher)
      render(<ToolExecutionPreview />)
      fireEvent.click(screen.getByTestId('tools-connect'))
      await waitFor(() =>
        expect(screen.getByTestId('tools-notice').textContent).toBe(
          'Connected.',
        ),
      )
      fireEvent.change(screen.getByTestId('tools-scenario'), {
        target: { value: scenario },
      })
      fireEvent.click(screen.getByTestId('tools-prepare'))
      await waitFor(() =>
        expect(screen.getByTestId('tools-notice').textContent).toBe(
          'Prepared by host.',
        ),
      )
      expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
        action: 'prepare',
        scenario,
      })
      for (const operation of operations)
        expect(screen.getByTestId(`tools-execute-${operation}`)).toBeDefined()
    },
  )
})
