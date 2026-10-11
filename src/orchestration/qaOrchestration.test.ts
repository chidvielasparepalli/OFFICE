import { describe, expect, it } from 'vitest'
import { QAEngine } from '../qa/QAEngine'
import type { QACheck } from '../qa/qaTypes'
import {
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeJson } from '../runtime/runtimeTypes'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import { ManagerOrchestrator } from './ManagerOrchestrator'
import { DeterministicPlanner } from './planner'

const check: QACheck = {
  checkId: 'document',
  title: 'Required section',
  type: 'requirement-compliance',
  required: true,
  severity: 'error',
  toolId: 'inspect.document',
  input: {},
  assertion: {
    kind: 'includes',
    path: ['document'],
    value: 'Required section',
  },
}

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return runtime.getSnapshot()
}

async function setup(
  options: {
    dependencies?: boolean
    grant?: boolean
    maxRepairAttempts?: number
    beforeInspect?: () => Promise<void>
  } = {},
) {
  const runtime = createOfficeRuntime({ now: () => '2026-10-12T12:00:00.000Z' })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test' },
  })
  for (const [id, kind, capabilities] of [
    ['manager', 'manager', ['coordination']],
    ['author', 'standard-worker', ['writing']],
    ['verifier', 'standard-worker', ['qa']],
    ['repairer', 'standard-worker', ['writing']],
    ['other-manager', 'manager', ['coordination']],
  ] as const) {
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
  }
  const planner = new DeterministicPlanner((request) => ({
    requestId: request.requestId,
    planId: 'plan',
    objective: request.description,
    constraints: [],
    expectedOutputs: [],
    tasks: [
      {
        id: 'source',
        title: 'Document',
        description: 'Authored test document',
        priority: 'normal',
        status: 'queued',
        dependencyIds: [],
        requiredCapabilities: ['writing'],
        preferredAgentId: 'author',
      },
      ...(options.dependencies
        ? [
            {
              id: 'dependent',
              title: 'Follow-up',
              description: 'Depends on verified document',
              priority: 'normal',
              status: 'queued',
              dependencyIds: ['source'],
              requiredCapabilities: ['writing'],
              preferredAgentId: 'repairer',
            },
          ]
        : []),
    ],
  }))
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: 'manager',
    planner,
  })
  manager.start()
  send(runtime, {
    type: 'receiveRequest',
    managerId: 'manager',
    request: {
      requestId: 'request',
      title: 'Test request',
      description: 'Validate explicit QA coordination',
      requestedBy: 'test operator',
      priority: 'normal',
      constraints: [],
    },
  })
  expect((await manager.planRequest('request')).ok).toBe(true)
  expect(
    manager.requestQA({
      qaId: 'qa',
      taskId: 'source',
      scope: 'Test document',
      checks: [check],
      repairCapabilities: ['writing'],
      maxRepairAttempts: options.maxRepairAttempts ?? 2,
    }).ok,
  ).toBe(true)
  expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual(['source'])
  send(runtime, { type: 'completeTask', taskId: 'source' })
  const document = { text: 'Required section' }
  const registry = new ToolRegistry()
  registry.register({
    id: 'inspect.document',
    name: 'Inspect test document',
    description: 'Reads the current explicitly supplied test document',
    category: 'validation',
    capabilities: ['qa'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 1000,
    metadata: {},
    inputSchema: {
      description: 'Object',
      parse: (value) => value as RuntimeJson,
    },
    outputSchema: {
      description: 'Document object',
      parse: (value) => value as RuntimeJson,
    },
    summarizeInput: () => ({}),
    execute: async () => {
      await options.beforeInspect?.()
      return { document: document.text }
    },
  })
  const executor = new ToolExecutor({
    runtime,
    registry,
    grants:
      options.grant === false
        ? {}
        : {
            verifier: { toolIds: ['inspect.document'], permissions: ['read'] },
          },
  })
  const engine = new QAEngine({ runtime, executor })
  const dispose = () => {
    manager.dispose()
    executor.dispose()
  }
  return { runtime, manager, engine, document, planner, dispose }
}

