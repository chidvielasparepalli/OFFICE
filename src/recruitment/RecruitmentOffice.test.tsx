import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeState } from '../runtime/runtimeTypes'
import { emptyRealtimeView } from '../realtime/realtimeCodec'
import type { RecruitmentSpec, RecruitmentSession } from './recruitmentTypes'
import RecruitmentOffice from './RecruitmentOffice'

const host = vi.hoisted(() => ({
  authenticated: true,
  configured: true,
  state: null as RuntimeState | null,
  connection: { status: 'connected', revision: 1, error: null },
  action: vi.fn(async () => {}),
  login: vi.fn(async (_password: string) => {}),
  listeners: new Set<() => void>(),
  props: null as unknown,
}))
vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: (props: unknown) => {
    host.props = props
    return <div>Existing office scene</div>
  },
}))
vi.mock('./recruitmentClient', () => ({
  RecruitmentClient: class {
    subscribe = (listener: () => void) => {
      host.listeners.add(listener)
      return () => {
        host.listeners.delete(listener)
      }
    }
    getSnapshot = () => host.state!
    getConnection = () => host.connection
    status = async () => ({
      authenticated: host.authenticated,
      configured: host.configured,
      ceoId: host.authenticated ? 'ceo' : null,
      openaiAvailable: false,
      modelId: 'gpt-6-astra',
    })
    connect = async () => {}
    resume = async () => {}
    disconnect = () => {}
    login = async (password: string) => {
      await host.login(password)
      host.authenticated = true
      return this.status()
    }
    logout = async () => {
      host.authenticated = false
    }
    action = host.action
    dispatch = async () => ({ ok: true, state: host.state })
    arrival = async () => ({ ok: true, state: host.state })
  },
}))
const spec: RecruitmentSpec = {
  name: 'Synthetic analyst',
  role: 'Analyst',
  departmentId: 'engineering',
  mission: 'Review a synthetic fixture',
  responsibilities: ['Review'],
  instructions: 'Use approved evidence only',
  personality: 'Professional',
  skills: [
    {
      id: 'criterion-1',
      description: 'Explain a finding',
      prompt: 'Name the synthetic fixture',
      expectedIncludes: ['fixture'],
      mandatory: true,
    },
  ],
  providerId: 'openai',
  modelId: 'gpt-6-astra',
  toolIds: ['provider.invoke'],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: 'recruitment-manager',
  budgetMicros: 50000,
  maxOutputUnits: 512,
  adapterMode: 'mock-success',
}
const session = (): RecruitmentSession => ({
  recruitmentId: 'recruitment-ui',
  candidateId: 'candidate-ui',
  requestedBy: 'ceo',
  state: 'pending_ceo_approval',
  proposals: [
    { version: 1, spec, createdAt: '2026-10-13T00:00:00Z', createdBy: 'ceo' },
    { version: 2, spec, createdAt: '2026-10-13T00:01:00Z', createdBy: 'ceo' },
  ],
  approvedVersion: null,
  approvals: [],
  assessments: [],
  failures: [],
  attempt: 1,
  maxAttempts: 3,
  scene: null,
  workstationId: null,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:01:00Z',
})
beforeEach(() => {
  host.authenticated = true
  host.configured = true
  host.listeners.clear()
  host.action.mockClear()
  host.login.mockClear()
  host.state = {
    ...emptyRealtimeView().state,
    connection: 'local',
    recruitments: { 'recruitment-ui': session() },
    departments: {
      engineering: {
        id: 'engineering',
        name: 'Engineering',
        description: null,
      },
    },
  }
})
afterEach(cleanup)
const ready = async () => {
  render(<RecruitmentOffice />)
  await screen.findByText('Existing office scene')
}

