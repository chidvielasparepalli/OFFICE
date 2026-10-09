import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import { standingWorkstationAnchor } from '../office/characterMotion'
import type {
  AgentSpatialSnapshot,
  OfficeSelection,
  WorldPosition,
} from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'
import OfficeNavigationPreview from './OfficeNavigationPreview'
import {
  createNavigationSamples,
  SCENARIO_MANAGER_ID,
} from './officeNavigationFixtures'

interface WorldProps {
  inspectionSamples: AgentPlacement[]
  spatialViews: RefObject<Map<string, AgentSpatialSnapshot>>
  onSpatialEvent: (snapshot: AgentSpatialSnapshot) => void
  onSelectionChange: (selection: OfficeSelection) => void
  selectionRequest?: { version: number; selection: OfficeSelection }
  runtime?: unknown
}
const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  props: null as unknown,
  loaded: true,
}))
vi.mock('../office/officeNavigation', () => ({
  createOfficeNavigation: () => ({ planNavigation: mocks.plan }),
}))
vi.mock('../components/3d/OfficeWorld', () => ({
  OfficeWorld: (props: WorldProps) => {
    mocks.props = props
    if (mocks.loaded)
      for (const sample of props.inspectionSamples)
        if (!props.spatialViews.current.has(sample.id))
          props.spatialViews.current.set(sample.id, snapshot(sample))
    return <div data-testid="scenario-world" />
  },
}))

const world = () => mocks.props as WorldProps
const worker = (id = 'scenario-worker-01') =>
  world().inspectionSamples.find((sample) => sample.id === id)!
const choose = (id = 'scenario-worker-01') =>
  fireEvent.change(screen.getByLabelText('Scenario character'), {
    target: { value: id },
  })

function snapshot(
  sample: AgentPlacement,
  overrides: Partial<AgentSpatialSnapshot> = {},
): AgentSpatialSnapshot {
  return {
    agentId: sample.id,
    position: sample.position,
    headingRadians: sample.headingRadians,
    workstation: sample.workstation!,
    destination: null,
    movementState: 'stationary',
    speedMetersPerSecond: 0,
    pathProgress: null,
    collaborationTargetId: null,
    phase: 'seated',
    diagnostic: null,
    motionId: null,
    completedMotionId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.loaded = true
  mocks.plan
    .mockReset()
    .mockImplementation((current: WorldPosition, destinationId: string) => {
      const sample = createNavigationSamples().find(
        (actor) => `workstation:${actor.id}` === destinationId,
      )
      const destination = sample
        ? standingWorkstationAnchor(sample.workstation!)
        : ([0, 0, 3] as WorldPosition)
      return {
        ok: true,
        points: [current, destination],
        destination: { id: destinationId, position: destination },
        distanceMeters: Math.hypot(
          current[0] - destination[0],
          current[2] - destination[2],
        ),
      }
    })
})
afterEach(cleanup)

