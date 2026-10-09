import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficeContextPanel } from './OfficeContextPanel'
import type {
  AgentContext,
  AgentSpatialSnapshot,
  OfficeAgentStatus,
  OfficeRuntimeSnapshot,
} from '../office/officeState'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
// Isolated contract fixture; never imported by the application.
const agent: AgentContext = {
  id: 'a1',
  kind: 'standard-worker',
  name: 'Test worker',
  role: 'Engineer',
  departmentId: 'engineering',
  status: 'blocked',
  position: [-11, 0, 0],
  headingRadians: 0,
  manager: 'Manager record',
  task: {
    id: 't1',
    title: 'Verify artifact',
    description: 'Compare the supplied output',
    progressPercent: 37,
  },
  dependencies: ['t0'],
  collaborator: 'a2',
  nextAction: 'Wait for input',
  blockers: ['Missing input'],
  activity: [
    {
      id: 'e1',
      occurredAt: '2026-10-08T12:00:00Z',
      summary: 'Requested input',
    },
  ],
  artifacts: [
    { id: 'f1', title: 'Review document', url: 'https://example.com/artifact' },
    { id: 'f2', title: 'Unsafe link', url: 'javascript:alert(1)' },
  ],
  providerUsage: [
    {
      provider: 'Test provider',
      model: 'Test model',
      requests: 2,
      tokens: 123,
    },
  ],
  cost: null,
}
const snapshot: OfficeRuntimeSnapshot = {
  agents: { a1: agent },
  departments: {
    engineering: {
      id: 'engineering',
      name: 'Engineering',
      description: 'Supplied context',
      manager: 'Manager record',
      agentIds: ['a1'],
    },
  },
}
const select = vi.fn()
const inspect = vi.fn()
describe('office selection contract', () => {
  it('shows disconnected context without fabricated business metrics', () => {
    render(
      <OfficeContextPanel
        selection={{ kind: 'department', id: 'engineering' }}
        runtime={null}
        departmentName="Engineering"
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.getByText(/Runtime not connected/)).toBeDefined()
    expect(
      screen.queryByText(/\d+%|\$|completed tasks|active agents/i),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect workstation area' }),
    )
    expect(inspect).toHaveBeenCalledOnce()
  })
  it('selects supplied agents and clears their context when a record disappears', () => {
    const { rerender } = render(
      <OfficeContextPanel
        selection={{ kind: 'department', id: 'engineering' }}
        runtime={snapshot}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Test worker' }))
    expect(select).toHaveBeenCalledWith({ kind: 'agent', id: 'a1' })
    rerender(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={snapshot}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    for (const text of [
      'Test worker',
      'Verify artifact',
      'Compare the supplied output',
      '37%',
      'Missing input',
      'Wait for input',
    ])
      expect(screen.getByText(text)).toBeDefined()
    expect(
      screen
        .getByRole('link', { name: 'Review document' })
        .getAttribute('href'),
    ).toBe('https://example.com/artifact')
    expect(screen.queryByRole('link', { name: 'Unsafe link' })).toBeNull()
    expect(screen.getByText('Cost').nextElementSibling?.textContent).toBe(
      'Not reported',
    )
    rerender(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={{ agents: {}, departments: {} }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.queryByText('Verify artifact')).toBeNull()
    expect(screen.getByText(/Agent data unavailable/)).toBeDefined()
  })
  it('distinguishes a missing department record from a disconnected runtime', () => {
    render(
      <OfficeContextPanel
        selection={{ kind: 'department', id: 'missing' }}
        runtime={snapshot}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(
      screen.getByText(
        'Department data unavailable in the supplied runtime snapshot.',
      ),
    ).toBeDefined()
    expect(screen.queryByText(/Runtime not connected/)).toBeNull()
  })
  it('keeps Manager animation inspection separate from runtime context', () => {
    const { rerender } = render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'manager-sample' }}
        runtime={null}
        inspectionSample={{
          kind: 'manager',
          label: 'Manager asset sample',
          status: 'working',
        }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.getByText('1.80 m')).toBeDefined()
    expect(screen.getByText(/Dedicated supplied Manager model/)).toBeDefined()
    expect(
      screen.getByText('Visual scenario input').nextElementSibling?.textContent,
    ).toBe('working')
    expect(screen.queryByText(/T-pose/)).toBeNull()
    expect(screen.getByText('Runtime disconnected.')).toBeDefined()
    for (const field of [
      'Runtime status',
      'Role',
      'Department',
      'Current task',
      'Description',
      'Progress',
      'Manager',
      'Dependencies',
      'Collaborator',
      'Next action',
      'Blockers',
      'Cost',
    ])
      expect(screen.getByText(field).nextElementSibling?.textContent).toBe(
        'Unavailable — runtime disconnected',
      )
    expect(
      screen.getByText('Recent activity').nextElementSibling?.textContent,
    ).toBe('Unavailable — runtime disconnected')
    expect(screen.getByText('Artifacts').nextElementSibling?.textContent).toBe(
      'Unavailable — runtime disconnected',
    )
    expect(
      screen.getByText('API / provider usage').nextElementSibling?.textContent,
    ).toBe('Unavailable — runtime disconnected')
    rerender(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'manager-live' }}
        runtime={{
          ...snapshot,
          agents: {
            'manager-live': {
              ...agent,
              id: 'manager-live',
              kind: 'manager',
              name: 'Supplied Manager record',
              task: null,
            },
          },
        }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Supplied Manager record' }),
    ).toBeDefined()
    expect(screen.getByText('No task reported')).toBeDefined()
    expect(screen.queryByText('Test worker')).toBeNull()
  })

  it('shows supplied spatial snapshots and routes focus, workstation and refresh actions by selected ID', () => {
    const spatial: AgentSpatialSnapshot = {
      agentId: 'a1',
      position: [3, 0, 4],
      headingRadians: 1.25,
      workstation: { id: 'desk-a1', position: [-11, 0, 2], headingRadians: 0 },
      destination: { id: 'hub-1', position: [7, 0, 8] },
      movementState: 'moving',
      speedMetersPerSecond: 0.76,
      pathProgress: 0.4,
      collaborationTargetId: 'a2',
      phase: 'walking',
      diagnostic: null,
      motionId: 'route-1',
      completedMotionId: null,
    }
    const focus = vi.fn(),
      desk = vi.fn(),
      refresh = vi.fn()
    const { rerender } = render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={snapshot}
        spatial={spatial}
        onSelect={select}
        onInspect={inspect}
        onFocusAgent={focus}
        onInspectWorkstation={desk}
        onRefreshSpatial={refresh}
      />,
    )
    for (const [field, value] of [
      ['Agent ID', 'a1'],
      ['Current position', '(3.00, 0.00, 4.00) m'],
      ['Heading', '1.25 rad'],
      ['Workstation', 'desk-a1'],
      ['Workstation position', '(-11.00, 0.00, 2.00) m'],
      ['Destination', 'hub-1'],
      ['Destination position', '(7.00, 0.00, 8.00) m'],
      ['Movement', 'moving'],
      ['Speed', '0.76 m/s'],
      ['Path progress', '40%'],
      ['Progress', '37%'],
      ['Collaboration target', 'a2'],
    ])
      expect(screen.getByText(field).nextElementSibling?.textContent).toBe(
        value,
      )
    fireEvent.click(screen.getByRole('button', { name: 'Focus agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect workstation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh position' }))
    expect(focus).toHaveBeenCalledWith('a1')
    expect(desk).toHaveBeenCalledWith('a1')
    expect(refresh).toHaveBeenCalledWith('a1')
    rerender(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={snapshot}
        spatial={{ ...spatial, agentId: 'different-agent' }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(
      screen.getByText('Current position').nextElementSibling?.textContent,
    ).toBe('(-11.00, 0.00, 0.00) m')
    expect(screen.queryByText('hub-1')).toBeNull()
    expect(screen.getByText('Movement').nextElementSibling?.textContent).toBe(
      'Not reported',
    )
  })

  it('never lets an inspection sample replace supplied runtime context or another selected ID', () => {
    const sample = {
      id: 'a1',
      label: 'Visual sample',
      kind: 'manager' as const,
      status: 'working' as const,
    }
    const { rerender } = render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={snapshot}
        inspectionSample={sample}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Test worker' })).toBeDefined()
    expect(screen.queryByText('Visual sample')).toBeNull()
    expect(screen.queryByText('Runtime disconnected.')).toBeNull()
    rerender(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'other' }}
        runtime={null}
        inspectionSample={sample}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.queryByText('Visual sample')).toBeNull()
    expect(screen.getByText(/Agent data unavailable/)).toBeDefined()
  })

  it('renders typed dependency records alongside existing ID-only dependencies', () => {
    render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={{
          ...snapshot,
          agents: {
            a1: {
              ...agent,
              dependencies: [
                't0',
                { id: 't2', title: 'Review input' },
                { id: 't3' },
              ],
            },
          },
        }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(
      screen.getByText('Dependencies').nextElementSibling?.textContent,
    ).toBe('t0, Review input (t2), t3')
  })

  it('does not display invalid spatial measurements as real progress or enable an absent workstation', () => {
    const spatial: AgentSpatialSnapshot = {
      agentId: 'a1',
      position: [NaN, 0, 0],
      headingRadians: Infinity,
      workstation: null,
      destination: null,
      movementState: 'paused',
      speedMetersPerSecond: -1,
      pathProgress: 2,
      collaborationTargetId: null,
      phase: 'standing-up',
      diagnostic: 'No traversable route supplied',
      motionId: null,
      completedMotionId: null,
    }
    const desk = vi.fn()
    render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={snapshot}
        spatial={spatial}
        onSelect={select}
        onInspect={inspect}
        onInspectWorkstation={desk}
      />,
    )
    for (const field of [
      'Current position',
      'Heading',
      'Speed',
      'Path progress',
    ])
      expect(screen.getByText(field).nextElementSibling?.textContent).toBe(
        'Not reported',
      )
    expect(screen.getByText('No active destination')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(
      'No traversable route supplied',
    )
    const button = screen.getByRole('button', {
      name: 'Inspect workstation',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(desk).not.toHaveBeenCalled()
  })
  it.each<OfficeAgentStatus>([
    'sleeping',
    'queued',
    'working',
    'walking',
    'collaborating',
    'waiting',
    'completed',
    'blocked',
    'repair',
  ])('preserves supplied %s status', (status) => {
    render(
      <OfficeContextPanel
        selection={{ kind: 'agent', id: 'a1' }}
        runtime={{ ...snapshot, agents: { a1: { ...agent, status } } }}
        onSelect={select}
        onInspect={inspect}
      />,
    )
    expect(screen.getByText('Status').nextElementSibling?.textContent).toBe(
      status,
    )
  })
})
