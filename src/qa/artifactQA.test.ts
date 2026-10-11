// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryArtifactStorage,
  hashArtifactBytes,
} from '../artifacts/ArtifactStorage'
import {
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import { ToolFault, type Tool } from '../tools/toolTypes'
import { jsonOutputSchema } from '../tools/toolValidation'
import { QAEngine } from './QAEngine'
import { isTaskReadyForDependents } from './qaSelectors'
import type { QARequestInput } from './qaTypes'

const executors: ToolExecutor[] = []
afterEach(() => executors.splice(0).forEach((executor) => executor.dispose()))
function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}
function reject(
  runtime: OfficeRuntime,
  command: RuntimeCommand,
  code?: string,
) {
  const before = runtime.getSnapshot()
  const result = runtime.dispatch(command)
  expect(result.ok).toBe(false)
  if (!result.ok && code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(before)
}
async function setup(count = 1, granted = true, privateManagerAccess = false) {
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    artifactPolicy: {
      grants: privateManagerAccess
        ? [
            {
              agentId: 'manager',
              scope: { kind: 'agent', id: 'worker' },
              permissions: ['read'],
            },
          ]
        : [],
    },
  })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'quality', name: 'Quality test' },
  })
  for (const id of ['manager', 'worker', 'verifier'])
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: id,
        departmentId: 'quality',
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        ...(id === 'manager' ? {} : { managerId: 'manager' }),
        capabilities:
          id === 'verifier' ? ['qa', 'artifact.inspect'] : ['document'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  send(runtime, {
    type: 'createTask',
    task: {
      id: 'source',
      title: 'Document output test',
      description: 'An explicit isolated artifact test.',
      expectedOutputs: [{ role: 'report', type: 'report', count }],
    },
  })
  send(runtime, { type: 'assignTask', taskId: 'source', agentId: 'worker' })
  send(runtime, { type: 'startTask', taskId: 'source' })
  send(runtime, { type: 'completeTask', taskId: 'source' })
  const execute = vi.fn(
    async (input: unknown, context: { agentId: string }) => {
      const binding = (input as { artifact: { artifactId: string } }).artifact
      const artifact = runtime.getSnapshot().artifacts[binding.artifactId]
      if (
        !artifact ||
        !runtime.canAccessArtifact(context.agentId, artifact.artifactId, 'read')
      )
        throw new ToolFault(
          'ARTIFACT_ACCESS_DENIED',
          'Inspection access denied.',
        )
      const bytes = await storage.read(artifact.content)
      return {
        artifact: {
          artifactId: artifact.artifactId,
          version: artifact.version,
          sha256: await hashArtifactBytes(bytes),
        },
        content: new TextDecoder().decode(bytes),
      }
    },
  )
  const tool: Tool = {
    id: 'artifact.inspect',
    name: 'Immutable fixture inspection',
    description: 'Read the exact immutable development content.',
    category: 'validation',
    capabilities: ['artifact.inspect'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 1000,
    metadata: {},
    inputSchema: jsonOutputSchema,
    outputSchema: jsonOutputSchema,
    summarizeInput: () => ({ fixture: true }),
    execute,
  }
  const registry = new ToolRegistry()
  registry.register(tool)
  const executor = new ToolExecutor({
    runtime,
    registry,
    grants: {
      verifier: { toolIds: granted ? [tool.id] : [], permissions: ['read'] },
    },
  })
  executors.push(executor)
  const engine = new QAEngine({ runtime, executor })
  async function artifact(
    id: string,
    content = 'Acceptance',
    scope: 'task' | 'agent' = 'task',
  ) {
    const reference = await storage.put(
      new TextEncoder().encode(content),
      'text/plain',
    )
    send(runtime, {
      type: 'createArtifact',
      agentId: 'worker',
      artifact: {
        artifactId: id,
        name: id,
        description: 'A synthetic document fixture.',
        type: 'report',
        role: 'output',
        outputRole: 'report',
        taskId: 'source',
        status: 'completed',
        scope: { kind: scope, id: scope === 'task' ? 'source' : 'worker' },
        source: { kind: 'task', taskId: 'source' },
        content: reference,
      },
    })
    return runtime.getSnapshot().artifacts[id]
  }
  function request(id: string, artifactId?: string): QARequestInput {
    return {
      qaId: id,
      taskId: 'source',
      requestedBy: 'manager',
      scope: 'Required acceptance section',
      ...(artifactId ? { artifactId } : {}),
      repairCapabilities: ['document'],
      maxRepairAttempts: 1,
      checks: [
        {
          checkId: 'acceptance',
          title: 'Acceptance section',
          type: 'requirement-compliance',
          required: true,
          severity: 'error',
          toolId: tool.id,
          input: {},
          assertion: {
            kind: 'includes',
            path: ['content'],
            value: 'Acceptance',
          },
        },
      ],
    }
  }
  async function repaired(
    qaId: string,
    originalId: string,
    replacementId: string,
    agentId = 'worker',
    content = 'Acceptance: repaired',
  ) {
    const repair = Object.values(runtime.getSnapshot().repairRequests).find(
      (item) => item.sourceQaId === qaId,
    )!
    send(runtime, {
      type: 'assignRepair',
      repairId: repair.repairId,
      agentId,
    })
    send(runtime, { type: 'startRepair', repairId: repair.repairId })
    const original = runtime.getSnapshot().artifacts[originalId]
    const reference = await storage.put(
      new TextEncoder().encode(content),
      'text/plain',
    )
    send(runtime, {
      type: 'versionArtifact',
      agentId,
      artifactId: originalId,
      expectedRevision: original.revision,
      replacement: {
        artifactId: replacementId,
        source: { kind: 'task', taskId: repair.taskId },
        content: reference,
      },
    })
    send(runtime, { type: 'completeTask', taskId: repair.taskId })
    return repair
  }
  return {
    runtime,
    storage,
    engine,
    executor,
    execute,
    artifact,
    request,
    repaired,
  }
}

describe('artifact QA through canonical runtime, tools and immutable storage', () => {
  it('rejects unknown and private targets without writes or successful events', async () => {
    const s = await setup()
    reject(
      s.runtime,
      { type: 'requestQA', request: s.request('unknown-qa', 'missing') },
      'ARTIFACT_NOT_FOUND',
    )
    await s.artifact('private', 'Acceptance', 'agent')
    reject(
      s.runtime,
      { type: 'requestQA', request: s.request('private-qa', 'private') },
      'ARTIFACT_ACCESS_DENIED',
    )
  })

  it('verifies the exact stored bytes/version and records real QA and artifact events', async () => {
    const s = await setup()
    const artifact = await s.artifact('report')
    expect(artifact.status).toBe('completed')
    expect(artifact.verifiedByQA).toBeNull()
    expect(
      s.runtime.canAccessArtifact('verifier', artifact.artifactId, 'read'),
    ).toBe(false)
    const requested = s.engine.request(
      s.request('inspect', artifact.artifactId),
    )
    expect(requested.artifactBinding).toEqual({
      artifactId: 'report',
      version: 1,
      sha256: artifact.content.sha256,
    })
    const qa = await s.engine.run(requested.qaId, 'verifier')
    const state = s.runtime.getSnapshot()
    expect(qa.status).toBe('passed')
    expect(state.artifacts.report).toMatchObject({
      status: 'verified',
      verifiedByQA: qa.qaId,
      source: artifact.source,
    })
    expect(state.tasks.source.status).toBe('completed')
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(true)
    expect(state.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'TOOL_COMPLETED',
        'ARTIFACT_VERIFIED',
        'QA_PASSED',
      ]),
    )
    const verifiedEvent = state.events.find(
      (event) => event.type === 'ARTIFACT_VERIFIED',
    )!
    expect(
      state.activities.some(
        (activity) => activity.eventId === verifiedEvent.id,
      ),
    ).toBe(true)
    expect(
      s.runtime.canAccessArtifact('verifier', artifact.artifactId, 'read'),
    ).toBe(false)
    expect(s.execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a forged target under an allocated QA execution ID before the adapter runs', async () => {
    const s = await setup()
    await s.artifact('report')
    s.engine.request(s.request('inspect', 'report'))
    send(s.runtime, {
      type: 'startQA',
      qaId: 'inspect',
      verifierAgentId: 'verifier',
    })
    const qa = s.runtime.getSnapshot().qaRequests.inspect
    const before = s.runtime.getSnapshot()
    await expect(
      s.executor.execute({
        executionId: qa.executionIds.acceptance,
        taskId: qa.inspectionTaskId!,
        agentId: 'verifier',
        toolId: 'artifact.inspect',
        input: { artifact: { ...qa.artifactBinding!, sha256: 'b'.repeat(64) } },
      }),
    ).rejects.toMatchObject({ code: 'QA_EXECUTION_CONFLICT' })
    expect(s.runtime.getSnapshot()).toBe(before)
    expect(s.execute).not.toHaveBeenCalled()
  })

  it('keeps distinct outputs independent and blocks aggregate task readiness until all pass', async () => {
    const s = await setup(2)
    await s.artifact('first')
    await s.artifact('second')
    s.engine.request(s.request('first-qa', 'first'))
    s.engine.request(s.request('second-qa', 'second'))
    await s.engine.run('first-qa', 'verifier')
    let state = s.runtime.getSnapshot()
    expect(state.artifacts.first.status).toBe('verified')
    expect(state.artifacts.second.status).toBe('completed')
    expect(state.tasks.source.verification?.status).toBe('pending')
    expect(state.agents.worker.status).toBe('waiting')
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(false)
    await s.engine.run('second-qa', 'verifier')
    state = s.runtime.getSnapshot()
    expect(state.artifacts.second.verifiedByQA).toBe('second-qa')
    expect(state.artifacts.first.verifiedByQA).toBe('first-qa')
    expect(state.tasks.source.verification?.status).toBe('verified')
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(true)
  })

  it('does not hide a failed output when a different output passes later', async () => {
    const s = await setup(2)
    await s.artifact('bad', 'Incomplete')
    await s.artifact('good')
    s.engine.request(s.request('bad-qa', 'bad'))
    s.engine.request(s.request('good-qa', 'good'))
    await s.engine.run('bad-qa', 'verifier')
    await s.engine.run('good-qa', 'verifier')
    const state = s.runtime.getSnapshot()
    expect(state.artifacts.good.status).toBe('verified')
    expect(state.artifacts.bad.status).toBe('failed')
    expect(state.tasks.source.verification).toMatchObject({
      status: 'failed',
      qaId: 'bad-qa',
      needsAttention: true,
    })
    expect(state.agents.worker.status).toBe('blocked')
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(false)
  })

  it('preserves v1/failure/repair and verifies only new repaired bytes in the recheck', async () => {
    const s = await setup()
    const first = await s.artifact('v1', 'Incomplete')
    s.engine.request(s.request('initial', 'v1'))
    const failure = await s.engine.run('initial', 'verifier')
    reject(
      s.runtime,
      { type: 'recheckQA', qaId: 'initial', newQaId: 'premature' },
      'REPAIR_NOT_COMPLETED',
    )
    const repair = await s.repaired('initial', 'v1', 'v2')
    reject(s.runtime, {
      type: 'recheckQA',
      qaId: 'initial',
      newQaId: 'old-content',
    })
    send(s.runtime, {
      type: 'recheckQA',
      qaId: 'initial',
      newQaId: 'recheck',
      replacementArtifactId: 'v2',
    })
    const second = await s.engine.run('recheck', 'verifier')
    const state = s.runtime.getSnapshot()
    expect(second.status).toBe('passed')
    expect(second).toMatchObject({
      rootQaId: 'initial',
      previousQaId: 'initial',
      repairId: repair.repairId,
      attempt: 1,
      artifactId: 'v2',
    })
    expect(second.checks).toEqual(failure.checks)
    expect(state.qaRequests.initial).toBe(failure)
    expect(state.artifacts.v1).toMatchObject({
      status: 'superseded',
      version: 1,
      source: first.source,
      content: first.content,
      verifiedByQA: null,
    })
    expect(state.artifacts.v2).toMatchObject({
      status: 'verified',
      version: 2,
      supersedesArtifactId: 'v1',
      verifiedByQA: 'recheck',
      source: { taskId: repair.taskId },
    })
    expect(second.artifactBinding?.sha256).not.toBe(
      failure.artifactBinding?.sha256,
    )
    expect(second.result?.artifactBinding).toEqual(second.artifactBinding)
    expect(state.tasks.source.outputArtifactIds).toEqual(['v1', 'v2'])
  })

  it('cannot use an unrelated version to satisfy a repair recheck or reset its policy', async () => {
    const s = await setup(2)
    await s.artifact('broken', 'Incomplete')
    await s.artifact('unrelated')
    s.engine.request(s.request('initial', 'broken'))
    await s.engine.run('initial', 'verifier')
    await s.repaired('initial', 'broken', 'fixed')
    reject(
      s.runtime,
      {
        type: 'recheckQA',
        qaId: 'initial',
        replacementArtifactId: 'unrelated',
      },
      'ARTIFACT_RECHECK_CONFLICT',
    )
    reject(
      s.runtime,
      { type: 'requestQA', request: s.request('reset-policy', 'fixed') },
      'QA_ALREADY_CONFIGURED',
    )
  })

  it('retains bounded repair attempts across artifact versions', async () => {
    const s = await setup()
    await s.artifact('v1', 'Incomplete')
    s.engine.request({ ...s.request('initial', 'v1'), maxRepairAttempts: 0 })
    await s.engine.run('initial', 'verifier')
    const state = s.runtime.getSnapshot()
    expect(state.repairRequests).toEqual({})
    expect(
      state.events.some((event) => event.type === 'REPAIR_EXHAUSTED'),
    ).toBe(true)
    expect(state.artifacts.v1.status).toBe('failed')
    reject(
      s.runtime,
      { type: 'recheckQA', qaId: 'initial' },
      'REPAIR_NOT_COMPLETED',
    )
  })

  it.each(['agent', 'task'] as const)(
    'preserves ancestry when different repair workers revise a %s-scoped output',
    async (scope) => {
      const s = await setup(1, true, scope === 'agent')
      for (const id of ['repair-b', 'repair-c'])
        send(s.runtime, {
          type: 'registerAgent',
          agent: {
            id,
            name: id,
            role: 'Repair fixture',
            departmentId: 'quality',
            kind: 'standard-worker',
            managerId: 'manager',
            capabilities: ['document'],
            position: [0, 0, 0],
            headingRadians: 0,
          },
        })
      const first = await s.artifact('v1', 'Incomplete', scope)
      s.engine.request({ ...s.request('qa-v1', 'v1'), maxRepairAttempts: 2 })
      const firstFailure = await s.engine.run('qa-v1', 'verifier')
      expect(s.runtime.canAccessArtifact('repair-b', 'v1', 'read')).toBe(false)
      const firstRepair = await s.repaired(
        'qa-v1',
        'v1',
        'v2',
        'repair-b',
        'Still incomplete',
      )
      send(s.runtime, {
        type: 'recheckQA',
        qaId: 'qa-v1',
        newQaId: 'qa-v2',
        replacementArtifactId: 'v2',
      })
      const secondFailure = await s.engine.run('qa-v2', 'verifier')
      expect(secondFailure.status).toBe('failed')
      expect(s.runtime.canAccessArtifact('repair-c', 'v1', 'read')).toBe(false)
      expect(s.runtime.canAccessArtifact('repair-c', 'v2', 'read')).toBe(false)
      const secondRepair = await s.repaired('qa-v2', 'v2', 'v3', 'repair-c')
      send(s.runtime, {
        type: 'recheckQA',
        qaId: 'qa-v2',
        newQaId: 'qa-v3',
        replacementArtifactId: 'v3',
      })
      const passed = await s.engine.run('qa-v3', 'verifier')
      const state = s.runtime.getSnapshot()
      expect(passed.status).toBe('passed')
      expect(passed.attempt).toBe(2)
      expect(state.artifacts.v1).toMatchObject({
        version: 1,
        source: first.source,
        content: first.content,
        supersededByArtifactId: 'v2',
      })
      expect(state.artifacts.v2).toMatchObject({
        version: 2,
        agentId: 'repair-b',
        source: { taskId: firstRepair.taskId },
        supersededByArtifactId: 'v3',
      })
      expect(state.artifacts.v3).toMatchObject({
        version: 3,
        agentId: 'repair-c',
        status: 'verified',
        source: { taskId: secondRepair.taskId },
        derivedFromArtifactIds: ['v2'],
      })
      const retainedParent =
        state.artifacts[state.artifacts.v3.supersedesArtifactId!]
      const retainedRoot = state.artifacts[retainedParent.supersedesArtifactId!]
      expect(retainedParent.artifactId).toBe('v2')
      expect(retainedParent.derivedFromArtifactIds).toEqual(['v1'])
      expect(retainedRoot).toMatchObject({
        artifactId: 'v1',
        source: first.source,
        content: first.content,
      })
      expect(state.qaRequests['qa-v1']).toBe(firstFailure)
      expect(state.qaRequests['qa-v2']).toBe(secondFailure)
      expect(s.runtime.canAccessArtifact('repair-c', 'v1', 'read')).toBe(false)
      expect(s.runtime.canAccessArtifact('repair-c', 'v2', 'archive')).toBe(
        false,
      )
      expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(true)
    },
  )

  it('requires fresh QA after a normally revised verified version without inventing repair', async () => {
    const s = await setup()
    await s.artifact('v1')
    s.engine.request(s.request('first-inspection', 'v1'))
    const initial = await s.engine.run('first-inspection', 'verifier')
    reject(
      s.runtime,
      { type: 'recheckQA', qaId: initial.qaId, replacementArtifactId: 'v1' },
      'INVALID_QA_ARTIFACT',
    )
    const first = s.runtime.getSnapshot().artifacts.v1
    send(s.runtime, {
      type: 'versionArtifact',
      agentId: 'worker',
      artifactId: 'v1',
      expectedRevision: first.revision,
      replacement: {
        artifactId: 'v2',
        source: { kind: 'task', taskId: 'source' },
        content: await s.storage.put(
          new TextEncoder().encode('Acceptance: revised'),
          'text/plain',
        ),
      },
    })
    let state = s.runtime.getSnapshot()
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(false)
    expect(state.tasks.source.verification?.status).toBe('pending')
    expect(state.agents.worker.status).toBe('waiting')
    expect(state.artifacts.v2.verifiedByQA).toBeNull()
    expect(state.artifacts.v1.verifiedByQA).toBe(initial.qaId)
    expect(state.qaRequests[initial.qaId]).toBe(initial)
    send(s.runtime, {
      type: 'recheckQA',
      qaId: initial.qaId,
      newQaId: 'revised-inspection',
      replacementArtifactId: 'v2',
    })
    const recheck = await s.engine.run('revised-inspection', 'verifier')
    expect(recheck.status).toBe('passed')
    expect(recheck.attempt).toBe(0)
    state = s.runtime.getSnapshot()
    expect(state.repairRequests).toEqual({})
    expect(state.artifacts.v2.verifiedByQA).toBe(recheck.qaId)
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(true)
  })

  it('does not reuse historical verification after archiving the required output', async () => {
    const s = await setup()
    await s.artifact('report')
    s.engine.request(s.request('inspect', 'report'))
    const qa = await s.engine.run('inspect', 'verifier')
    const artifact = s.runtime.getSnapshot().artifacts.report
    send(s.runtime, {
      type: 'archiveArtifact',
      artifactId: 'report',
      agentId: 'worker',
      expectedRevision: artifact.revision,
    })
    const state = s.runtime.getSnapshot()
    expect(state.qaRequests.inspect).toBe(qa)
    expect(state.artifacts.report.status).toBe('archived')
    expect(state.tasks.source.verification?.status).toBe('blocked')
    expect(state.agents.worker.status).toBe('blocked')
    expect(isTaskReadyForDependents(state.tasks.source, state)).toBe(false)
    reject(
      s.runtime,
      { type: 'recheckQA', qaId: 'inspect', replacementArtifactId: 'report' },
      'INVALID_QA_ARTIFACT',
    )
  })

  it('forbids version replacement or archiving while selected inspection is pending', async () => {
    const s = await setup()
    const artifact = await s.artifact('report')
    s.engine.request(s.request('inspect', 'report'))
    reject(
      s.runtime,
      {
        type: 'archiveArtifact',
        agentId: 'worker',
        artifactId: 'report',
        expectedRevision: artifact.revision,
      },
      'ARTIFACT_QA_ACTIVE',
    )
    reject(
      s.runtime,
      {
        type: 'versionArtifact',
        agentId: 'worker',
        artifactId: 'report',
        expectedRevision: artifact.revision,
        replacement: {
          content: artifact.content,
          source: { kind: 'task', taskId: 'source' },
        },
      },
      'ARTIFACT_QA_ACTIVE',
    )
  })

  it('denied verification tools leave the artifact unverified and create no success event', async () => {
    const s = await setup(1, false)
    await s.artifact('report')
    s.engine.request(s.request('inspect', 'report'))
    const qa = await s.engine.run('inspect', 'verifier')
    expect(qa.status).toBe('blocked')
    expect(s.runtime.getSnapshot().artifacts.report).toMatchObject({
      status: 'completed',
      verifiedByQA: null,
    })
    expect(
      s.runtime
        .getSnapshot()
        .events.some((event) => event.type === 'ARTIFACT_VERIFIED'),
    ).toBe(false)
    expect(s.execute).not.toHaveBeenCalled()
  })
})
