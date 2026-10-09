import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import { ManagerOrchestrator, TaskDispatcher } from './ManagerOrchestrator'
import type { PlanProposal, Planner, RequestInput } from './orchestrationTypes'
import { DeterministicPlanner } from './planner'

const request: RequestInput = {
  requestId: 'request:test',
  title: 'Explicit test request',
  description: 'Validate local task coordination.',
  requestedBy: 'test operator',
  priority: 'normal',
  constraints: ['No external execution'],
}

function proposal(): PlanProposal {
  return {
    planId: 'plan:test',
    requestId: request.requestId,
    objective: request.description,
    constraints: request.constraints,
    expectedOutputs: [],
    tasks: [
      {
        id: 'task:a',
        title: 'First supplied task',
        description: 'First test definition.',
        priority: 'normal',
        status: 'queued',
        dependencyIds: [],
        requiredCapabilities: ['research'],
        preferredAgentId: null,
      },
      {
        id: 'task:b',
        title: 'Dependent supplied task',
        description: 'Second test definition.',
        priority: 'high',
        status: 'queued',
        dependencyIds: ['task:a'],
        requiredCapabilities: ['implementation'],
        preferredAgentId: null,
      },
    ],
  }
}

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return runtime.getSnapshot()
}

function setup(
  planner: Planner = new DeterministicPlanner(() => proposal()),
  runtime = createOfficeRuntime({ now: () => '2026-10-09T12:00:00.000Z' }),
) {
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test department' },
  })
  for (const [id, kind, capabilities] of [
    ['manager', 'manager', ['coordination']],
    ['worker:a', 'standard-worker', ['research']],
    ['worker:b', 'standard-worker', ['implementation']],
  ] as const)
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        kind,
        capabilities,
        name: id,
        role: kind,
        departmentId: 'test',
        managerId: kind === 'manager' ? null : 'manager',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  const orchestrator = new ManagerOrchestrator({
    runtime,
    managerId: 'manager',
    planner,
  })
  orchestrator.start()
  expect(orchestrator.receiveRequest(request).ok).toBe(true)
  return { runtime, orchestrator }
}

