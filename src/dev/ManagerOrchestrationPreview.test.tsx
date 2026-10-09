import { StrictMode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import { createOfficeNavigation } from '../office/officeNavigation'
import ManagerOrchestrationPreview from './ManagerOrchestrationPreview'
import {
  MANAGER_PREVIEW_IDS,
  managerDevelopmentPlan,
  managerRegistrations,
} from './managerFixtures'

const mocks = vi.hoisted(() => ({ runtime: null as unknown }))
vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: ({ runtime }: { runtime: unknown }) => {
    mocks.runtime = runtime
    return <div data-testid="runtime-office" />
  },
}))
const runtime = () => mocks.runtime as ReturnType<typeof createOfficeRuntime>
const state = () => runtime().getSnapshot()
const click = (id: string) => fireEvent.click(screen.getByTestId(id))
const change = (id: string, value: string) =>
  fireEvent.change(screen.getByTestId(id), { target: { value } })
const request = () => Object.values(state().requests)[0]
const plan = () => state().plans[request().planId!]

function connect() {
  render(<ManagerOrchestrationPreview />)
  click('manager-connect')
}
async function planRequest() {
  click('manager-receive')
  click('manager-plan')
  await waitFor(() => expect(request().status).toBe('planned'))
  return plan().taskIds
}
beforeEach(() => {
  mocks.runtime = null
})
afterEach(cleanup)

describe('Manager development fixture', () => {
  it('registers two distinct capabilities, authored safe desks and a separate Manager', () => {
    const office = createOfficeRuntime()
    expect(office.dispatch({ type: 'connect' }).ok).toBe(true)
    for (const command of managerRegistrations())
      expect(office.dispatch(command).ok).toBe(true)
    const snapshot = office.getSnapshot()
    const { manager, researcher, implementer } = MANAGER_PREVIEW_IDS
    expect(snapshot.agents[manager].kind).toBe('manager')
    expect(snapshot.agents[researcher].capabilities).toEqual([
      'development.research',
    ])
    expect(snapshot.agents[implementer].capabilities).toEqual([
      'development.implementation',
    ])
    expect(snapshot.agents[researcher].position).toEqual([0, 0, 0])
    for (const id of [manager, implementer])
      expect(snapshot.agents[id].position).toEqual(
        seatedWorkstationAnchor(
          snapshot.workstations[snapshot.agents[id].workstationId!],
        ),
      )
    const navigation = createOfficeNavigation(
      Object.values(snapshot.agents).map((agent) => ({
        ...snapshot.workstations[agent.workstationId!],
        id: agent.id,
      })),
    )
    expect(
      navigation.planNavigation(
        snapshot.agents[researcher].position,
        `workstation:${researcher}`,
      ).ok,
    ).toBe(true)
    expect(snapshot.requests).toEqual({})
    expect(snapshot.tasks).toEqual({})
  })
})

