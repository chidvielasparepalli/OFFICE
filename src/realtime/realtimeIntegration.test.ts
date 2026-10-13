// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryArtifactStorage } from '../artifacts/ArtifactStorage'
import type { ArtifactCreateInput } from '../artifacts/artifactTypes'
import { InMemoryMemoryRepository } from '../memory/InMemoryMemoryRepository'
import { createQAPreviewSession, QA_PREVIEW } from '../dev/qaFixtures'
import {
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import { createOfficeRuntimeBridge } from '../runtime/officeRuntimeBridge'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import type { ProviderReservationInput } from '../providers/providerTypes'
import { createRealtimeProjection } from '../../tools-host/realtime/publication'
import { RealtimePublisher } from './RealtimePublisher'
import { LocalRealtimeTransport } from './LocalRealtimeTransport'
import { RealtimeStore } from './RealtimeStore'
import type { RealtimeEnvelope } from './realtimeTypes'

const cleanups: (() => void)[] = []
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup()),
)
function issue(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.state
}
function seed() {
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    providerBudgetPolicy: {
      unit: 'credit-micros',
      globalLimitMicros: 1000,
      perAgentLimitMicros: 1000,
      perTaskLimitMicros: 1000,
      perRequestLimitMicros: 1000,
      requestQuota: 10,
    },
  })
  issue(runtime, { type: 'connect' })
  issue(runtime, {
    type: 'registerDepartment',
    department: { id: 'engineering', name: 'Engineering' },
  })
  for (const id of ['manager', 'a', 'b', 'c'])
    issue(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: id,
        departmentId: 'engineering',
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        managerId: id === 'manager' ? null : 'manager',
        capabilities: ['text'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  return { runtime, storage }
}
function work(runtime: OfficeRuntime, id = 'task', agentId = 'a') {
  issue(runtime, {
    type: 'createTask',
    task: {
      id,
      title: `Explicit integration ${id}`,
      description: 'Deterministic test commands only.',
    },
  })
  issue(runtime, { type: 'assignTask', taskId: id, agentId })
  issue(runtime, { type: 'startTask', taskId: id })
}
async function connect(runtime: OfficeRuntime, principalAgentId = 'a') {
  const publisher = new RealtimePublisher({
    runtime,
    streamId: `integration:${principalAgentId}`,
    project: createRealtimeProjection({
      principalAgentId,
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
    }),
  })
  const envelopes: RealtimeEnvelope[] = []
  cleanups.push(
    () => publisher.dispose(),
    publisher.subscribe((message) => envelopes.push(message)),
  )
  const store = new RealtimeStore(new LocalRealtimeTransport(publisher))
  cleanups.push(() => store.dispose())
  await store.connect()
  return { publisher, store, envelopes }
}
async function artifactInput(
  storage: InMemoryArtifactStorage,
  patch: Partial<ArtifactCreateInput> = {},
): Promise<ArtifactCreateInput> {
  return {
    artifactId: 'report',
    name: 'Integration report',
    description: 'Actual test storage receipt.',
    type: 'report',
    role: 'output',
    outputRole: 'report',
    taskId: 'source',
    scope: { kind: 'task', id: 'source' },
    status: 'created',
    source: { kind: 'task', taskId: 'source' },
    content: await storage.put(
      new TextEncoder().encode('Explicit test document.'),
      'text/plain',
    ),
    ...patch,
  }
}
describe('accepted runtime commands through realtime into the office', () => {
  it('updates an exact worker and task through the existing bridge without changing Manager identity', async () => {
    const { runtime } = seed()
    const { store } = await connect(runtime)
    const bridge = createOfficeRuntimeBridge()
    const initial = bridge.project(store.getSnapshot(), new Map())!
    expect(initial.agents.a.status).toBe('sleeping')
    work(runtime)
    const working = bridge.project(store.getSnapshot(), new Map())!
    expect(working.agents.a).toMatchObject({
      id: 'a',
      kind: 'standard-worker',
      status: 'working',
      task: { id: 'task' },
    })
    expect(working.agents.manager).toMatchObject({
      id: 'manager',
      kind: 'manager',
      status: 'sleeping',
    })
    issue(runtime, {
      type: 'updateProgress',
      taskId: 'task',
      progressPercent: 45,
    })
    expect(
      bridge.project(store.getSnapshot(), new Map())!.agents.a.task
        ?.progressPercent,
    ).toBe(45)
    issue(runtime, { type: 'completeTask', taskId: 'task' })
    expect(
      bridge.project(store.getSnapshot(), new Map())!.agents.a.status,
    ).toBe('completed')
    expect(store.getSnapshot().revision).toBe(runtime.getSnapshot().revision)
  })
  it('does not publish rejected commands or idempotent no-ops', async () => {
    const { runtime } = seed()
    const { store, envelopes } = await connect(runtime)
    const previous = store.getSnapshot()
    const count = envelopes.length
    expect(
      runtime.dispatch({ type: 'completeTask', taskId: 'missing' }).ok,
    ).toBe(false)
    issue(runtime, { type: 'connect' })
    issue(runtime, { type: 'selectAgent', agentId: null })
    expect(envelopes).toHaveLength(count)
    expect(store.getSnapshot()).toBe(previous)
  })
  it('does not publish a command whose canonical repository commit fails', async () => {
    const saved = seed().runtime.getSnapshot()
    const runtime = createOfficeRuntime({
      repository: {
        read: () => saved,
        write: () => {
          throw new Error('Explicit test repository failure.')
        },
      },
    })
    const { store, envelopes } = await connect(runtime)
    const previous = store.getSnapshot()
    const result = runtime.dispatch({
      type: 'createTask',
      task: { id: 'uncommitted', title: 'Uncommitted test command' },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'REPOSITORY_ERROR' },
    })
    expect(envelopes).toHaveLength(0)
    expect(store.getSnapshot()).toBe(previous)
    expect(store.getSnapshot().tasks.uncommitted).toBeUndefined()
  })
  it('applies a multi-event dependency release atomically to the client', async () => {
    const { runtime } = seed()
    work(runtime, 'prerequisite')
    issue(runtime, {
      type: 'createTask',
      task: {
        id: 'dependent',
        title: 'Dependent integration task',
        dependencyIds: ['prerequisite'],
      },
    })
    issue(runtime, { type: 'assignTask', taskId: 'dependent', agentId: 'b' })
    const { store, envelopes } = await connect(runtime)
    const observed: [string, string, string][] = []
    cleanups.push(
      store.subscribe(() => {
        const state = store.getSnapshot()
        observed.push([
          state.tasks.prerequisite.status,
          state.tasks.dependent.status,
          state.agents.b.status,
        ])
      }),
    )
    issue(runtime, { type: 'completeTask', taskId: 'prerequisite' })
    expect(observed).toEqual([['completed', 'assigned', 'queued']])
    const revision = runtime.getSnapshot().revision
    expect(
      runtime
        .getSnapshot()
        .events.filter((event) => event.transactionRevision === revision)
        .length,
    ).toBeGreaterThan(1)
    expect(
      envelopes.filter((message) => message.revision === revision),
    ).toHaveLength(1)
  })
  it('carries selection-only revision advances without inventing business events', async () => {
    const { runtime } = seed()
    const { store, envelopes } = await connect(runtime)
    const revision = store.getSnapshot().revision
    const events = store.getSnapshot().events
    issue(runtime, { type: 'selectAgent', agentId: 'a' })
    expect(store.getSnapshot().revision).toBe(revision + 1)
    expect(store.getSnapshot().events).toEqual(events)
    expect(envelopes.at(-1)?.revision).toBe(revision + 1)
    work(runtime)
    expect(store.getSnapshot().tasks.task.status).toBe('in_progress')
    expect(store.getConnection().status).toBe('connected')
  })
  it('preserves unchanged entity identity and avoids replanning navigation for unrelated metadata', async () => {
    const { runtime } = seed()
    const { store } = await connect(runtime)
    work(runtime)
    const other = store.getSnapshot().agents.b
    const bridge = createOfficeRuntimeBridge()
    bridge.project(store.getSnapshot(), new Map())
    const plans = bridge.getMetrics().plans
    issue(runtime, {
      type: 'updateProgress',
      taskId: 'task',
      progressPercent: 15,
    })
    expect(store.getSnapshot().agents.b).toBe(other)
    bridge.project(store.getSnapshot(), new Map())
    expect(bridge.getMetrics().plans).toBe(plans)
  })
  it('recovers skipped reentrant source commits as one authoritative snapshot, never a guessed partial delta', async () => {
    const { runtime } = seed()
    let nested = false
    cleanups.push(
      runtime.subscribe(() => {
        if (!nested && runtime.getSnapshot().tasks.outer) {
          nested = true
          issue(runtime, {
            type: 'createTask',
            task: { id: 'inner', title: 'Nested accepted command' },
          })
        }
      }),
    )
    const { store, envelopes } = await connect(runtime)
    const observed: string[][] = []
    cleanups.push(
      store.subscribe(() =>
        observed.push(Object.keys(store.getSnapshot().tasks)),
      ),
    )
    issue(runtime, {
      type: 'createTask',
      task: { id: 'outer', title: 'Outer accepted command' },
    })
    expect(store.getSnapshot().tasks.outer).toBeDefined()
    expect(store.getSnapshot().tasks.inner).toBeDefined()
    expect(
      observed
        .filter((ids) => ids.includes('outer'))
        .every((ids) => ids.includes('inner')),
    ).toBe(true)
    expect(envelopes.at(-1)?.kind).toBe('snapshot')
    expect(
      envelopes.filter(
        (message) => message.revision === runtime.getSnapshot().revision,
      ),
    ).toHaveLength(1)
  })
  it('publishes artifact updates and an actual input handoff, then removes access when runtime access closes', async () => {
    const { runtime, storage } = seed()
    work(runtime, 'source')
    issue(runtime, {
      type: 'createTask',
      task: { id: 'receiving', title: 'Consume explicit input' },
    })
    issue(runtime, { type: 'assignTask', taskId: 'receiving', agentId: 'b' })
    const { store, envelopes } = await connect(runtime, 'b')
    issue(runtime, {
      type: 'createArtifact',
      agentId: 'a',
      artifact: await artifactInput(storage),
    })
    expect(store.getSnapshot().artifacts.report).toBeUndefined()
    issue(runtime, {
      type: 'linkInputArtifact',
      agentId: 'manager',
      taskId: 'receiving',
      artifactId: 'report',
    })
    expect(store.getSnapshot().artifacts.report.status).toBe('created')
    expect(store.getView()!.handoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: 'report',
          fromTaskId: 'source',
          toTaskId: 'receiving',
          toAgentId: 'b',
        }),
      ]),
    )
    issue(runtime, {
      type: 'updateArtifact',
      agentId: 'a',
      artifactId: 'report',
      expectedRevision: 1,
      status: 'completed',
    })
    expect(store.getSnapshot().artifacts.report.status).toBe('completed')
    expect(store.getSnapshot().artifacts.report.verifiedByQA).toBeNull()
    const receipt = store.getSnapshot().artifacts.report.content.contentId
    issue(runtime, { type: 'disconnect' })
    expect(store.getSnapshot().artifacts.report).toBeUndefined()
    expect(store.getSnapshot().tasks.receiving.inputArtifactIds).not.toContain(
      'report',
    )
    expect(
      store
        .getView()!
        .handoffs.some((handoff) => handoff.artifactId === 'report'),
    ).toBe(false)
    expect(JSON.stringify(store.getView())).not.toContain(receipt)
    const latest = envelopes.at(-1)
    expect(latest?.kind).toBe('delta')
    if (latest?.kind === 'delta')
      expect(latest.changes.records.artifacts?.report).toBeNull()
  })
  it('retains memory trust/source for the allowed worker while excluding private memory from other principals', async () => {
    const { runtime } = seed()
    const own = await connect(runtime, 'a')
    const other = await connect(runtime, 'b')
    const repository = new InMemoryMemoryRepository(runtime, 'a')
    repository.add({
      id: 'private-lesson',
      scope: { kind: 'agent', id: 'a' },
      type: 'episodic',
      content: 'Private integration lesson.',
      trust: 'unverified',
      source: { kind: 'agent', id: 'a' },
      reason: 'lesson',
      rationale: 'Explicit retained test lesson.',
    })
    expect(own.store.getSnapshot().memories['private-lesson']).toMatchObject({
      trust: 'unverified',
      source: { kind: 'agent', id: 'a' },
      verification: null,
    })
    expect(other.store.getSnapshot().memories['private-lesson']).toBeUndefined()
    expect(JSON.stringify(other.store.getView())).not.toContain(
      'Private integration lesson.',
    )
    const count = own.envelopes.length
    expect(
      runtime.dispatch({
        type: 'updateMemory',
        agentId: 'a',
        memoryId: 'private-lesson',
        expectedRevision: 1,
        patch: { trust: 'observed' },
      }).ok,
    ).toBe(false)
    expect(own.envelopes).toHaveLength(count)
    expect(own.store.getSnapshot().memories['private-lesson'].trust).toBe(
      'unverified',
    )
    repository.archive('private-lesson', 1)
    expect(own.store.getSnapshot().memories['private-lesson']).toBeUndefined()
  })
  it('rejects credential-bearing memory before either transport or historical context receives it', async () => {
    const { runtime } = seed()
    const { store, envelopes } = await connect(runtime)
    const synthetic = 'password=synthetic-realtime-fixture'
    const count = envelopes.length
    const result = runtime.dispatch({
      type: 'createMemory',
      agentId: 'a',
      memory: {
        id: 'rejected',
        scope: { kind: 'agent', id: 'a' },
        type: 'working',
        content: 'A safe-looking note.',
        metadata: { nested: { value: synthetic } },
        trust: 'unverified',
        source: { kind: 'agent', id: 'a' },
        reason: 'fact',
        rationale: 'Explicit rejection test.',
      },
    })
    expect(result.ok).toBe(false)
    expect(envelopes).toHaveLength(count)
    expect(JSON.stringify([result, store.getView(), envelopes])).not.toContain(
      synthetic,
    )
  })
  it('transports actual QA failure, canonical repair and passing recheck while preserving history and meaningful notices', async () => {
    const session = createQAPreviewSession()
    cleanups.push(() => session.dispose())
    session.connect()
    const { store } = await connect(session.runtime, QA_PREVIEW.manager)
    await session.begin()
    await session.write(false)
    session.finish()
    await session.runQA()
    expect(store.getSnapshot().qaRequests[QA_PREVIEW.qa].status).toBe('failed')
    expect(
      store.getSnapshot().tasks[QA_PREVIEW.task].verification?.status,
    ).not.toBe('verified')
    expect(Object.keys(store.getSnapshot().repairRequests)).toHaveLength(1)
    expect(
      store
        .getView()!
        .notifications.some(
          (notice) =>
            notice.eventId ===
            session.runtime
              .getSnapshot()
              .events.find((event) => event.type === 'QA_FAILED')?.id,
        ),
    ).toBe(true)
    session.assignRepair()
    const repairId = session.repair()!.repairId
    expect(store.getSnapshot().repairRequests[repairId].status).toBe(
      'in_progress',
    )
    expect(store.getSnapshot().agents[QA_PREVIEW.workerA].status).toBe('repair')
    await session.write(true)
    session.finish()
    session.recheck()
    await session.runQA()
    expect(
      Object.values(store.getSnapshot().qaRequests).map(
        (request) => request.status,
      ),
    ).toEqual(['failed', 'passed'])
    expect(
      store.getSnapshot().tasks[QA_PREVIEW.task].verification?.status,
    ).toBe('verified')
    expect(store.getSnapshot().repairRequests[repairId].status).toBe(
      'completed',
    )
    const bridge = createOfficeRuntimeBridge()
    const scene = bridge.project(store.getSnapshot(), new Map())!
    expect(scene.agents[QA_PREVIEW.manager].kind).toBe('manager')
    expect(scene.agents[QA_PREVIEW.workerA].status).toBe(
      session.runtime.getSnapshot().agents[QA_PREVIEW.workerA].status,
    )
  })
  it('propagates canonical provider reservations and late costs without raw tool bodies or duplicate ledger charges', async () => {
    const { runtime } = seed()
    work(runtime)
    const { store } = await connect(runtime)
    issue(runtime, {
      type: 'requestToolExecution',
      executionId: 'provider-call',
      agentId: 'a',
      taskId: 'task',
      toolId: 'provider.invoke',
      inputSummary: { text: 'Private provider input body.' },
      permission: {
        allowed: true,
        code: 'ALLOWED',
        reason: 'Explicit host fixture grant.',
        requiredPermissions: ['network'],
      },
      metadata: { providerBroker: true },
    })
    issue(runtime, { type: 'startToolExecution', executionId: 'provider-call' })
    const request: ProviderReservationInput = {
      requestId: 'provider-call',
      agentId: 'a',
      taskId: 'task',
      requestedProviderId: 'local',
      requestedModelId: 'fixture',
      selectedProviderId: 'local',
      selectedModelId: 'fixture',
      capability: 'text',
      requestFingerprint: 'a'.repeat(64),
      pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
      inputUnits: 2,
      maxOutputUnits: 10,
      maxCostMicros: 100,
      fallbackReasons: [],
    }
    issue(runtime, { type: 'reserveProviderRequest', request })
    expect(store.getView()!.costs.reservedMicros).toBe('34')
    issue(runtime, {
      type: 'settleProviderRequest',
      requestId: 'provider-call',
      status: 'cancelled',
      disposition: 'unknown',
      errorCode: 'PROVIDER_CANCELLED',
    })
    expect(store.getView()!.costs.unresolvedRequests).toBe(1)
    issue(runtime, {
      type: 'reconcileProviderCharge',
      requestId: 'provider-call',
      reconciliationId: 'usage:one',
      evidenceReference: 'receipt:one',
      usage: { inputUnits: 2, outputUnits: 2 },
    })
    expect(store.getView()!.costs).toMatchObject({
      chargedMicros: '10',
      reservedMicros: '0',
      unresolvedRequests: 0,
    })
    expect(store.getSnapshot().creditLedger).toHaveLength(3)
    expect(
      new Set(store.getSnapshot().creditLedger.map((entry) => entry.ledgerId))
        .size,
    ).toBe(3)
    expect(store.getSnapshot().providerRequests['provider-call']).toMatchObject(
      { status: 'cancelled', disposition: 'charged', retryable: false },
    )
    expect(
      store.getSnapshot().toolExecutions['provider-call'].inputSummary,
    ).toBeNull()
    expect(JSON.stringify(store.getView())).not.toContain(
      'Private provider input body.',
    )
    expect(store.getSnapshot().tasks.task.status).toBe('in_progress')
  })
})
