import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { RuntimeOffice } from './RuntimeOffice'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import type { OfficeWorld } from './3d/OfficeWorld'
import type { AgentSpatialSnapshot } from '../office/officeState'

const world = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('./3d/OfficeWorld', () => ({
  OfficeWorld: (props: unknown) => {
    world.props = props
    return <div data-testid="runtime-world" />
  },
}))
afterEach(cleanup)
const view = () => world.props as ComponentProps<typeof OfficeWorld>

function setup() {
  const runtime = createOfficeRuntime({ now: () => '2026-10-09T12:00:00Z' })
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
    workstation: { id: 'desk', position: [-5, 0, 0], headingRadians: 0 },
  })
  issue({
    type: 'registerAgent',
    agent: {
      id: 'worker',
      name: 'Test worker',
      role: 'Test role',
      kind: 'standard-worker',
      departmentId: 'engineering',
      workstationId: 'desk',
      position: [0, 0, 0],
      headingRadians: 0,
    },
  })
  issue({
    type: 'createTask',
    task: {
      id: 'task',
      title: 'Explicit test task',
      description: 'Supplied description',
    },
  })
  issue({ type: 'assignTask', taskId: 'task', agentId: 'worker' })
  return { runtime, issue }
}

describe('runtime office integration', () => {
  it('supports asynchronous host feedback without optimistically completing a route or task', async () => {
    const { runtime, issue } = setup()
    issue({ type: 'startTask', taskId: 'task' })
    let release!: () => void
    const dispatch = vi.fn(
      (command: RuntimeCommand) =>
        new Promise<RuntimeResult>((resolve) => {
          release = () => resolve(runtime.dispatch(command))
        }),
    )
    render(
      <RuntimeOffice
        runtime={{
          getSnapshot: runtime.getSnapshot,
          subscribe: runtime.subscribe,
          dispatch,
        }}
        executionNotice="Controlled host execution."
      />,
    )
    expect(screen.getByText('Controlled host execution.')).toBeDefined()
    const spatial: AgentSpatialSnapshot = {
      agentId: 'worker',
      position: [0, 0, 0],
      headingRadians: 0,
      workstation: runtime.getSnapshot().workstations.desk,
      destination: null,
      movementState: 'stationary',
      speedMetersPerSecond: 0,
      pathProgress: null,
      collaborationTargetId: null,
      phase: 'standing',
      diagnostic: null,
      motionId: null,
      completedMotionId: null,
    }
    view().spatialViews!.current.set('worker', spatial)
    act(() => view().onSpatialEvent?.(spatial))
    const motion = view().runtime!.agents.worker.motion!
    const arrival = {
      ...spatial,
      position: motion.points.at(-1)!,
      motionId: motion.id,
      completedMotionId: motion.id,
      pathProgress: 1,
    }
    view().spatialViews!.current.set('worker', arrival)
    act(() => view().onSpatialEvent?.(arrival))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().agents.worker.destination).not.toBeNull()
    expect(runtime.getSnapshot().tasks.task.status).toBe('in_progress')
    await act(async () => release())
    expect(runtime.getSnapshot().agents.worker.destination).toBeNull()
    expect(runtime.getSnapshot().tasks.task.status).toBe('in_progress')
    act(() => view().onSpatialEvent?.(arrival))
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('keeps the default runtime empty and unsubscribes on unmount', () => {
    const runtime = createOfficeRuntime()
    const mounted = render(<RuntimeOffice runtime={runtime} />)
    expect(view().runtime).toBeNull()
    expect(screen.getByText(/Runtime disconnected/)).toBeDefined()
    expect(runtime.getSnapshot().events).toHaveLength(0)
    expect(runtime.getMetrics().subscribers).toBe(2)
    mounted.unmount()
    expect(runtime.getMetrics().subscribers).toBe(0)
  })

  it('connects exact selection and live task context without refocusing for business updates', () => {
    const { runtime, issue } = setup()
    render(<RuntimeOffice runtime={runtime} />)
    act(() => view().onSelectionChange?.({ kind: 'agent', id: 'worker' }))
    expect(runtime.getSnapshot().selectedAgentId).toBe('worker')
    const sceneRequest = view().selectionRequest
    act(() =>
      view().onSelectionChange?.({ kind: 'department', id: 'engineering' }),
    )
    expect(runtime.getSnapshot().selectedAgentId).toBeNull()
    expect(view().selectionRequest).toBe(sceneRequest)
    act(() => issue({ type: 'selectAgent', agentId: 'worker' }))
    expect(view().selectionRequest?.selection).toEqual({
      kind: 'agent',
      id: 'worker',
    })
    const focus = view().selectionRequest
    act(() => view().onSelectTask?.('task'))
    expect(runtime.getSnapshot().selectedTaskId).toBe('task')
    expect(screen.getByRole('region', { name: 'Selected task' })).toBeDefined()
    act(() => issue({ type: 'startTask', taskId: 'task' }))
    act(() =>
      issue({ type: 'updateProgress', taskId: 'task', progressPercent: 23 }),
    )
    expect(screen.getByText('23%')).toBeDefined()
    expect(view().runtime?.agents.worker.task?.progressPercent).toBe(23)
    expect(view().selectionRequest).toBe(focus)
    act(() => issue({ type: 'completeTask', taskId: 'task' }))
    expect(screen.getByText('completed')).toBeDefined()
    expect(view().runtime?.agents.worker.status).toBe('completed')
    expect(view().runtime?.agents.worker.kind).toBe('standard-worker')
    fireEvent.click(screen.getByRole('button', { name: 'Close task context' }))
    expect(runtime.getSnapshot().selectedTaskId).toBeNull()
    expect(screen.queryByRole('region', { name: 'Selected task' })).toBeNull()
    act(() => issue({ type: 'disconnect' }))
    expect(view().runtime).toBeNull()
    expect(screen.getByText(/Runtime disconnected/)).toBeDefined()
  })

  it('plans after mounting and accepts matching arrival without completing the task', () => {
    const { runtime, issue } = setup()
    issue({ type: 'startTask', taskId: 'task' })
    render(<RuntimeOffice runtime={runtime} diagnostics />)
    expect(view().runtime?.agents.worker.motion).toBeUndefined()
    const spatial: AgentSpatialSnapshot = {
      agentId: 'worker',
      position: [0, 0, 0],
      headingRadians: 0,
      workstation: runtime.getSnapshot().workstations.desk,
      destination: null,
      movementState: 'stationary',
      speedMetersPerSecond: 0,
      pathProgress: null,
      collaborationTargetId: null,
      phase: 'standing',
      diagnostic: null,
      motionId: null,
      completedMotionId: null,
    }
    view().spatialViews!.current.set('worker', spatial)
    act(() => view().onSpatialEvent?.(spatial))
    const motion = view().runtime?.agents.worker.motion
    expect(motion).toBeDefined()
    const arrival = {
      ...spatial,
      position: motion!.points.at(-1)!,
      motionId: motion!.id,
      completedMotionId: motion!.id,
      pathProgress: 1,
    }
    view().spatialViews!.current.set('worker', arrival)
    act(() => view().onSpatialEvent?.(arrival))
    expect(runtime.getSnapshot().agents.worker.destination).toBeNull()
    expect(runtime.getSnapshot().tasks.task.status).toBe('in_progress')
    expect(runtime.getSnapshot().agents.worker.status).toBe('working')
    const revision = runtime.getSnapshot().revision
    act(() => view().onSpatialEvent?.(arrival))
    expect(runtime.getSnapshot().revision).toBe(revision)
    fireEvent.click(screen.getByTestId('runtime-sample-counters'))
    const counters = JSON.parse(
      screen.getByTestId('runtime-counters').textContent!,
    )
    expect(counters.bridge.plans).toBe(1)
    expect(counters.bridge.graphBuilds).toBe(1)
  })
})