describe('isolated Manager orchestration preview', () => {
  it('begins disconnected and never creates requests or tasks on connection alone', () => {
    render(<ManagerOrchestrationPreview />)
    expect(state().connection).toBe('disconnected')
    expect(state().agents).toEqual({})
    click('manager-connect')
    expect(Object.keys(state().agents)).toHaveLength(3)
    expect(state().requests).toEqual({})
    expect(state().plans).toEqual({})
    expect(state().tasks).toEqual({})
    expect(screen.getByTestId('manager-template').textContent).toContain(
      'same fixed template',
    )
  })

  it('preserves request prose and constraints without pretending to interpret them', async () => {
    connect()
    change('manager-request-title', 'Operator supplied title')
    change('manager-request-description', 'Operator supplied description')
    click('manager-receive')
    expect(request()).toMatchObject({
      title: 'Operator supplied title',
      description: 'Operator supplied description',
      status: 'received',
      managerId: MANAGER_PREVIEW_IDS.manager,
    })
    expect(state().plans).toEqual({})
    const proposed = managerDevelopmentPlan(request())
    expect(proposed.constraints).toEqual(request().constraints)
    expect(proposed.expectedOutputs).toEqual([])
    click('manager-plan')
    await waitFor(() => expect(request().status).toBe('planned'))
    expect(plan().objective).toBe('Operator supplied title')
    expect(plan().taskIds).toHaveLength(2)
    const [a, b] = plan().taskIds.map((id) => state().tasks[id])
    expect(a.status).toBe('queued')
    expect(b.dependencyIds).toEqual([a.id])
    expect(a.assignedAgentId).toBeNull()
    expect(b.assignedAgentId).toBeNull()
    expect(screen.getByTestId('manager-task-graph').textContent).toContain(
      'Committed task graph',
    )
  })

  it('dispatches by capability only on command and never auto-starts a newly ready dependency', async () => {
    connect()
    const [a, b] = await planRequest()
    click('manager-dispatch')
    expect(state().tasks[a]).toMatchObject({
      status: 'in_progress',
      assignedAgentId: MANAGER_PREVIEW_IDS.researcher,
      progressPercent: 0,
    })
    expect(state().tasks[b]).toMatchObject({
      status: 'waiting',
      assignedAgentId: null,
      progressPercent: 0,
      waitingForDependencies: true,
    })
    click('manager-dispatch')
    expect(state().tasks[b].assignedAgentId).toBeNull()
    click('manager-complete-task')
    expect(state().tasks[a].status).toBe('completed')
    expect(state().tasks[b].status).toBe('queued')
    expect(state().agents[MANAGER_PREVIEW_IDS.implementer].status).toBe(
      'sleeping',
    )
    click('manager-dispatch')
    expect(state().tasks[b]).toMatchObject({
      status: 'in_progress',
      assignedAgentId: MANAGER_PREVIEW_IDS.implementer,
    })
    change('manager-task', b)
    click('manager-complete-task')
    expect(request().status).toBe('completed')
    expect(plan().status).toBe('completed')
    expect(screen.getByTestId('manager-result').textContent).toContain(
      '2 of 2 tasks recorded complete',
    )
    expect(screen.getByTestId('manager-result').textContent).toContain(
      'No artifacts have been reported',
    )
  })

  it('shows actual blocked state and requires explicit resumption', async () => {
    connect()
    const [a, b] = await planRequest()
    click('manager-dispatch')
    change('manager-outcome-reason', 'Operator is waiting for input')
    click('manager-block-task')
    expect(state().tasks[a]).toMatchObject({
      status: 'blocked',
      statusReason: 'Operator is waiting for input',
    })
    expect(request().status).toBe('blocked')
    expect(plan().status).toBe('needs_attention')
    expect(screen.getByTestId('manager-context').textContent).toContain(
      'Development research step',
    )
    click('manager-dispatch')
    expect(state().tasks[a].status).toBe('blocked')
    expect(state().tasks[b].assignedAgentId).toBeNull()
    click('manager-resume-task')
    expect(state().tasks[a].status).toBe('in_progress')
    expect(request().status).toBe('executing')
  })

  it('records a failed outcome without claiming success or dispatching its dependent', async () => {
    connect()
    const [a, b] = await planRequest()
    click('manager-dispatch')
    change('manager-outcome-reason', 'Explicit development failure')
    click('manager-fail-task')
    expect(state().tasks[a]).toMatchObject({
      status: 'failed',
      statusReason: 'Explicit development failure',
    })
    expect(request().status).toBe('blocked')
    expect(plan().status).toBe('needs_attention')
    click('manager-dispatch')
    expect(state().tasks[b].status).not.toBe('in_progress')
    expect(state().tasks[b].assignedAgentId).toBeNull()
    expect(screen.getByTestId('manager-result').textContent).toContain(
      '1 failed',
    )
  })

  it('connects graph selection and Manager focus to existing runtime IDs', async () => {
    connect()
    const [a] = await planRequest()
    click('manager-dispatch')
    fireEvent.click(
      screen.getByRole('button', { name: 'Development research step' }),
    )
    expect(state().selectedTaskId).toBe(a)
    expect(state().selectedAgentId).toBe(MANAGER_PREVIEW_IDS.researcher)
    click('manager-focus')
    expect(state().selectedAgentId).toBe(MANAGER_PREVIEW_IDS.manager)
    expect(state().agents[MANAGER_PREVIEW_IDS.manager].kind).toBe('manager')
  })

  it('retains records across reconnect and resets to a fresh runtime without leaked subscriptions', async () => {
    connect()
    await planRequest()
    const old = runtime()
    click('manager-disconnect')
    expect(state().connection).toBe('disconnected')
    expect(Object.keys(state().requests)).toHaveLength(1)
    expect(
      screen.getByTestId('manager-retained-records').textContent,
    ).toContain('showing retained local session records')
    click('manager-connect')
    expect(runtime()).toBe(old)
    expect(Object.keys(state().requests)).toHaveLength(1)
    expect(Object.keys(state().agents)).toHaveLength(3)
    click('manager-reset')
    expect(runtime()).not.toBe(old)
    expect(state().connection).toBe('disconnected')
    expect(state().requests).toEqual({})
    expect(state().plans).toEqual({})
    expect(old.getMetrics().subscribers).toBe(0)
  })

  it('restarts the orchestrator subscription safely under StrictMode', async () => {
    const view = render(
      <StrictMode>
        <ManagerOrchestrationPreview />
      </StrictMode>,
    )
    click('manager-connect')
    const [a] = await planRequest()
    click('manager-dispatch')
    click('manager-block-task')
    expect(request().status).toBe('blocked')
    expect(state().tasks[a].status).toBe('blocked')
    expect(runtime().getMetrics().subscribers).toBe(2)
    const previous = runtime()
    view.unmount()
    expect(previous.getMetrics().subscribers).toBe(0)
  })
})
