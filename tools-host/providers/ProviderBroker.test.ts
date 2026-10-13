// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOfficeRuntime } from '../../src/runtime/officeRuntime'
import type { RuntimeCommand } from '../../src/runtime/runtimeTypes'
import type {
  ProviderBudgetPolicy,
  ProviderDescriptor,
  ProviderRequestInput,
} from '../../src/providers/providerTypes'
import { ToolExecutor } from '../../src/tools/ToolExecutor'
import { ToolRegistry } from '../../src/tools/ToolRegistry'
import { ProviderBroker, type ProviderGrant } from './ProviderBroker'
import {
  ProviderRegistry,
  type ProviderAdapterResult,
} from './ProviderRegistry'
import { InMemorySecretStore } from './SecretStore'

const live: ToolExecutor[] = []
afterEach(() => {
  live.splice(0).forEach((executor) => executor.dispose())
})
const descriptor = (
  id = 'primary',
  patch: Partial<ProviderDescriptor> = {},
): ProviderDescriptor => ({
  id,
  displayName: 'Deterministic test provider',
  enabled: true,
  status: 'available',
  capabilities: ['text'],
  models: [
    {
      id: 'test-model',
      capabilities: ['text'],
      pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
      maxInputUnits: 1000,
      maxOutputUnits: 100,
    },
  ],
  fallbacks:
    id === 'primary' ? [{ providerId: 'backup', modelId: 'test-model' }] : [],
  ...patch,
})
const request: ProviderRequestInput = {
  providerId: 'primary',
  modelId: 'test-model',
  capability: 'text',
  input: { prompt: 'Explicit deterministic unit fixture' },
  maxOutputUnits: 10,
  maxCostMicros: 10000,
  allowFallback: false,
}
const successful = (): ProviderAdapterResult => ({
  status: 'completed',
  output: { text: 'Deterministic result' },
  usage: { inputUnits: 2, outputUnits: 3 },
})
function setup(
  options: {
    primary?: Partial<ProviderDescriptor>
    backup?: Partial<ProviderDescriptor>
    budget?: Partial<ProviderBudgetPolicy>
    grants?: readonly ProviderGrant[]
    credentials?: boolean
    execute?: () => Promise<ProviderAdapterResult>
    estimateInputUnits?: () => number
  } = {},
) {
  const runtime = createOfficeRuntime({
    providerBudgetPolicy: {
      unit: 'credit-micros',
      globalLimitMicros: 1000000,
      perAgentLimitMicros: 100000,
      perTaskLimitMicros: 100000,
      perRequestLimitMicros: 10000,
      ...options.budget,
    },
  })
  const command = (value: RuntimeCommand) => {
    const result = runtime.dispatch(value)
    if (!result.ok) throw new Error(result.error.code)
    return result
  }
  command({ type: 'connect' })
  command({
    type: 'registerDepartment',
    department: { id: 'dev', name: 'Development fixture' },
  })
  for (const id of ['worker', 'other']) {
    command({
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: 'Test worker',
        departmentId: 'dev',
        kind: 'standard-worker',
        capabilities: ['text'],
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
    command({
      type: 'createTask',
      task: { id: `${id}-task`, title: 'Explicit test task' },
    })
    command({ type: 'assignTask', taskId: `${id}-task`, agentId: id })
    command({ type: 'startTask', taskId: `${id}-task` })
  }
  const registry = new ProviderRegistry()
  const execute = vi.fn(options.execute ?? (async () => successful()))
  const backup = vi.fn(async () => successful())
  registry.register({
    descriptor: descriptor('primary', options.primary),
    secretReference: 'host-primary',
    adapter: {
      execute,
      ...(options.estimateInputUnits
        ? { estimateInputUnits: options.estimateInputUnits }
        : {}),
    },
  })
  registry.register({
    descriptor: descriptor('backup', options.backup),
    secretReference: 'host-primary',
    adapter: { execute: backup },
  })
  const secrets = new InMemorySecretStore(
    options.credentials === false
      ? {}
      : { 'host-primary': 'SYNTHETIC_ONLY_UNIT_PRIVATE_VALUE' },
  )
  const lookup = vi.spyOn(secrets, 'get')
  const broker = new ProviderBroker({
    runtime,
    registry,
    secrets,
    grants:
      options.grants ??
      ['worker', 'other'].map((agentId) => ({
        agentId,
        providerIds: ['primary', 'backup'],
        capabilities: ['text'],
      })),
  })
  const tools = new ToolRegistry()
  tools.register(broker.createTool())
  const executor = new ToolExecutor({
    runtime,
    registry: tools,
    grants: Object.fromEntries(
      ['worker', 'other'].map((id) => [
        id,
        { toolIds: ['provider.invoke'], permissions: ['network'] },
      ]),
    ),
  })
  live.push(executor)
  const run = (
    patch: Partial<ProviderRequestInput> = {},
    agentId = 'worker',
    executionId = 'call',
  ) =>
    executor.execute({
      executionId,
      agentId,
      taskId: `${agentId}-task`,
      toolId: 'provider.invoke',
      input: { ...request, ...patch },
    })
  return {
    runtime,
    command,
    registry,
    secrets,
    lookup,
    execute,
    backup,
    executor,
    run,
  }
}

describe('host provider registry and broker', () => {
  it('reserves adapter protocol/schema overhead rather than only the caller prompt', async () => {
    const s = setup({ estimateInputUnits: () => 500 })
    expect((await s.run()).status).toBe('completed')
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      inputUnits: 500,
      estimateMicros: 1030,
      actualMicros: 13,
    })
    const denied = setup({
      estimateInputUnits: () => 500,
      budget: { perRequestLimitMicros: 1000 },
    })
    expect(await denied.run()).toMatchObject({
      status: 'failed',
      error: { code: 'BUDGET_EXCEEDED' },
    })
    expect(denied.execute).not.toHaveBeenCalled()
    expect(denied.lookup).not.toHaveBeenCalled()
  })
  it.each([0, -1, 1.5, Number.NaN, 100001])(
    'rejects unsafe/understated adapter estimates: %s',
    async (estimate) => {
      const s = setup({ estimateInputUnits: () => estimate })
      expect(await s.run()).toMatchObject({
        status: 'failed',
        error: { code: 'INVALID_PROVIDER_REQUEST' },
      })
      expect(s.execute).not.toHaveBeenCalled()
      expect(s.lookup).not.toHaveBeenCalled()
    },
  )
  it('executes once through the tool boundary and records actual integer usage without completing the task', async () => {
    const s = setup()
    const result = await s.run()
    expect(result.status).toBe('completed')
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      status: 'succeeded',
      estimateMicros: 126,
      actualMicros: 13,
      disposition: 'charged',
    })
    expect(s.runtime.getSnapshot().tasks['worker-task'].status).toBe(
      'in_progress',
    )
    expect(
      s.runtime.getSnapshot().events.some((e) => e.type === 'USAGE_RECORDED'),
    ).toBe(true)
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(s.lookup).toHaveBeenCalledTimes(1)
  })
  it.each([
    [{ providerId: 'unknown' }, {}, 'UNKNOWN_PROVIDER'],
    [{ modelId: 'unknown' }, {}, 'MODEL_UNAVAILABLE'],
    [{ capability: 'image' }, {}, 'CAPABILITY_UNSUPPORTED'],
    [{ maxOutputUnits: 101 }, {}, 'INVALID_PROVIDER_REQUEST'],
    [{}, { primary: { enabled: false } }, 'PROVIDER_DISABLED'],
    [{}, { primary: { status: 'unavailable' } }, 'PROVIDER_UNAVAILABLE'],
    [{}, { credentials: false }, 'CREDENTIAL_UNAVAILABLE'],
    [{}, { grants: [] }, 'PROVIDER_PERMISSION_DENIED'],
    [{}, { budget: { globalLimitMicros: 1 } }, 'BUDGET_EXCEEDED'],
    [{}, { budget: { perTaskLimitMicros: 1 } }, 'BUDGET_EXCEEDED'],
    [{}, { budget: { perAgentLimitMicros: 1 } }, 'BUDGET_EXCEEDED'],
    [{ maxCostMicros: 1 }, {}, 'BUDGET_EXCEEDED'],
    [{}, { budget: { requestQuota: 0 } }, 'QUOTA_EXCEEDED'],
  ] as const)(
    'rejects policy failure %j before reading a credential or invoking an adapter',
    async (input, options, code) => {
      const s = setup(options)
      const result = await s.run(input)
      expect(result).toMatchObject({ status: 'failed', error: { code } })
      expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
        status: 'denied',
        errorCode: code,
        actualMicros: null,
      })
      expect(s.runtime.getSnapshot().tasks['worker-task'].status).toBe(
        'blocked',
      )
      expect(s.lookup).not.toHaveBeenCalled()
      expect(s.execute).not.toHaveBeenCalled()
    },
  )
  it('rejects unknown agent and malformed input without provider execution', async () => {
    const s = setup()
    await expect(s.run({}, 'unknown')).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    })
    const result = await s.run({ maxOutputUnits: -1 })
    expect(result.status).toBe('failed')
    expect(s.execute).not.toHaveBeenCalled()
    expect(s.runtime.getSnapshot().providerRequests).toEqual({})
  })
  it('uses the same first invocation for duplicate execution IDs without duplicate ledger charges', async () => {
    const s = setup()
    const [one, two] = await Promise.all([
      s.run(),
      s.run({ input: { prompt: 'Later input cannot replace the first call' } }),
    ])
    expect(one).toBe(two)
    expect(await s.run()).toBe(one)
    expect(s.execute).toHaveBeenCalledTimes(1)
    expect(Object.values(s.runtime.getSnapshot().creditLedger)).toHaveLength(2)
  })
  it('selects only the explicit authorized fallback before submission', async () => {
    const s = setup({ primary: { status: 'unavailable' } })
    expect((await s.run({ allowFallback: true })).status).toBe('completed')
    expect(s.execute).not.toHaveBeenCalled()
    expect(s.backup).toHaveBeenCalledTimes(1)
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      selectedProviderId: 'backup',
      fallbackReasons: ['PROVIDER_UNAVAILABLE'],
    })
    expect(
      s.runtime
        .getSnapshot()
        .events.some((e) => e.type === 'PROVIDER_FALLBACK_SELECTED'),
    ).toBe(true)
  })
  it('denies all unavailable routes with bounded history', async () => {
    const s = setup({
      primary: { status: 'unavailable' },
      backup: { status: 'unavailable' },
    })
    expect((await s.run({ allowFallback: true })).status).toBe('failed')
    expect(
      s.runtime.getSnapshot().providerRequests.call.fallbackReasons,
    ).toEqual(['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'])
    expect(s.backup).not.toHaveBeenCalled()
  })
  it('never substitutes an unauthorized fallback', async () => {
    const s = setup({
      primary: { status: 'unavailable' },
      grants: [
        { agentId: 'worker', providerIds: ['primary'], capabilities: ['text'] },
      ],
    })
    expect((await s.run({ allowFallback: true })).error?.code).toBe(
      'PROVIDER_PERMISSION_DENIED',
    )
    expect(s.backup).not.toHaveBeenCalled()
  })
  it('does not retry or release potentially billed work after an adapter throws', async () => {
    const s = setup({
      execute: async () => {
        throw new Error('SDK implementation detail')
      },
    })
    expect((await s.run({ allowFallback: true })).error?.code).toBe(
      'PROVIDER_FAILED',
    )
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      disposition: 'unknown',
      actualMicros: null,
      status: 'failed',
    })
    expect(s.backup).not.toHaveBeenCalled()
  })
  it('records known failed-request usage instead of treating failure as free', async () => {
    const s = setup({
      execute: async () => ({ ...successful(), status: 'failed' }),
    })
    expect((await s.run()).status).toBe('failed')
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      status: 'failed',
      actualMicros: 13,
      disposition: 'charged',
    })
  })
  it('keeps unknown usage unresolved and records actual overruns without clamping', async () => {
    const unknown = setup({
      execute: async () => ({ ...successful(), usage: null }),
    })
    expect((await unknown.run()).status).toBe('failed')
    expect(
      unknown.runtime.getSnapshot().providerRequests.call.disposition,
    ).toBe('unknown')
    const overrun = setup({
      execute: async () => ({
        ...successful(),
        usage: { inputUnits: 2, outputUnits: 10000 },
      }),
    })
    expect((await overrun.run()).error?.code).toBe('PROVIDER_USAGE_INVALID')
    expect(
      overrun.runtime.getSnapshot().providerRequests.call.actualMicros,
    ).toBe(30004)
  })
  it('reserves concurrent requests atomically against the shared budget', async () => {
    let finish!: (value: ProviderAdapterResult) => void
    const pending = new Promise<ProviderAdapterResult>((resolve) => {
      finish = resolve
    })
    const s = setup({
      execute: () => pending,
      budget: { globalLimitMicros: 150 },
    })
    const first = s.run()
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1))
    expect((await s.run({}, 'other', 'second')).error?.code).toBe(
      'BUDGET_EXCEEDED',
    )
    finish(successful())
    expect((await first).status).toBe('completed')
  })
  it('retains unknown liability when reported cost cannot be represented exactly', async () => {
    const s = setup({
      execute: async () => ({
        ...successful(),
        usage: { inputUnits: Number.MAX_SAFE_INTEGER, outputUnits: 1 },
      }),
    })
    expect((await s.run()).error?.code).toBe('PROVIDER_USAGE_INVALID')
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      status: 'failed',
      disposition: 'unknown',
      actualMicros: null,
    })
    expect(s.runtime.getSnapshot().creditLedger.at(-1)?.reservedMicros).toBe(
      126,
    )
  })
  it('retains cancellation liability then records late usage without reviving tool output', async () => {
    let finish!: (value: ProviderAdapterResult) => void
    const pending = new Promise<ProviderAdapterResult>((resolve) => {
      finish = resolve
    })
    const s = setup({ execute: () => pending })
    const first = s.run()
    await vi.waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1))
    expect(s.executor.cancel('call')).toBe(true)
    await vi.waitFor(() =>
      expect(s.runtime.getSnapshot().providerRequests.call.disposition).toBe(
        'unknown',
      ),
    )
    finish(successful())
    expect((await first).status).toBe('cancelled')
    expect(s.runtime.getSnapshot().providerRequests.call).toMatchObject({
      status: 'cancelled',
      actualMicros: 13,
      disposition: 'charged',
    })
    expect(s.runtime.getSnapshot().toolExecutions.call.output).toBeNull()
  })
  it('validates and freezes public registrations without exposing host configuration', () => {
    const registry = new ProviderRegistry()
    const original = descriptor()
    registry.register({
      descriptor: original,
      secretReference: 'HOST_ONLY_REFERENCE',
      adapter: { execute: async () => successful() },
    })
    expect(
      JSON.stringify(registry.list()).includes('HOST_ONLY_REFERENCE'),
    ).toBe(false)
    expect(Object.isFrozen(registry.list()[0].models[0])).toBe(true)
    expect(() =>
      registry.register({
        descriptor: original,
        secretReference: 'host',
        adapter: { execute: async () => successful() },
      }),
    ).toThrow()
    expect(() =>
      new ProviderRegistry().register({
        descriptor: {
          ...original,
          models: [
            {
              ...original.models[0],
              pricing: { inputMicrosPerUnit: 0.1, outputMicrosPerUnit: 1 },
            },
          ],
        },
        secretReference: 'host',
        adapter: { execute: async () => successful() },
      }),
    ).toThrow()
  })
})
