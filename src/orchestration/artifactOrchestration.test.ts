// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryArtifactStorage } from '../artifacts/ArtifactStorage'
import type {
  ArtifactContentReference,
  ArtifactExpectation,
  ArtifactScope,
} from '../artifacts/artifactTypes'
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

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return runtime.getSnapshot()
}

const check: QACheck = {
  checkId: 'acceptance',
  title: 'Required acceptance section',
  type: 'requirement-compliance',
  required: true,
  severity: 'error',
  toolId: 'inspect.artifact',
  input: {},
  assertion: { kind: 'includes', path: ['text'], value: 'Acceptance' },
}

async function setup(options: { count?: number; dependent?: boolean } = {}) {
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    now: () => '2026-10-11T12:00:00.000Z',
  })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'test', name: 'Test' },
  })
  for (const [id, kind, capabilities] of [
    ['manager', 'manager', ['coordination']],
    ['author', 'standard-worker', ['writing']],
    ['verifier', 'standard-worker', ['qa']],
    ['followup', 'standard-worker', ['writing']],
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
  const expectedOutputs: readonly ArtifactExpectation[] = [
    { role: 'deliverable', type: 'report', count: options.count ?? 1 },
  ]
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: 'manager',
    planner: new DeterministicPlanner((request) => ({
      planId: 'plan',
      requestId: request.requestId,
      objective: request.description,
      constraints: [],
      expectedOutputs: ['Descriptive text does not prove output'],
      tasks: [
        {
          id: 'source',
          title: 'Report',
          description: 'Produce a report',
          priority: 'normal',
          status: 'queued',
          dependencyIds: [],
          requiredCapabilities: ['writing'],
          preferredAgentId: 'author',
          expectedOutputs,
        },
        ...(options.dependent
          ? [
              {
                id: 'dependent',
                title: 'Follow-up',
                description: 'Use verified report',
                priority: 'normal',
                status: 'queued',
                dependencyIds: ['source'],
                requiredCapabilities: ['writing'],
                preferredAgentId: 'followup',
              },
            ]
          : []),
      ],
    })),
  })
  manager.start()
  expect(
    manager.receiveRequest({
      requestId: 'request',
      title: 'Inspect outputs',
      description: 'Explicit local output workflow',
      requestedBy: 'test operator',
      priority: 'normal',
      constraints: [],
    }).ok,
  ).toBe(true)
  expect((await manager.planRequest('request')).ok).toBe(true)
  expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual(['source'])

  const registry = new ToolRegistry()
  registry.register({
    id: 'inspect.artifact',
    name: 'Inspect immutable test artifact',
    description: 'Read the exact version selected by QA',
    category: 'validation',
    capabilities: ['qa'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 1000,
    metadata: {},
    inputSchema: {
      description: 'Bound artifact input',
      parse: (value) => value as RuntimeJson,
    },
    outputSchema: {
      description: 'Actual text and integrity identity',
      parse: (value) => value as RuntimeJson,
    },
    summarizeInput: () => ({}),
    execute: async (input, context) => {
      const binding = (
        input as {
          artifact: { artifactId: string; version: number; sha256: string }
        }
      ).artifact
      if (
        !runtime.canAccessArtifact(context.agentId, binding.artifactId, 'read')
      )
        throw new Error('Artifact read denied')
      const artifact = runtime.getSnapshot().artifacts[binding.artifactId]
      return {
        artifact: {
          artifactId: artifact.artifactId,
          version: artifact.version,
          sha256: artifact.content.sha256,
        },
        text: new TextDecoder().decode(await storage.read(artifact.content)),
      }
    },
  })
  const executor = new ToolExecutor({
    runtime,
    registry,
    grants: {
      verifier: { toolIds: ['inspect.artifact'], permissions: ['read'] },
    },
  })
  disposals.push(() => {
    manager.dispose()
    executor.dispose()
  })
  const qa = new QAEngine({ runtime, executor })
  async function create(
    id: string,
    text = 'Acceptance',
    scope: ArtifactScope = { kind: 'task', id: 'source' },
  ) {
    const content = await storage.put(
      new TextEncoder().encode(text),
      'text/plain',
    )
    return send(runtime, {
      type: 'createArtifact',
      agentId: 'author',
      artifact: {
        artifactId: id,
        name: 'Report output',
        description: 'Explicit test output',
        type: 'report',
        role: 'output',
        outputRole: 'deliverable',
        taskId: 'source',
        scope,
        status: 'completed',
        source: { kind: 'task', taskId: 'source' },
        content,
      },
    }).artifacts[id]
  }
  function request(artifactId: string, qaId = `qa-${artifactId}`) {
    const result = manager.requestQA({
      qaId,
      taskId: 'source',
      artifactId,
      scope: 'Required acceptance section in exact version',
      checks: [check],
      repairCapabilities: ['writing'],
      maxRepairAttempts: 1,
    })
    if (!result.ok)
      throw new Error(`${result.error.code}: ${result.error.message}`)
    return qaId
  }
  return { runtime, manager, storage, create, request, qa, executor }
}