describe('Manager QA coordination through canonical runtime records', () => {
  it('keeps completed work awaiting verification and dependencies undispatched until a real pass', async () => {
    const { runtime, manager, engine, dispose } = await setup({
      dependencies: true,
    })
    expect(runtime.getSnapshot().tasks.source.status).toBe('completed')
    expect(runtime.getSnapshot().plans.plan.status).toBe('executing')
    expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual([])
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('waiting')
    expect(manager.getContext().result).toMatchObject({
      completedTaskIds: ['source'],
      verifiedTaskIds: [],
      awaitingVerificationTaskIds: ['source'],
    })
    const result = await engine.run('qa', 'verifier')
    expect(result.status).toBe('passed')
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('queued')
    expect(runtime.getSnapshot().agents.repairer.currentTaskId).toBeNull()
    expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual([
      'dependent',
    ])
    send(runtime, { type: 'completeTask', taskId: 'dependent' })
    expect(manager.getContext().result).toMatchObject({
      status: 'completed',
      verifiedTaskIds: ['source'],
      awaitingVerificationTaskIds: [],
    })
    expect(runtime.getSnapshot().tasks.dependent.verification).toBeUndefined()
    dispose()
  })

  it('retains the original failure, coordinates a canonical repair and clears derived issues only after recheck passes', async () => {
    const { runtime, manager, engine, document, dispose } = await setup()
    document.text = 'Incomplete document'
    expect((await engine.run('qa', 'verifier')).status).toBe('failed')
    expect(manager.getContext().plan).toMatchObject({
      status: 'needs_attention',
      issues: [expect.objectContaining({ code: 'QA_FAILED' })],
    })
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    expect(manager.assignRepair(repair.repairId).ok).toBe(true)
    expect(manager.startRepair(repair.repairId).ok).toBe(true)
    expect(
      manager
        .getContext()
        .activeTasks.some((task) => task.id === repair.taskId),
    ).toBe(true)
    document.text = 'Required section after explicit repair'
    send(runtime, { type: 'completeTask', taskId: repair.taskId })
    expect(runtime.getSnapshot().qaRequests.qa.status).toBe('failed')
    expect(manager.getContext().plan?.status).toBe('needs_attention')
    expect(manager.recheckQA('qa', 'recheck').ok).toBe(true)
    expect(manager.getContext().plan).toMatchObject({
      status: 'executing',
      issues: [],
    })
    expect((await engine.run('recheck', 'verifier')).status).toBe('passed')
    const context = manager.getContext()
    expect(context.plan).toMatchObject({ status: 'completed', issues: [] })
    expect(context.qaRequests.map((qa) => qa.status)).toEqual([
      'failed',
      'passed',
    ])
    expect(context.repairs[0].status).toBe('completed')
    expect(
      context.events.some((event) => event.type === 'REPAIR_COMPLETED'),
    ).toBe(true)
    expect(context.result?.verifiedTaskIds).toEqual(['source'])
    expect(context.manager).toMatchObject({
      kind: 'manager',
      status: 'completed',
    })
    dispose()
  })

  it('surfaces permission-blocked checks without auto-repair, retry or success', async () => {
    const { runtime, manager, engine, dispose } = await setup({ grant: false })
    expect((await engine.run('qa', 'verifier')).status).toBe('blocked')
    expect(manager.getContext().plan?.issues).toContainEqual(
      expect.objectContaining({ code: 'QA_BLOCKED' }),
    )
    expect(manager.getContext().request?.status).toBe('blocked')
    expect(runtime.getSnapshot().repairRequests).toEqual({})
    const count = runtime.getMetrics().commands
    await Promise.resolve()
    expect(runtime.getMetrics().commands).toBe(count)
    expect(manager.getMetrics().plannerCalls).toBe(1)
    dispose()
  })

  it('marks exhausted repairs for attention without creating another task', async () => {
    const { runtime, manager, engine, document, dispose } = await setup({
      maxRepairAttempts: 1,
    })
    document.text = 'Incomplete'
    await engine.run('qa', 'verifier')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    expect(manager.assignRepair(repair.repairId).ok).toBe(true)
    expect(manager.startRepair(repair.repairId).ok).toBe(true)
    send(runtime, { type: 'completeTask', taskId: repair.taskId })
    expect(manager.recheckQA('qa', 'second').ok).toBe(true)
    expect((await engine.run('second', 'verifier')).status).toBe('failed')
    expect(manager.getContext().plan?.issues).toContainEqual(
      expect.objectContaining({ code: 'QA_RETRY_EXHAUSTED' }),
    )
    expect(Object.keys(runtime.getSnapshot().repairRequests)).toHaveLength(1)
    expect(manager.getContext().result?.verifiedTaskIds).toEqual([])
    dispose()
  })

  it.each(['failTask', 'cancelTask'] as const)(
    'observes %s on the canonical repair task',
    async (type) => {
      const { runtime, manager, engine, document, dispose } = await setup()
      document.text = 'Incomplete'
      await engine.run('qa', 'verifier')
      const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
      expect(manager.assignRepair(repair.repairId).ok).toBe(true)
      expect(manager.startRepair(repair.repairId).ok).toBe(true)
      send(runtime, {
        type,
        taskId: repair.taskId,
        reason: 'Explicit test intervention',
      })
      expect(manager.getContext().plan?.issues).toContainEqual(
        expect.objectContaining({
          code: type === 'failTask' ? 'REPAIR_FAILED' : 'REPAIR_CANCELLED',
        }),
      )
      expect(manager.recheckQA('qa').ok).toBe(false)
      dispose()
    },
  )

  it('cancels pending QA with its request and leaves no releasable QA', async () => {
    const { runtime, manager, engine, dispose } = await setup()
    expect(manager.cancelRequest('request', 'Stop explicit scenario').ok).toBe(
      true,
    )
    expect(runtime.getSnapshot().qaRequests.qa.status).toBe('cancelled')
    expect(manager.getContext().plan?.status).toBe('cancelled')
    expect((await engine.run('qa', 'verifier')).status).toBe('cancelled')
    expect(Object.keys(runtime.getSnapshot().toolExecutions)).toHaveLength(0)
    dispose()
  })

  it('cancels linked repair tasks with the owning request', async () => {
    const { runtime, manager, engine, document, dispose } = await setup()
    document.text = 'Incomplete'
    await engine.run('qa', 'verifier')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    expect(manager.assignRepair(repair.repairId).ok).toBe(true)
    expect(manager.startRepair(repair.repairId).ok).toBe(true)
    expect(manager.cancelRequest('request', 'Stop repair').ok).toBe(true)
    expect(runtime.getSnapshot().tasks[repair.taskId].status).toBe('cancelled')
    expect(runtime.getSnapshot().repairRequests[repair.repairId].status).toBe(
      'cancelled',
    )
    expect(manager.getContext().plan?.status).toBe('cancelled')
    dispose()
  })

  it('cancels an active verifier tool atomically with its request and ignores late output', async () => {
    let signalStarted!: () => void
    let releaseTool!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseTool = resolve
    })
    const { runtime, manager, engine, dispose } = await setup({
      beforeInspect: () => {
        signalStarted()
        return release
      },
    })
    const running = engine.run('qa', 'verifier')
    await started
    const executionId =
      runtime.getSnapshot().qaRequests.qa.executionIds.document
    expect(runtime.getSnapshot().toolExecutions[executionId].status).toBe(
      'running',
    )
    expect(manager.cancelRequest('request', 'Stop verifier').ok).toBe(true)
    expect(runtime.getSnapshot().toolExecutions[executionId].status).toBe(
      'cancelled',
    )
    expect(runtime.getSnapshot().qaRequests.qa.status).toBe('cancelled')
    expect(manager.getContext().plan?.status).toBe('cancelled')
    releaseTool()
    expect((await running).status).toBe('cancelled')
    expect(runtime.getSnapshot().toolExecutions[executionId].output).toBeNull()
    expect(
      runtime.getSnapshot().events.some((event) => event.type === 'QA_PASSED'),
    ).toBe(false)
    dispose()
  })

  it('rejects another Manager attempting to coordinate owned QA or repairs', async () => {
    const { runtime, manager, engine, document, planner, dispose } =
      await setup()
    document.text = 'Incomplete'
    await engine.run('qa', 'verifier')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    const other = new ManagerOrchestrator({
      runtime,
      managerId: 'other-manager',
      planner,
    })
    const before = runtime.getSnapshot()
    expect(
      other.requestQA({
        taskId: 'source',
        scope: 'Document',
        checks: [check],
        repairCapabilities: ['writing'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_OWNERSHIP' } })
    expect(other.assignRepair(repair.repairId).ok).toBe(false)
    expect(other.startRepair(repair.repairId).ok).toBe(false)
    expect(other.recheckQA('qa').ok).toBe(false)
    expect(runtime.getSnapshot()).toBe(before)
    expect(manager.getContext().repairs).toHaveLength(1)
    expect(other.getContext().qaRequests).toEqual([])
    expect(other.getContext().repairs).toEqual([])
    dispose()
  })

  it('preserves a cancelled QA as attention and emits no completion', async () => {
    const { runtime, manager, dispose } = await setup()
    send(runtime, {
      type: 'cancelQA',
      qaId: 'qa',
      reason: 'Required verification unavailable',
    })
    expect(manager.getContext().plan?.issues).toContainEqual(
      expect.objectContaining({ code: 'QA_CANCELLED' }),
    )
    expect(manager.getContext().result?.verifiedTaskIds).toEqual([])
    expect(manager.getContext().manager?.status).toBe('working')
    dispose()
  })

  it('rejects generic task start while selected prerequisite QA is pending', async () => {
    const { runtime, manager, dispose } = await setup({ dependencies: true })
    send(runtime, {
      type: 'assignTask',
      taskId: 'dependent',
      agentId: 'repairer',
    })
    const before = runtime.getSnapshot()
    expect(
      runtime.dispatch({ type: 'startTask', taskId: 'dependent' }),
    ).toMatchObject({ ok: false, error: { code: 'DEPENDENCIES_NOT_READY' } })
    expect(
      runtime.dispatch({ type: 'completeTask', taskId: 'source' }).ok,
    ).toBe(false)
    expect(runtime.getSnapshot()).toBe(before)
    expect(manager.getContext().plan?.status).toBe('executing')
    expect(runtime.getSnapshot().tasks.source.verification?.status).toBe(
      'pending',
    )
    dispose()
  })

  it('cannot reopen cancelled workflows through recheck or direct repair commands', async () => {
    const { runtime, manager, engine, document, dispose } = await setup()
    document.text = 'Incomplete'
    await engine.run('qa', 'verifier')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    expect(manager.cancelRequest('request', 'Stop workflow').ok).toBe(true)
    const before = runtime.getSnapshot()
    for (const command of [
      { type: 'recheckQA', qaId: 'qa' },
      { type: 'assignRepair', repairId: repair.repairId },
      { type: 'startRepair', repairId: repair.repairId },
      { type: 'requestRepair', qaId: 'qa' },
    ] as const)
      expect(runtime.dispatch(command)).toMatchObject({
        ok: false,
        error: { code: 'QA_WORKFLOW_CLOSED' },
      })
    expect(runtime.getSnapshot()).toBe(before)
    dispose()
  })

  it('rejects nested repair QA and capability bypass through generic assignment', async () => {
    const { runtime, engine, document, dispose } = await setup()
    document.text = 'Incomplete'
    await engine.run('qa', 'verifier')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    const before = runtime.getSnapshot()
    for (const agentId of ['manager', 'verifier'])
      expect(
        runtime.dispatch({
          type: 'assignTask',
          taskId: repair.taskId,
          agentId,
        }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_REPAIR_AGENT' } })
    expect(
      runtime.dispatch({
        type: 'requestQA',
        request: {
          taskId: repair.taskId,
          requestedBy: 'manager',
          scope: 'Nested repair',
          checks: [check],
          repairCapabilities: ['writing'],
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'NESTED_QA' } })
    expect(runtime.getSnapshot()).toBe(before)
    dispose()
  })

  it('rejects QA on the Manager control task so workflow completion cannot bypass configured checks', async () => {
    const { runtime, manager, dispose } = await setup()
    const before = runtime.getSnapshot()
    const taskId = manager.getContext().request!.coordinationTaskId!
    expect(
      runtime.dispatch({
        type: 'requestQA',
        request: {
          taskId,
          requestedBy: 'manager',
          scope: 'Manager coordination',
          checks: [check],
          repairCapabilities: ['writing'],
        },
      }).ok,
    ).toBe(false)
    expect(runtime.getSnapshot()).toBe(before)
    dispose()
  })
})
