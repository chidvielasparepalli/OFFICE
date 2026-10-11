// @vitest-environment node
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactService } from '../../src/artifacts/ArtifactService'
import { InMemoryArtifactStorage } from '../../src/artifacts/ArtifactStorage'
import { InMemoryArtifactRepository } from '../../src/artifacts/InMemoryArtifactRepository'
import { validateContentReference } from '../../src/artifacts/artifactPolicy'
import { InMemoryMemoryRepository } from '../../src/memory/InMemoryMemoryRepository'
import { MemoryService } from '../../src/memory/MemoryService'
import type { MemoryWriteInput } from '../../src/memory/memoryTypes'
import type {
  ProviderBudgetPolicy,
  ProviderRequestInput,
} from '../../src/providers/providerTypes'
import {
  createOfficeRuntime,
  createInMemoryOfficeRuntimeRepository,
  type OfficeRuntime,
} from '../../src/runtime/officeRuntime'
import type { RuntimeCommand } from '../../src/runtime/runtimeTypes'
import { ToolExecutor } from '../../src/tools/ToolExecutor'
import { ToolRegistry } from '../../src/tools/ToolRegistry'
import { ToolFault } from '../../src/tools/toolTypes'
import { ProviderBroker } from './ProviderBroker'
import {
  ProviderRegistry,
  type ProviderAdapter,
  type ProviderAdapterResult,
} from './ProviderRegistry'
import { InMemorySecretStore } from './SecretStore'

const syntheticValue = 'obviously-synthetic-office-fixture-only-1138'
const secretReference = 'fixture-host-reference'
const executors: ToolExecutor[] = []
afterEach(() => executors.splice(0).forEach((executor) => executor.dispose()))
function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}
function noLeak(value: unknown, forbidden = syntheticValue) {
  const text = JSON.stringify(value)
  // Boolean assertions prevent a failure formatter from printing even synthetic credentials.
  expect(text.includes(forbidden)).toBe(false)
  expect(text.includes(encodeURIComponent(forbidden))).toBe(false)
  expect(text.includes(Buffer.from(forbidden).toString('base64'))).toBe(false)
}
const normalBudget: ProviderBudgetPolicy = {
  unit: 'credit-micros',
  globalLimitMicros: 100_000,
  perAgentLimitMicros: 100_000,
  perTaskLimitMicros: 100_000,
  perRequestLimitMicros: 100_000,
}
function setup(
  options: {
    execute?: ProviderAdapter['execute']
    toolPermission?: boolean
    providerPermission?: boolean
    budget?: ProviderBudgetPolicy
  } = {},
) {
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    providerBudgetPolicy: options.budget ?? normalBudget,
  })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'fixture', name: 'Provider boundary fixture' },
  })
  send(runtime, {
    type: 'registerAgent',
    agent: {
      id: 'worker',
      name: 'Boundary worker',
      role: 'Research fixture',
      kind: 'standard-worker',
      departmentId: 'fixture',
      capabilities: ['provider.invoke', 'structured'],
      position: [0, 0, 0],
      headingRadians: 0,
    },
  })
  send(runtime, {
    type: 'createTask',
    task: {
      id: 'task',
      title: 'Explicit provider fixture',
      description: 'Offline integration test.',
    },
  })
  send(runtime, { type: 'assignTask', taskId: 'task', agentId: 'worker' })
  send(runtime, { type: 'startTask', taskId: 'task' })
  const secrets = new InMemorySecretStore({ [secretReference]: syntheticValue })
  const resolve = vi.spyOn(secrets, 'get')
  const execute = vi.fn<ProviderAdapter['execute']>(
    options.execute ??
      (async (request) => {
        expect(request.credential === syntheticValue).toBe(true)
        return {
          status: 'completed',
          output: { summary: 'Review the actual acceptance criteria.' },
          usage: { inputUnits: 4, outputUnits: 3 },
        }
      }),
  )
  const registry = new ProviderRegistry()
  registry.register({
    descriptor: {
      id: 'offline',
      displayName: 'Offline security fixture',
      enabled: true,
      status: 'available',
      capabilities: ['structured'],
      models: [
        {
          id: 'fixture',
          capabilities: ['structured'],
          pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
          maxInputUnits: 1000,
          maxOutputUnits: 1000,
        },
      ],
      fallbacks: [],
    },
    secretReference,
    adapter: { execute },
  })
  const broker = new ProviderBroker({
    runtime,
    registry,
    secrets,
    storage,
    grants:
      options.providerPermission === false
        ? []
        : [
            {
              agentId: 'worker',
              providerIds: ['offline'],
              capabilities: ['structured'],
            },
          ],
  })
  const tool = broker.createTool()
  const tools = new ToolRegistry()
  tools.register(tool)
  const executor = new ToolExecutor({
    runtime,
    registry: tools,
    grants: {
      worker: {
        toolIds: options.toolPermission === false ? [] : [tool.id],
        permissions: ['network'],
      },
    },
  })
  executors.push(executor)
  const input: ProviderRequestInput = {
    providerId: 'offline',
    modelId: 'fixture',
    capability: 'structured',
    input: { purpose: 'Explicit offline fixture' },
    maxOutputUnits: 6,
    maxCostMicros: 1000,
    allowFallback: false,
  }
  const request = {
    executionId: 'execution:fixture',
    agentId: 'worker',
    taskId: 'task',
    toolId: tool.id,
    input,
  }
  const artifacts = new ArtifactService(
    new InMemoryArtifactRepository(runtime, 'worker'),
    storage,
  )
  const memoryRepository = new InMemoryMemoryRepository(runtime, 'worker')
  const memory = new MemoryService(memoryRepository)
  return {
    runtime,
    storage,
    secrets,
    resolve,
    execute,
    registry,
    broker,
    tools,
    executor,
    request,
    artifacts,
    memory,
    memoryRepository,
  }
}