describe('development spatial scenarios', () => {
  it('rejects navigation until the selected character is mounted', () => {
    mocks.loaded = false
    render(<OfficeNavigationPreview />)
    choose()
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(worker().status).toBe('working')
    expect(worker().motion).toBeUndefined()
    expect(screen.getByTestId('scenario-feedback').textContent).toContain(
      'finish loading',
    )
    world().spatialViews.current.set(worker().id, snapshot(worker()))
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(mocks.plan).toHaveBeenCalledOnce()
    expect(worker().status).toBe('walking')
  })
  it('seeds 30 standard workers and a distinct seated Manager without runtime data', () => {
    render(<OfficeNavigationPreview />)
    expect(world().inspectionSamples).toHaveLength(31)
    expect(world().runtime).toBeUndefined()
    expect(
      new Set(world().inspectionSamples.map((sample) => sample.id)).size,
    ).toBe(31)
    expect(
      world().inspectionSamples.every((sample) => sample.status === 'working'),
    ).toBe(true)
    expect(worker(SCENARIO_MANAGER_ID)).toMatchObject({
      kind: 'manager',
      role: 'Manager asset sample',
      departmentId: 'executive',
    })
    expect(screen.getByText(/explicit development test input/)).toBeDefined()
    expect(
      (screen.getByTestId('scenario-character') as HTMLSelectElement).value,
    ).toBe('scenario-worker-13')
  })

  it('starts at the calibrated exit and changes to collaboration only on matching arrival', () => {
    render(<OfficeNavigationPreview />)
    choose()
    const before = worker()
    fireEvent.click(screen.getByTestId('scenario-hub'))
    const moving = worker()
    expect(mocks.plan).toHaveBeenCalledWith(
      standingWorkstationAnchor(before.workstation!),
      'hub:central',
    )
    expect(moving.status).toBe('walking')
    expect(moving.motion?.destination?.id).toBe('hub:central')
    expect(moving.workstation).toEqual(before.workstation)
    act(() =>
      world().onSpatialEvent(
        snapshot(moving, {
          completedMotionId: 'unrelated-command',
        }),
      ),
    )
    expect(worker().status).toBe('walking')
    act(() =>
      world().onSpatialEvent(
        snapshot(moving, {
          phase: 'standing',
          position: [0, 0, 3],
          completedMotionId: moving.motion!.id,
        }),
      ),
    )
    expect(worker().status).toBe('collaborating')
    expect(worker().motion).toBeUndefined()
    expect(world().inspectionSamples[1].status).toBe('working')
  })

  it('plans a return from live position while preserving the assigned desk', () => {
    render(<OfficeNavigationPreview />)
    choose()
    const before = worker()
    world().spatialViews.current.set(
      before.id,
      snapshot(before, {
        phase: 'walking',
        position: [-4, 0, 3],
        movementState: 'moving',
      }),
    )
    fireEvent.click(screen.getByTestId('scenario-return'))
    const returning = worker()
    expect(mocks.plan).toHaveBeenCalledWith(
      [-4, 0, 3],
      `workstation:${before.id}`,
    )
    expect(returning.status).toBe('walking')
    expect(returning.workstation).toEqual(before.workstation)
    act(() =>
      world().onSpatialEvent(
        snapshot(returning, {
          completedMotionId: returning.motion!.id,
        }),
      ),
    )
    expect(worker().status).toBe('working')
  })

  it('uses the exit during a partial posture transition and safely exposes rejected paths', () => {
    render(<OfficeNavigationPreview />)
    choose()
    const before = worker()
    world().spatialViews.current.set(
      before.id,
      snapshot(before, {
        phase: 'standing-up',
        position: [-12, 0, -12],
      }),
    )
    mocks.plan.mockReturnValueOnce({ ok: false, diagnostic: 'No clear route.' })
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(mocks.plan).toHaveBeenCalledWith(
      standingWorkstationAnchor(before.workstation!),
      'hub:central',
    )
    expect(worker()).toEqual(before)
    expect(screen.getByTestId('scenario-feedback').textContent).toBe(
      'No clear route.',
    )
  })

  it('keeps blocked routes paused and ignores stale completion after an explicit interruption', () => {
    render(<OfficeNavigationPreview />)
    choose()
    fireEvent.click(screen.getByTestId('scenario-hub'))
    const moving = worker()
    fireEvent.change(screen.getByLabelText('Scenario state'), {
      target: { value: 'blocked' },
    })
    expect(worker().motion).toEqual(moving.motion)
    act(() =>
      world().onSpatialEvent(
        snapshot(moving, {
          completedMotionId: moving.motion!.id,
        }),
      ),
    )
    expect(worker().status).toBe('blocked')
    fireEvent.change(screen.getByLabelText('Scenario state'), {
      target: { value: 'completed' },
    })
    expect(worker().motion).toBeUndefined()
    act(() =>
      world().onSpatialEvent(
        snapshot(moving, {
          completedMotionId: moving.motion!.id,
        }),
      ),
    )
    expect(worker().status).toBe('completed')
  })

  it('focuses the dedicated Manager and follows real scene selection', () => {
    render(<OfficeNavigationPreview />)
    fireEvent.click(screen.getByTestId('scenario-manager'))
    expect(world().selectionRequest?.selection).toEqual({
      kind: 'agent',
      id: SCENARIO_MANAGER_ID,
    })
    expect(
      (screen.getByTestId('scenario-character') as HTMLSelectElement).value,
    ).toBe(SCENARIO_MANAGER_ID)
    act(() =>
      world().onSelectionChange({ kind: 'agent', id: 'scenario-worker-02' }),
    )
    fireEvent.click(screen.getByTestId('scenario-focus'))
    expect(world().selectionRequest?.selection).toEqual({
      kind: 'agent',
      id: 'scenario-worker-02',
    })
  })

  it('reserves the hub until its occupant has physically cleared the departure', () => {
    render(<OfficeNavigationPreview />)
    choose()
    fireEvent.click(screen.getByTestId('scenario-hub'))
    const outgoing = worker()
    const arrived = snapshot(outgoing, {
      position: [0, 0, 3],
      phase: 'standing',
      completedMotionId: outgoing.motion!.id,
    })
    world().spatialViews.current.set(outgoing.id, arrived)
    act(() => world().onSpatialEvent(arrived))
    choose(SCENARIO_MANAGER_ID)
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(worker(SCENARIO_MANAGER_ID).status).toBe('working')
    expect(screen.getByTestId('scenario-feedback').textContent).toMatch(
      /hub is reserved by Worker scenario 1/,
    )
    choose()
    fireEvent.click(screen.getByTestId('scenario-return'))
    choose(SCENARIO_MANAGER_ID)
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(worker(SCENARIO_MANAGER_ID).motion).toBeUndefined()
    world().spatialViews.current.set(outgoing.id, {
      ...arrived,
      phase: 'walking',
      movementState: 'moving',
      position: [0, 0, 4.3],
      completedMotionId: null,
    })
    fireEvent.click(screen.getByTestId('scenario-hub'))
    expect(worker(SCENARIO_MANAGER_ID).status).toBe('walking')
    expect(worker(SCENARIO_MANAGER_ID).motion?.destination?.id).toBe(
      'hub:central',
    )
  })
})