describe('CEO recruitment interface', () => {
  it('shows setup limits instead of offering a fake CEO approval when the host is unconfigured', async () => {
    host.authenticated = false
    host.configured = false
    render(<RecruitmentOffice />)
    await screen.findByText(/Host setup is incomplete/)
    expect(screen.queryByRole('button', { name: 'Sign in as CEO' })).toBeNull()
    expect(screen.queryByText('Existing office scene')).toBeNull()
    expect(host.action).not.toHaveBeenCalled()
  })
  it('clears the password input immediately and waits for authenticated host status', async () => {
    host.authenticated = false
    render(<RecruitmentOffice />)
    const input = await screen.findByLabelText('CEO password')
    fireEvent.change(input, { target: { value: 'synthetic-test-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in as CEO' }))
    expect((input as HTMLInputElement).value).toBe('')
    await screen.findByText('Existing office scene')
    expect(host.login).toHaveBeenCalledWith('synthetic-test-password')
    expect(document.body.textContent).not.toContain('synthetic-test-password')
  })
  it('approves the exact reviewed version without locally hiring or assigning authority', async () => {
    await ready()
    expect(
      screen.getByText('No recruited employees have been activated.'),
    ).toBeDefined()
    fireEvent.change(
      screen.getByLabelText('CEO decision / termination reason'),
      { target: { value: 'Reviewed the bounded proposal.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve hire v2' }))
    await waitFor(() =>
      expect(host.action).toHaveBeenCalledWith({
        action: 'decide',
        recruitmentId: 'recruitment-ui',
        version: 2,
        decision: 'approve',
        reason: 'Reviewed the bounded proposal.',
      }),
    )
    expect(screen.getByText('Status: pending ceo approval')).toBeDefined()
    expect(
      screen.getByText('No recruited employees have been activated.'),
    ).toBeDefined()
    expect(JSON.stringify(host.action.mock.calls)).not.toContain('actorId')
  })
  it('submits revised requirements without losing multiline or separated list entries', async () => {
    await ready()
    const disclosure = document.querySelector<HTMLDetailsElement>(
      '.recruitment-request',
    )!
    expect(disclosure.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Edit proposal' }))
    expect(disclosure.open).toBe(true)
    const responsibilities = screen.getByLabelText(
      'Responsibilities (one per line)',
    )
    fireEvent.change(responsibilities, { target: { value: 'Review\n' } })
    expect((responsibilities as HTMLTextAreaElement).value).toBe('Review\n')
    fireEvent.change(responsibilities, { target: { value: 'Review\nReport' } })
    expect(disclosure.open).toBe(true)
    fireEvent.change(
      screen.getByLabelText('Required response phrases (comma-separated)'),
      { target: { value: 'fixture,evidence' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit revised proposal' }),
    )
    await waitFor(() =>
      expect(host.action).toHaveBeenCalledWith({
        action: 'revise',
        recruitmentId: 'recruitment-ui',
        spec: {
          ...spec,
          responsibilities: ['Review', 'Report'],
          skills: [
            { ...spec.skills[0], expectedIncludes: ['fixture', 'evidence'] },
          ],
        },
      }),
    )
  })
  it('renders actual technical failure history without a skills rejection or fabricated evaluation', async () => {
    host.state = {
      ...host.state!,
      recruitments: {
        'recruitment-ui': {
          ...session(),
          state: 'technical_failure',
          failures: [
            {
              code: 'PROVIDER_UNAVAILABLE',
              stage: 'runtime_initializing',
              retryable: true,
              attempt: 1,
              occurredAt: '2026-10-13T00:02:00Z',
            },
          ],
        },
      },
    }
    await ready()
    expect(screen.getByText('Status: technical failure')).toBeDefined()
    expect(
      screen.getByText(/This is not evidence of insufficient skills/),
    ).toBeDefined()
    expect(
      screen.getByText('No completed assessment is available.'),
    ).toBeDefined()
    expect(screen.getByText(/SIMULATION: mock-success/)).toBeDefined()
    expect(
      screen.queryByRole('button', { name: 'Start approved interview' }),
    ).toBeNull()
    await act(async () => {
      host.state = {
        ...host.state!,
        recruitments: {
          'recruitment-ui': {
            ...session(),
            state: 'approved',
            approvedVersion: 2,
          },
        },
      }
      for (const listener of host.listeners) listener()
    })
    expect(
      screen.getByRole('button', { name: 'Start approved interview' }),
    ).toBeDefined()
  })
  it('does not offer a retry when the host marks a technical failure as requiring manual attention', async () => {
    host.state = {
      ...host.state!,
      recruitments: {
        'recruitment-ui': {
          ...session(),
          state: 'technical_failure',
          failures: [
            {
              code: 'NAVIGATION_UNAVAILABLE',
              stage: 'interview_in_progress',
              retryable: false,
              attempt: 1,
              occurredAt: '2026-10-13T00:02:00Z',
            },
          ],
        },
      },
    }
    await ready()
    expect(
      screen.queryByRole('button', { name: 'Retry technical failure' }),
    ).toBeNull()
    expect(screen.getByText(/Manual intervention required/)).toBeDefined()
    expect(host.action).not.toHaveBeenCalled()
  })
  it('keeps terminated employment history visible without scene inspection or operational controls', async () => {
    host.state = {
      ...host.state!,
      employees: {
        'candidate-ui': {
          employeeId: 'candidate-ui',
          agentId: 'candidate-ui',
          recruitmentId: 'recruitment-ui',
          status: 'terminated',
          mode: 'simulation',
          currentVersion: 2,
          versions: session().proposals,
          activatedAt: '2026-10-13T00:02:00Z',
          terminatedAt: '2026-10-13T00:03:00Z',
          terminationReason: 'Synthetic lifecycle check.',
        },
      },
    }
    await ready()
    const roster = screen.getByRole('region', { name: 'Employee roster' })
    expect(roster.textContent).toContain('Synthetic analyst')
    expect(roster.textContent).toContain('terminated')
    expect(
      screen.queryByRole('button', { name: 'Inspect employee' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Run approved employee request' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Terminate with recorded reason' }),
    ).toBeNull()
  })
})