describe('host provider security and explicit output integration', () => {
  it('keeps host credential values/references out of public descriptors and tool data', async () => {
    const s = setup()
    const result = await s.executor.execute(s.request)
    expect(result.status).toBe('completed')
    expect(s.resolve).toHaveBeenCalledTimes(1)
    expect(s.execute).toHaveBeenCalledTimes(1)
    for (const value of [
      s.registry.list(),
      s.tools.list(),
      result,
      s.runtime.getSnapshot(),
    ]) {
      noLeak(value)
      expect(JSON.stringify(value).includes(secretReference)).toBe(false)
    }
    expect(JSON.stringify(s.secrets)).toBe('{}')
  })

  it('captures artifacts and memory only through explicit existing boundaries and never verifies provider claims', async () => {
    const s = setup()
    const result = await s.executor.execute(s.request)
    expect(result.status).toBe('completed')
    expect(s.runtime.getSnapshot().artifacts).toEqual({})
    expect(s.runtime.getSnapshot().memories).toEqual({})
    const output = result.output as Record<string, unknown>
    const reference = validateContentReference(output.content)
    const artifact = s.artifacts.create({
      artifactId: 'provider-report',
      name: 'Offline report',
      description: 'Explicit provider output.',
      type: 'report',
      role: 'output',
      outputRole: 'report',
      taskId: 'task',
      scope: { kind: 'task', id: 'task' },
      source: { kind: 'tool', executionId: result.executionId },
      status: 'completed',
      content: reference,
    })
    expect(artifact.source).toMatchObject({
      kind: 'tool',
      executionId: result.executionId,
      taskId: 'task',
      agentId: 'worker',
      toolId: 'provider.invoke',
    })
    expect(artifact.verifiedByQA).toBeNull()
    expect(artifact.status).toBe('completed')
    const bytes = await s.artifacts.read(artifact.artifactId)
    expect(new TextDecoder().decode(bytes)).toContain('acceptance criteria')
    const assertion: MemoryWriteInput = {
      id: 'provider-lesson',
      scope: { kind: 'agent', id: 'worker' },
      type: 'semantic',
      content:
        'Check the actual acceptance criteria before declaring completion.',
      importance: 'normal',
      trust: 'unverified',
      source: { kind: 'tool', id: result.executionId },
      reason: 'lesson',
      rationale: 'Explicitly curated from the recorded fixture result.',
    }
    const stored = s.memory.remember(assertion)
    expect(stored.trust).toBe('unverified')
    expect(stored.source).toEqual(assertion.source)
    expect(() =>
      s.memoryRepository.update(stored.id, stored.revision, {
        trust: 'observed',
      }),
    ).toThrow()
    expect(() =>
      s.memoryRepository.update(stored.id, stored.revision, {
        trust: 'verified',
        verificationEvidence: 'The provider claims certainty.',
      }),
    ).toThrow()
    const context = s.memory.forTask({ taskId: 'task', query: 'acceptance' })
    expect(context.memories[0]).toMatchObject({
      trust: 'unverified',
      source: assertion.source,
    })
    noLeak(context)
    noLeak(s.runtime.getSnapshot())
  })

  it('rejects unsafe restored usage-event payloads before publishing history', async () => {
    const s = setup()
    expect((await s.executor.execute(s.request)).status).toBe('completed')
    const snapshot = s.runtime.getSnapshot()
    expect(
      snapshot.events.some((event) => event.type === 'USAGE_RECORDED'),
    ).toBe(true)
    expect(
      createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository(snapshot),
      }).getSnapshot(),
    ).toEqual(snapshot)
    const unsafe = {
      ...snapshot,
      events: snapshot.events.map((event) =>
        event.type === 'USAGE_RECORDED'
          ? {
              ...event,
              payload: {
                ...event.payload,
                detail: { password: 'synthetic-restored-fixture-only' },
              },
            }
          : event,
      ),
    }
    expect(() =>
      createOfficeRuntime({
        repository: createInMemoryOfficeRuntimeRepository(unsafe),
      }),
    ).toThrow()
    noLeak(s.runtime.getSnapshot(), 'synthetic-restored-fixture-only')
  })

  it.each([
    { toolPermission: false },
    { providerPermission: false },
    {
      budget: {
        ...normalBudget,
        globalLimitMicros: 1,
        perAgentLimitMicros: 1,
        perTaskLimitMicros: 1,
        perRequestLimitMicros: 1,
      },
    },
  ])(
    'denies unauthorized or unaffordable requests before credential lookup and provider invocation %#',
    async (options) => {
      const s = setup(options)
      const result = await s.executor.execute(s.request)
      expect(result.status).toBe('failed')
      expect(s.resolve).not.toHaveBeenCalled()
      expect(s.execute).not.toHaveBeenCalled()
      expect(s.runtime.getSnapshot().artifacts).toEqual({})
      expect(s.runtime.getSnapshot().memories).toEqual({})
      noLeak(s.runtime.getSnapshot())
    },
  )

  it.each([
    (credential: string) => ({ nested: [{ note: credential }] }),
    (credential: string) => ({
      nested: { note: encodeURIComponent(credential) },
    }),
    (credential: string) => ({
      nested: { note: Buffer.from(credential).toString('base64') },
    }),
    () => ({ nested: { note: 'sk-syntheticFixture1138Only' } }),
    () => ({ nested: { authorization: 'Bearer synthetic-only' } }),
    () => ({ nested: { note: 'password=synthetic-provider-fixture' } }),
  ])(
    'rejects nested credential-like provider results before content storage or public success %#',
    async (output) => {
      const s = setup({
        execute: async ({ credential }) => ({
          status: 'completed',
          output: output(credential),
          usage: { inputUnits: 4, outputUnits: 3 },
        }),
      })
      const persist = vi.spyOn(s.storage, 'put')
      const result = await s.executor.execute(s.request)
      expect(result.status).toBe('failed')
      expect(persist).not.toHaveBeenCalled()
      expect(result.output).toBeNull()
      noLeak(s.runtime.getSnapshot())
      expect(s.runtime.getSnapshot().artifacts).toEqual({})
      expect(s.runtime.getSnapshot().memories).toEqual({})
      expect(
        s.runtime
          .getSnapshot()
          .events.some((event) => event.type === 'TOOL_COMPLETED'),
      ).toBe(false)
    },
  )

  it.each(['error', 'tool-fault'] as const)(
    'does not publish raw provider %s text or codes',
    async (kind) => {
      const s = setup({
        execute: async ({ credential }) => {
          if (kind === 'tool-fault') throw new ToolFault(credential, credential)
          throw new Error(credential)
        },
      })
      const persist = vi.spyOn(s.storage, 'put')
      const result = await s.executor.execute(s.request)
      expect(result.status).toBe('failed')
      expect(persist).not.toHaveBeenCalled()
      noLeak(result)
      noLeak(s.runtime.getSnapshot())
    },
  )

  it.each(['secret-presence', 'registry-lookup'] as const)(
    'does not publish raw host %s failures during preflight',
    async (dependency) => {
      const s = setup()
      const fail = () => {
        throw new ToolFault(syntheticValue, syntheticValue)
      }
      if (dependency === 'secret-presence')
        vi.spyOn(s.secrets, 'has').mockImplementation(fail)
      else vi.spyOn(s.registry, 'lookup').mockImplementation(fail)
      const result = await s.executor.execute(s.request)
      expect(result).toMatchObject({
        status: 'failed',
        error: { code: 'PROVIDER_FAILED' },
      })
      expect(s.resolve).not.toHaveBeenCalled()
      expect(s.execute).not.toHaveBeenCalled()
      expect(s.runtime.getSnapshot().providerRequests).toEqual({})
      noLeak(result)
      noLeak(s.runtime.getSnapshot())
    },
  )

  it('does not publish raw public-boundary failures during final tool validation', async () => {
    const s = setup()
    const assertPublic = s.secrets.assertPublic.bind(s.secrets)
    let responseValidations = 0
    vi.spyOn(s.secrets, 'assertPublic').mockImplementation(
      (value, maxBytes) => {
        if (
          value &&
          typeof value === 'object' &&
          'status' in value &&
          value.status === 'succeeded' &&
          ++responseValidations === 2
        )
          throw new ToolFault(syntheticValue, syntheticValue)
        return assertPublic(value, maxBytes)
      },
    )
    const result = await s.executor.execute(s.request)
    expect(result.status).toBe('failed')
    expect(result.output).toBeNull()
    noLeak(result)
    noLeak(s.runtime.getSnapshot())
  })

  it('rejects unsafe request content without resolving credentials or publishing the rejected value', async () => {
    const s = setup()
    const result = await s.executor.execute({
      ...s.request,
      input: {
        ...s.request.input,
        input: { nested: { note: syntheticValue } },
      },
    })
    expect(result.status).toBe('failed')
    expect(s.resolve).not.toHaveBeenCalled()
    expect(s.execute).not.toHaveBeenCalled()
    noLeak(s.runtime.getSnapshot())
  })

  it('discards cancelled late output without storing bytes, artifacts or memory', async () => {
    let finish!: (result: ProviderAdapterResult) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const s = setup({
      execute: async () => {
        entered()
        return new Promise<ProviderAdapterResult>((resolve) => {
          finish = resolve
        })
      },
    })
    const persist = vi.spyOn(s.storage, 'put')
    const pending = s.executor.execute(s.request)
    await started
    expect(s.executor.cancel(s.request.executionId)).toBe(true)
    finish({
      status: 'completed',
      output: { note: syntheticValue },
      usage: { inputUnits: 4, outputUnits: 3 },
    })
    const result = await pending
    expect(result.status).toBe('cancelled')
    expect(result.output).toBeNull()
    expect(persist).not.toHaveBeenCalled()
    const state = s.runtime.getSnapshot()
    expect(state.artifacts).toEqual({})
    expect(state.memories).toEqual({})
    expect(state.events.some((event) => event.type === 'TOOL_COMPLETED')).toBe(
      false,
    )
    expect(state.providerRequests[s.request.executionId].status).toBe(
      'cancelled',
    )
    noLeak(state)
  })
})
