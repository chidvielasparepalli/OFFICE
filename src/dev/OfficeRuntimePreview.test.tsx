import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createOfficeRuntime } from '../runtime/officeRuntime'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import { createOfficeNavigation } from '../office/officeNavigation'
import OfficeRuntimePreview from './OfficeRuntimePreview'
import { DEVELOPMENT_AGENT_IDS } from './runtimeFixtures'

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
const scenario = (value: string) =>
  fireEvent.change(screen.getByTestId('runtime-scenario'), {
    target: { value },
  })
const selectTask = (value: string) =>
  fireEvent.change(screen.getByTestId('runtime-task'), { target: { value } })
function connect() {
  render(<OfficeRuntimePreview />)
  click('runtime-connect')
}
function createAssignedTask() {
  click('runtime-create-task')
  click('runtime-assign-task')
  return state().selectedTaskId!
}

beforeEach(() => {
  mocks.runtime = null
})
afterEach(cleanup)

describe('isolated development runtime preview', () => {
  it('starts empty and registers only three explicit development characters on connect', () => {
    render(<OfficeRuntimePreview />)
    expect(state().connection).toBe('disconnected')
    expect(state().agents).toEqual({})
    expect(state().tasks).toEqual({})
    click('runtime-connect')
    expect(state().connection).toBe('local')
    expect(Object.keys(state().agents)).toHaveLength(3)
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerA]).toMatchObject({
      kind: 'standard-worker',
      status: 'queued',
      position: [0, 0, 0],
    })
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerB].status).toBe(
      'sleeping',
    )
    expect(state().agents[DEVELOPMENT_AGENT_IDS.manager]).toMatchObject({
      kind: 'manager',
      status: 'waiting',
    })
    expect(
      Object.values(state().agents).every((agent) =>
        agent.role.startsWith('Development'),
      ),
    ).toBe(true)
    expect(state().tasks).toEqual({})
    expect(screen.getByTestId('runtime-connection').textContent).toContain(
      'never simulated automatically',
    )
  })

  it('uses authored desks, seated anchors and a valid initial corridor-to-desk route', () => {
    connect()
    const agents = Object.values(state().agents)
    const stations = agents.map((agent) => ({
      ...state().workstations[agent.workstationId!],
      id: agent.id,
    }))
    const navigation = createOfficeNavigation(stations)
    const first = state().agents[DEVELOPMENT_AGENT_IDS.workerA]
    expect(
      navigation.planNavigation(first.position, `workstation:${first.id}`).ok,
    ).toBe(true)
    for (const id of [
      DEVELOPMENT_AGENT_IDS.workerB,
      DEVELOPMENT_AGENT_IDS.manager,
    ]) {
      const agent = state().agents[id]
      expect(agent.position).toEqual(
        seatedWorkstationAnchor(state().workstations[agent.workstationId!]),
      )
    }
  })

  it('changes task assignment, progress and completion only through explicit controls', () => {
    connect()
    click('runtime-create-task')
    const id = state().selectedTaskId!
    expect(state().tasks[id]).toMatchObject({
      status: 'queued',
      assignedAgentId: null,
      progressPercent: 0,
    })
    click('runtime-assign-task')
    expect(state().tasks[id]).toMatchObject({
      status: 'assigned',
      assignedAgentId: DEVELOPMENT_AGENT_IDS.workerA,
    })
    click('runtime-start-task')
    expect(state().tasks[id]).toMatchObject({
      status: 'in_progress',
      progressPercent: 0,
    })
    expect(
      state().agents[DEVELOPMENT_AGENT_IDS.workerA].destination
        ?.destinationType,
    ).toBe('workstation')
    fireEvent.change(screen.getByTestId('runtime-progress-value'), {
      target: { value: '37' },
    })
    expect(state().tasks[id].progressPercent).toBe(0)
    click('runtime-set-progress')
    expect(state().tasks[id].progressPercent).toBe(37)
    click('runtime-complete-task')
    expect(state().tasks[id]).toMatchObject({
      status: 'completed',
      progressPercent: 100,
    })
  })

  it('retains records across disconnect/reconnect and resets to a new empty runtime', () => {
    connect()
    const id = createAssignedTask(),
      original = runtime()
    click('runtime-disconnect')
    expect(state().connection).toBe('disconnected')
    expect(state().tasks[id]).toBeDefined()
    click('runtime-connect')
    expect(runtime()).toBe(original)
    expect(Object.keys(state().agents)).toHaveLength(3)
    expect(state().tasks[id]).toBeDefined()
    click('runtime-reset')
    expect(runtime()).not.toBe(original)
    expect(state()).toMatchObject({
      connection: 'disconnected',
      agents: {},
      tasks: {},
    })
    expect(state().agents).toEqual({})
    expect(state().tasks).toEqual({})
  })

  it('surfaces dependency rejection and never automatically starts the unlocked task', () => {
    connect()
    scenario('dependency')
    click('runtime-create-dependencies')
    const tasks = Object.values(state().tasks)
    const first = tasks.find((task) => !task.dependencyIds.length)!
    const second = tasks.find((task) => task.dependencyIds.length)!
    selectTask(second.id)
    click('runtime-start-task')
    expect(state().tasks[second.id].status).not.toBe('in_progress')
    expect(screen.getByTestId('runtime-feedback').textContent).toMatch(
      /depend/i,
    )
    selectTask(first.id)
    click('runtime-start-task')
    click('runtime-complete-task')
    expect(state().tasks[first.id].status).toBe('completed')
    expect(state().tasks[second.id].status).not.toBe('in_progress')
    selectTask(second.id)
    click('runtime-start-task')
    expect(state().tasks[second.id].status).toBe('in_progress')
  })

  it('emits explicit collaboration and return intents without teleporting the agent', () => {
    connect()
    scenario('collaboration')
    const initialPosition =
      state().agents[DEVELOPMENT_AGENT_IDS.workerA].position
    click('runtime-collaborate')
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerA]).toMatchObject({
      position: initialPosition,
      destination: {
        destinationType: 'hub',
        destinationId: 'hub:central',
        arrivalStatus: 'collaborating',
        collaboratorIds: [DEVELOPMENT_AGENT_IDS.workerB],
      },
    })
    click('runtime-return')
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerA]).toMatchObject({
      position: initialPosition,
      destination: {
        destinationType: 'workstation',
        destinationId: 'phase5-desk-a',
        arrivalStatus: 'waiting',
      },
    })
  })

  it('keeps block, repair and task resume as separate explicit operations', () => {
    connect()
    const id = createAssignedTask()
    click('runtime-start-task')
    scenario('blocked')
    click('runtime-block-task')
    expect(state().tasks[id].status).toBe('blocked')
    click('runtime-repair-agent')
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerA].status).toBe('repair')
    expect(state().tasks[id].status).toBe('blocked')
    click('runtime-acknowledge-repair')
    expect(state().agents[DEVELOPMENT_AGENT_IDS.workerA].status).toBe('queued')
    expect(state().tasks[id].status).toBe('assigned')
    click('runtime-start-task')
    expect(state().tasks[id].status).toBe('in_progress')
  })

  it('assigns a Manager review to the dedicated Manager and selects table records through the store', () => {
    connect()
    scenario('manager')
    click('runtime-create-task')
    const id = state().selectedTaskId!
    expect(state().tasks[id]).toMatchObject({
      status: 'assigned',
      assignedAgentId: DEVELOPMENT_AGENT_IDS.manager,
    })
    expect(state().selectedAgentId).toBe(DEVELOPMENT_AGENT_IDS.manager)
    expect(state().agents[DEVELOPMENT_AGENT_IDS.manager].kind).toBe('manager')
    click('runtime-start-task')
    expect(state().tasks[id].status).toBe('in_progress')
    fireEvent.change(screen.getByTestId('runtime-agent'), {
      target: { value: DEVELOPMENT_AGENT_IDS.workerA },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /^Development Manager review$/ }),
    )
    expect(state().selectedTaskId).toBe(id)
    expect(state().selectedAgentId).toBe(DEVELOPMENT_AGENT_IDS.manager)
  })
})