describe('Manager artifact output coordination', () => {
  it('retains structured expectations and blocks both planned and direct dependent starts for missing outputs', async () => {
    const { runtime, manager } = await setup({ dependent: true })
    expect(runtime.getSnapshot().tasks.source.expectedOutputs).toEqual([
      { role: 'deliverable', type: 'report', count: 1 },
    ])
    send(runtime, { type: 'completeTask', taskId: 'source' })
    expect(manager.getContext().plan).toMatchObject({
      status: 'needs_attention',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_OUTPUT', taskId: 'source' }),
      ]),
    })
    expect(manager.getContext().manager?.status).toBe('working')
    expect(manager.getContext().result?.completedTaskIds).toEqual(['source'])
    expect(manager.getContext().result?.artifacts).toEqual([])
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('waiting')
    expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual([])
    send(runtime, {
      type: 'assignTask',
      taskId: 'dependent',
      agentId: 'followup',
    })
    const before = runtime.getSnapshot()
    expect(
      runtime.dispatch({ type: 'startTask', taskId: 'dependent' }),
    ).toMatchObject({ ok: false, error: { code: 'DEPENDENCIES_NOT_READY' } })
    expect(runtime.getSnapshot()).toBe(before)
  })

  it('observes artifact events, keeps completed output unverified and releases dependents only after actual QA', async () => {
    const { runtime, manager, create, request, qa } = await setup({
      dependent: true,
    })
    send(runtime, { type: 'completeTask', taskId: 'source' })
    const before = manager.getMetrics().monitorPasses
    const artifact = await create('report')
    expect(manager.getMetrics().monitorPasses).toBeGreaterThan(before)
    expect(manager.getContext().plan?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OUTPUT_UNVERIFIED' }),
      ]),
    )
    expect(
      manager
        .getContext()
        .plan?.issues.some((issue) => issue.code === 'MISSING_OUTPUT'),
    ).toBe(false)
    expect(manager.getContext().artifacts).toEqual([artifact])
    expect(manager.getContext().result?.artifacts).toEqual([])
    expect((await qa.run(request('report'), 'verifier')).status).toBe('passed')
    expect(runtime.getSnapshot().tasks.dependent.status).toBe('queued')
    expect(manager.getContext().plan?.status).toBe('executing')
    expect(manager.getContext().result?.artifacts).toEqual([
      runtime.getSnapshot().artifacts.report,
    ])
    expect(manager.dispatchReady('request').dispatchedTaskIds).toEqual([
      'dependent',
    ])
    send(runtime, { type: 'completeTask', taskId: 'dependent' })
    expect(manager.getContext().plan?.status).toBe('completed')
    expect(manager.getContext().result?.artifacts[0].verifiedByQA).toBe(
      'qa-report',
    )
  })

  it('requires both independently produced artifacts to pass before returning the completed plan', async () => {
    const { runtime, manager, create, request, qa } = await setup({ count: 2 })
    await create('a')
    await create('b')
    request('a')
    request('b')
    send(runtime, { type: 'completeTask', taskId: 'source' })
    expect((await qa.run('qa-a', 'verifier')).status).toBe('passed')
    expect(manager.getContext().plan?.status).not.toBe('completed')
    expect(
      manager
        .getContext()
        .result?.artifacts.map((artifact) => artifact.artifactId),
    ).toEqual(['a'])
    expect((await qa.run('qa-b', 'verifier')).status).toBe('passed')
    expect(manager.getContext().plan?.status).toBe('completed')
    expect(
      manager
        .getContext()
        .result?.artifacts.map((artifact) => artifact.artifactId),
    ).toEqual(['a', 'b'])
    expect(manager.getContext().qaRequests).toHaveLength(2)
  })

  it('does not count two versions of one lineage as two required outputs', async () => {
    const { runtime, manager, storage, create } = await setup({ count: 2 })
    const original = await create('v1')
    send(runtime, {
      type: 'versionArtifact',
      agentId: 'author',
      artifactId: original.artifactId,
      expectedRevision: original.revision,
      replacement: {
        artifactId: 'v2',
        source: { kind: 'task', taskId: 'source' },
        content: await storage.put(
          new TextEncoder().encode('Acceptance revised'),
          'text/plain',
        ),
      },
    })
    send(runtime, { type: 'completeTask', taskId: 'source' })
    expect(manager.getContext().artifacts).toHaveLength(2)
    expect(manager.getContext().plan?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_OUTPUT' }),
      ]),
    )
    expect(runtime.getSnapshot().artifacts.v1.status).toBe('superseded')
    expect(runtime.getSnapshot().artifacts.v2.version).toBe(2)
  })

  it('does not expose a worker-private artifact through Manager context or result', async () => {
    const { runtime, manager, create } = await setup()
    const artifact = await create('private', 'Acceptance private report', {
      kind: 'agent',
      id: 'author',
    })
    send(runtime, { type: 'completeTask', taskId: 'source' })
    expect(runtime.canAccessArtifact('manager', 'private', 'read')).toBe(false)
    expect(manager.getContext().artifacts).toEqual([])
    expect(manager.getContext().result?.artifacts).toEqual([])
    expect(JSON.stringify(manager.getContext())).not.toContain(
      artifact.content.contentId,
    )
    expect(
      runtime
        .getSnapshot()
        .events.some((event) => event.changes.artifacts?.private),
    ).toBe(true)
    expect(
      manager.requestQA({
        qaId: 'private-qa',
        taskId: 'source',
        artifactId: 'private',
        scope: 'Private output',
        checks: [check],
        repairCapabilities: ['writing'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'ARTIFACT_ACCESS_DENIED' } })
  })

  it('omits source-tool receipts after their artifact is classified private without erasing runtime history', async () => {
    const { runtime, manager, storage } = await setup()
    const registry = new ToolRegistry()
    registry.register({
      id: 'write.private-report',
      name: 'Write test report',
      description: 'Writes actual immutable content for the explicit test',
      category: 'data',
      capabilities: ['writing'],
      permissions: ['write'],
      allowedKinds: ['standard-worker'],
      timeoutMs: 1000,
      metadata: {},
      inputSchema: {
        description: 'Empty input',
        parse: (value) => value as RuntimeJson,
      },
      outputSchema: {
        description: 'Stored content receipt',
        parse: (value) => value as RuntimeJson,
      },
      summarizeInput: () => ({}),
      execute: async () => ({
        content: {
          ...(await storage.put(
            new TextEncoder().encode('Acceptance private tool output'),
            'text/plain',
          )),
        },
      }),
    })
    const writer = new ToolExecutor({
      runtime,
      registry,
      grants: {
        author: { toolIds: ['write.private-report'], permissions: ['write'] },
      },
    })
    disposals.push(() => writer.dispose())
    const execution = await writer.execute({
      executionId: 'private-source',
      agentId: 'author',
      taskId: 'source',
      toolId: 'write.private-report',
      input: {},
    })
    expect(execution.status).toBe('completed')
    const content = (
      execution.output as unknown as { content: ArtifactContentReference }
    ).content
    // Existing task/tool visibility precedes artifact classification; this does not revoke earlier observations.
    expect(JSON.stringify(manager.getContext())).toContain(content.contentId)
    const receiptEvent = runtime
      .getSnapshot()
      .events.find(
        (event) =>
          event.changes.toolExecutions?.['private-source']?.status ===
          'completed',
      )!
    send(runtime, {
      type: 'createArtifact',
      agentId: 'author',
      artifact: {
        artifactId: 'private-tool-output',
        name: 'Private output',
        description: 'Explicitly private task output',
        type: 'report',
        role: 'output',
        outputRole: 'deliverable',
        taskId: 'source',
        scope: { kind: 'agent', id: 'author' },
        status: 'completed',
        source: { kind: 'tool', executionId: execution.executionId },
        content,
      },
    })
    expect(manager.getContext().artifacts).toEqual([])
    expect(JSON.stringify(manager.getContext())).not.toContain(
      content.contentId,
    )
    expect(manager.getContext().events).not.toContain(receiptEvent)
    expect(runtime.getSnapshot().events).toContain(receiptEvent)
    expect(runtime.getSnapshot().toolExecutions['private-source']).toEqual(
      execution,
    )
  })

  it('coordinates a canonical repair and returns only its verified new version while retaining the failed version', async () => {
    const { runtime, manager, storage, create, request, qa } = await setup()
    await create('v1', 'Incomplete draft')
    request('v1', 'first')
    send(runtime, { type: 'completeTask', taskId: 'source' })
    expect((await qa.run('first', 'verifier')).status).toBe('failed')
    const repair = Object.values(runtime.getSnapshot().repairRequests)[0]
    expect(manager.assignRepair(repair.repairId, 'author').ok).toBe(true)
    expect(manager.startRepair(repair.repairId).ok).toBe(true)
    const previous = runtime.getSnapshot().artifacts.v1
    send(runtime, {
      type: 'versionArtifact',
      agentId: 'author',
      artifactId: 'v1',
      expectedRevision: previous.revision,
      replacement: {
        artifactId: 'v2',
        source: { kind: 'task', taskId: repair.taskId },
        content: await storage.put(
          new TextEncoder().encode('Acceptance repaired'),
          'text/plain',
        ),
      },
    })
    send(runtime, { type: 'completeTask', taskId: repair.taskId })
    expect(manager.recheckQA('first', 'second', 'v2').ok).toBe(true)
    expect((await qa.run('second', 'verifier')).status).toBe('passed')
    expect(manager.getContext().plan?.status).toBe('completed')
    expect(
      manager.getContext().artifacts.map((artifact) => artifact.artifactId),
    ).toEqual(['v1', 'v2'])
    expect(
      manager
        .getContext()
        .result?.artifacts.map((artifact) => artifact.artifactId),
    ).toEqual(['v2'])
    expect(runtime.getSnapshot().qaRequests.first.status).toBe('failed')
    expect(runtime.getSnapshot().qaRequests.second.previousQaId).toBe('first')
    expect(runtime.getSnapshot().artifacts.v2.source.taskId).toBe(repair.taskId)
  })
})