describe('Manager orchestration on the existing runtime', () => {
  it('reports a failed attention write alongside the unavailable-worker dispatch error', async () => {
    const repository = createInMemoryOfficeRuntimeRepository()
    const runtime = createOfficeRuntime({
      repository: {
        read: () => repository.read(),
        write(state) {
          if (state.plans['plan:test']?.status === 'needs_attention')
            throw new Error('Injected write failure')
          repository.write(state)
        },
      },
    })
    const { orchestrator } = setup(
      new DeterministicPlanner(() => ({
        ...proposal(),
        tasks: [
          {
            ...proposal().tasks[0],
            requiredCapabilities: ['unavailable-capability'],
          },
        ],
      })),
      runtime,
    )
    await orchestrator.planRequest(request.requestId)
    const result = orchestrator.dispatchReady(request.requestId)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'AGENT_UNAVAILABLE',
      'REPOSITORY_ERROR',
    ])
    expect(runtime.getSnapshot().plans['plan:test'].status).toBe('planned')
    expect(orchestrator.getMetrics().monitorError?.code).toBe(
      'REPOSITORY_ERROR',
    )
    orchestrator.dispose()
  })

  it('surfaces failed rejection persistence and permits explicit cancellation of the unresolved attempt', async () => {
    const repository = createInMemoryOfficeRuntimeRepository()
    const runtime = createOfficeRuntime({
      repository: {
        read: () => repository.read(),
        write(state) {
          if (state.requests[request.requestId]?.status === 'failed')
            throw new Error('Injected rejection write failure')
          repository.write(state)
        },
      },
    })
    const { orchestrator } = setup(
      new DeterministicPlanner(() => null),
      runtime,
    )
    expect(await orchestrator.planRequest(request.requestId)).toMatchObject({
      ok: false,
      error: { code: 'REPOSITORY_ERROR' },
    })
    expect(runtime.getSnapshot().requests[request.requestId].status).toBe(
      'planning',
    )
    expect(runtime.getSnapshot().plans).toEqual({})
    expect(orchestrator.getMetrics().monitorError?.code).toBe(
      'REPOSITORY_ERROR',
    )
    expect(
      orchestrator.cancelRequest(
        request.requestId,
        'Cancel unresolved planning attempt',
      ).ok,
    ).toBe(true)
    expect(orchestrator.getMetrics().monitorError).toBeNull()
    expect(runtime.getSnapshot().requests[request.requestId].status).toBe(
      'cancelled',
    )
    orchestrator.dispose()
  })

  it('surfaces a failed monitor commit and recovers only through explicit synchronization', async () => {
    const repository = createInMemoryOfficeRuntimeRepository()
    let refuseCompletion = false
    const runtime = createOfficeRuntime({
      repository: {
        read: () => repository.read(),
        write(state) {
          if (
            refuseCompletion &&
            state.plans['plan:test']?.status === 'completed'
          )
            throw new Error('Injected persistence fault')
          repository.write(state)
        },
      },
    })
    const { orchestrator } = setup(undefined, runtime)
    await orchestrator.planRequest(request.requestId)
    orchestrator.dispatchReady(request.requestId)
    send(runtime, { type: 'completeTask', taskId: 'task:a' })
    orchestrator.dispatchReady(request.requestId)
    refuseCompletion = true
    send(runtime, { type: 'completeTask', taskId: 'task:b' })
    expect(runtime.getSnapshot().tasks['task:b'].status).toBe('completed')
    expect(runtime.getSnapshot().plans['plan:test'].status).toBe('executing')
    expect(orchestrator.getMetrics()).toMatchObject({
      monitorFailures: 1,
      monitorError: { code: 'REPOSITORY_ERROR' },
    })
    const commands = runtime.getMetrics().commands
    await Promise.resolve()
    expect(runtime.getMetrics().commands).toBe(commands)
    refuseCompletion = false
    expect(orchestrator.synchronize(request.requestId).ok).toBe(true)
    expect(orchestrator.getMetrics().monitorError).toBeNull()
    expect(orchestrator.getContext().request?.status).toBe('completed')
    orchestrator.dispose()
  })

  it('plans once, explicitly dispatches dependencies, and derives a factual result from canonical tasks', async () => {
    const { runtime, orchestrator } = setup()
    expect(runtime.getSnapshot().requests[request.requestId].status).toBe(
      'received',
    )
    expect((await orchestrator.planRequest(request.requestId)).ok).toBe(true)
    let context = orchestrator.getContext(request.requestId)
    expect(context.plan?.status).toBe('planned')
    expect(context.manager?.kind).toBe('manager')
    expect(context.manager?.status).toBe('working')
    expect(context.activeTasks.map((task) => task.status)).toEqual([
      'queued',
      'waiting',
    ])
    expect(
      Object.values(runtime.getSnapshot().tasks).filter(
        (task) => task.status === 'in_progress',
      ),
    ).toHaveLength(1)
    expect(orchestrator.dispatchReady(request.requestId)).toMatchObject({
      ok: true,
      dispatchedTaskIds: ['task:a'],
    })
    expect(runtime.getSnapshot().agents['worker:a'].status).toBe('working')
    expect(runtime.getSnapshot().agents['worker:b'].currentTaskId).toBeNull()
    send(runtime, { type: 'completeTask', taskId: 'task:a' })
    expect(runtime.getSnapshot().tasks['task:b'].status).toBe('queued')
    expect(runtime.getSnapshot().agents['worker:b'].currentTaskId).toBeNull()
    expect(
      orchestrator.dispatchReady(request.requestId).dispatchedTaskIds,
    ).toEqual(['task:b'])
    send(runtime, { type: 'completeTask', taskId: 'task:b' })
    context = orchestrator.getContext(request.requestId)
    expect(context.request?.status).toBe('completed')
    expect(context.plan?.status).toBe('completed')
    expect(context.manager?.status).toBe('completed')
    expect(context.result).toMatchObject({
      completedTaskIds: ['task:a', 'task:b'],
      failedTaskIds: [],
      blockedTaskIds: [],
      artifacts: [],
    })
    expect(context.result?.summary).toContain(
      'No output artifacts have been supplied or verified',
    )
    expect(context.activeTasks).toEqual([])
    expect(
      context.events.some((event) => event.type === 'TASK_COMPLETED'),
    ).toBe(true)
    expect(orchestrator.getMetrics().plannerCalls).toBe(1)
    orchestrator.dispose()
  })

  it.each(['blockTask', 'failTask'] as const)(
    'monitors %s without generating recovery or starting dependents',
    async (type) => {
      const { runtime, orchestrator } = setup()
      await orchestrator.planRequest(request.requestId)
      orchestrator.dispatchReady(request.requestId)
      send(runtime, {
        type,
        taskId: 'task:a',
        reason: 'Explicit failure input',
      })
      const context = orchestrator.getContext()
      expect(context.plan?.status).toBe('needs_attention')
      expect(context.request?.status).toBe('blocked')
      expect(context.plan?.issues.length).toBeGreaterThan(0)
      expect(runtime.getSnapshot().tasks['task:b'].status).toBe('waiting')
      expect(
        context.result?.[
          type === 'blockTask' ? 'blockedTaskIds' : 'failedTaskIds'
        ],
      ).toEqual(['task:a'])
      expect(orchestrator.getMetrics().plannerCalls).toBe(1)
      orchestrator.dispose()
    },
  )

  it('clears a manual blocker only after an explicit resume command', async () => {
    const { runtime, orchestrator } = setup()
    await orchestrator.planRequest(request.requestId)
    orchestrator.dispatchReady(request.requestId)
    send(runtime, {
      type: 'blockTask',
      taskId: 'task:a',
      reason: 'Operator hold',
    })
    orchestrator.dispatchReady(request.requestId)
    expect(runtime.getSnapshot().tasks['task:a'].status).toBe('blocked')
    send(runtime, { type: 'startTask', taskId: 'task:a' })
    expect(orchestrator.getContext().plan?.status).toBe('executing')
    orchestrator.dispose()
  })

  it('records unavailable capability-matched workers instead of assigning the Manager', async () => {
    const { runtime, orchestrator } = setup()
    await orchestrator.planRequest(request.requestId)
    send(runtime, {
      type: 'createTask',
      task: { id: 'unavailable-task', title: 'Explicit existing worker task' },
    })
    send(runtime, {
      type: 'assignTask',
      taskId: 'unavailable-task',
      agentId: 'worker:a',
    })
    send(runtime, { type: 'startTask', taskId: 'unavailable-task' })
    send(runtime, {
      type: 'blockTask',
      taskId: 'unavailable-task',
      reason: 'Operator requested repair',
    })
    send(runtime, {
      type: 'beginRepair',
      agentId: 'worker:a',
      reason: 'Explicit unavailable worker',
    })
    send(runtime, {
      type: 'cancelTask',
      taskId: 'unavailable-task',
      reason: 'Remove unrelated work while retaining repair hold',
    })
    const dispatch = orchestrator.dispatchReady(request.requestId)
    expect(dispatch.ok).toBe(false)
    expect(dispatch.issues[0].code).toBe('AGENT_UNAVAILABLE')
    expect(orchestrator.getContext().plan?.status).toBe('needs_attention')
    expect(runtime.getSnapshot().tasks['task:a'].assignedAgentId).toBeNull()
    send(runtime, {
      type: 'repairAgent',
      agentId: 'worker:a',
      reason: 'Operator acknowledgment',
    })
    expect(orchestrator.getContext().plan?.status).toBe('planned')
    expect(runtime.getSnapshot().tasks['task:a'].assignedAgentId).toBeNull()
    expect(
      orchestrator.dispatchReady(request.requestId).dispatchedTaskIds,
    ).toEqual(['task:a'])
    orchestrator.dispose()
  })

  it('rejects invalid planner output without any partially accepted body tasks', async () => {
    const { runtime, orchestrator } = setup(
      new DeterministicPlanner(() => ({
        ...proposal(),
        tasks: [...proposal().tasks, proposal().tasks[0]],
      })),
    )
    expect((await orchestrator.planRequest(request.requestId)).ok).toBe(false)
    expect(runtime.getSnapshot().plans).toEqual({})
    expect(runtime.getSnapshot().tasks['task:a']).toBeUndefined()
    expect(runtime.getSnapshot().requests[request.requestId].status).toBe(
      'failed',
    )
    expect(Object.values(runtime.getSnapshot().tasks)).toHaveLength(1)
    expect(Object.values(runtime.getSnapshot().tasks)[0].status).toBe('failed')
    orchestrator.dispose()
  })

  it('records a planner exception without exposing arbitrary provider error details', async () => {
    const { runtime, orchestrator } = setup({
      plan: async () => {
        throw new Error('sensitive provider details')
      },
    })
    const result = await orchestrator.planRequest(request.requestId)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(
      'sensitive provider details',
    )
    expect(runtime.getSnapshot().requests[request.requestId].status).toBe(
      'failed',
    )
    orchestrator.dispose()
  })

  it.each(['cancel', 'disconnect'] as const)(
    'discards a late proposal after %s',
    async (interrupt) => {
      let resolve!: (proposal: unknown) => void
      const planner: Planner = {
        plan: () =>
          new Promise((done) => {
            resolve = done
          }),
      }
      const { runtime, orchestrator } = setup(planner)
      const pending = orchestrator.planRequest(request.requestId)
      if (interrupt === 'cancel')
        expect(
          orchestrator.cancelRequest(request.requestId, 'Operator cancelled')
            .ok,
        ).toBe(true)
      else {
        send(runtime, { type: 'disconnect' })
        send(runtime, { type: 'connect' })
      }
      resolve(proposal())
      expect((await pending).ok).toBe(false)
      expect(runtime.getSnapshot().plans).toEqual({})
      expect(runtime.getSnapshot().tasks['task:a']).toBeUndefined()
      expect(runtime.getSnapshot().requests[request.requestId].status).not.toBe(
        'planning',
      )
      orchestrator.dispose()
    },
  )

  it('never dispatches in response to selection, progress or completion notifications', async () => {
    const { runtime, orchestrator } = setup()
    await orchestrator.planRequest(request.requestId)
    orchestrator.dispatchReady(request.requestId)
    const calls = orchestrator.getMetrics().dispatchAttempts
    const plans = orchestrator.getMetrics().plannerCalls
    send(runtime, { type: 'selectAgent', agentId: 'worker:a' })
    send(runtime, {
      type: 'updateProgress',
      taskId: 'task:a',
      progressPercent: 50,
    })
    send(runtime, { type: 'completeTask', taskId: 'task:a' })
    expect(orchestrator.getMetrics()).toMatchObject({
      dispatchAttempts: calls,
      plannerCalls: plans,
    })
    expect(runtime.getSnapshot().tasks['task:b'].status).toBe('queued')
    orchestrator.dispose()
  })

  it('has one restartable subscription, no timers, and cached read-only context', async () => {
    const timer = vi.spyOn(globalThis, 'setInterval')
    const { runtime, orchestrator } = setup()
    orchestrator.start()
    expect(runtime.getMetrics().subscribers).toBe(1)
    await orchestrator.planRequest(request.requestId)
    expect(orchestrator.getContext()).toBe(orchestrator.getContext())
    expect(Object.isFrozen(orchestrator.getContext())).toBe(true)
    expect(Object.isFrozen(orchestrator.getContext().result?.artifacts)).toBe(
      true,
    )
    orchestrator.dispose()
    expect(runtime.getMetrics().subscribers).toBe(0)
    orchestrator.start()
    expect(runtime.getMetrics().subscribers).toBe(1)
    expect(timer).not.toHaveBeenCalled()
    timer.mockRestore()
    orchestrator.dispose()
  })

  it('keeps current active request context separate from other Manager identities', async () => {
    const { runtime, orchestrator } = setup()
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id: 'other-manager',
        name: 'Other Manager',
        role: 'Manager',
        kind: 'manager',
        departmentId: 'test',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
    send(runtime, {
      type: 'receiveRequest',
      managerId: 'other-manager',
      request: { ...request, requestId: 'other-request' },
    })
    expect(orchestrator.getContext('other-request').request).toBeNull()
    expect(orchestrator.dispatchReady('other-request').ok).toBe(false)
    await orchestrator.planRequest(request.requestId)
    expect(
      new TaskDispatcher(runtime, 'other-manager').dispatch(
        'plan:test',
        'task:a',
      ).ok,
    ).toBe(false)
    expect(runtime.getSnapshot().tasks['task:a'].assignedAgentId).toBeNull()
    orchestrator.dispose()
  })

  it('cancels the whole owned workflow without touching unrelated tasks', async () => {
    const { runtime, orchestrator } = setup()
    await orchestrator.planRequest(request.requestId)
    orchestrator.dispatchReady(request.requestId)
    send(runtime, {
      type: 'createTask',
      task: { id: 'unrelated', title: 'Unrelated task' },
    })
    expect(
      orchestrator.cancelRequest(request.requestId, 'Explicit cancellation').ok,
    ).toBe(true)
    const state = runtime.getSnapshot()
    expect(state.requests[request.requestId].status).toBe('cancelled')
    expect(state.plans['plan:test'].status).toBe('cancelled')
    expect(state.tasks['task:a'].status).toBe('cancelled')
    expect(state.tasks['task:b'].status).toBe('cancelled')
    expect(state.tasks.unrelated.status).toBe('queued')
    orchestrator.dispose()
  })
})
