import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { memoryId, memoryObject } from '../../src/memory/memoryPolicy'
import type { OfficeRuntime } from '../../src/runtime/officeRuntime'
import type { RuntimeJson } from '../../src/runtime/runtimeTypes'
import type { ArtifactStorage } from '../../src/artifacts/artifactTypes'
import type {
  ProviderCapability,
  ProviderErrorCode,
  ProviderRequestInput,
  ProviderReservationInput,
  ProviderRuntimeCommand,
  ProviderUsage,
} from '../../src/providers/providerTypes'
import {
  calculateProviderCost,
  providerErrorCode,
} from '../../src/providers/costPolicy'
import {
  ToolFault,
  type Tool,
  type ToolContext,
} from '../../src/tools/toolTypes'
import {
  ProviderRegistry,
  type ProviderAdapterResult,
} from './ProviderRegistry'
import type { SecretStore } from './SecretStore'

export interface ProviderGrant {
  readonly agentId: string
  readonly providerIds: readonly string[]
  readonly capabilities: readonly ProviderCapability[]
}
const caps: readonly ProviderCapability[] = [
  'text',
  'structured',
  'research',
  'image',
  'video',
]
const canRoute = new Set<ProviderErrorCode>([
  'PROVIDER_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'QUOTA_EXCEEDED',
])
const message =
  'Provider request could not be authorized, validated or completed.'
function fail(code: ProviderErrorCode): never {
  throw new ToolFault(code, message)
}
function whole(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= max
  )
}

/** Invoked only by the existing ToolExecutor. Credentials and adapter objects never enter runtime state. */
export class ProviderBroker {
  readonly #runtime: OfficeRuntime
  readonly #registry: ProviderRegistry
  readonly #secrets: SecretStore
  readonly #grants: readonly ProviderGrant[]
  readonly #storage: ArtifactStorage | undefined
  readonly #timeoutMs: number
  constructor(options: {
    runtime: OfficeRuntime
    registry: ProviderRegistry
    secrets: SecretStore
    grants: readonly ProviderGrant[]
    storage?: ArtifactStorage
    timeoutMs?: number
  }) {
    this.#runtime = options.runtime
    this.#registry = options.registry
    this.#secrets = options.secrets
    this.#storage = options.storage
    this.#timeoutMs = options.timeoutMs ?? 30000
    if (!whole(this.#timeoutMs, 120000) || this.#timeoutMs < 1000)
      fail('INVALID_PROVIDER_REQUEST')
    this.#grants = structuredClone(options.grants)
    this.#secrets.assertPublic(this.#registry.list())
    for (const grant of this.#grants) {
      memoryObject(grant, ['agentId', 'providerIds', 'capabilities'])
      memoryId(grant.agentId)
      if (
        !Array.isArray(grant.providerIds) ||
        !Array.isArray(grant.capabilities) ||
        !grant.capabilities.every((capability) => caps.includes(capability))
      )
        fail('INVALID_PROVIDER_REQUEST')
      grant.providerIds.forEach(memoryId)
    }
  }
  private parse(value: unknown): RuntimeJson {
    try {
      this.#secrets.assertPublic(value)
      const input = memoryObject(value, [
        'providerId',
        'modelId',
        'capability',
        'input',
        'maxOutputUnits',
        'maxCostMicros',
        'allowFallback',
      ])
      memoryId(input.providerId)
      memoryId(input.modelId)
      if (
        !caps.includes(input.capability as ProviderCapability) ||
        !whole(input.maxOutputUnits, 100000) ||
        input.maxOutputUnits === 0 ||
        !whole(input.maxCostMicros) ||
        typeof input.allowFallback !== 'boolean' ||
        !Object.hasOwn(input, 'input')
      )
        fail('INVALID_PROVIDER_REQUEST')
      return structuredClone(value) as RuntimeJson
    } catch {
      fail('INVALID_PROVIDER_REQUEST')
    }
  }
  createTool(): Tool {
    return {
      id: 'provider.invoke',
      name: 'Brokered provider request',
      description:
        'Explicit host-authorized provider request with reserved cost and no public credentials.',
      category: 'data',
      capabilities: [],
      permissions: ['network'],
      allowedKinds: ['standard-worker', 'manager'],
      timeoutMs: this.#timeoutMs,
      metadata: { providerBroker: true },
      inputSchema: {
        description: 'Bounded provider selection, input and request ceilings.',
        parse: (value) => this.parse(value),
      },
      outputSchema: {
        description: 'Safe provider result and usage, never secrets.',
        parse: (value) => {
          try {
            return this.#secrets.assertPublic(value, 32768)
          } catch {
            fail('PROVIDER_OUTPUT_INVALID')
          }
        },
      },
      summarizeInput: (value) => {
        const request = value as unknown as ProviderRequestInput
        return {
          providerId: request.providerId,
          modelId: request.modelId,
          capability: request.capability,
          maxOutputUnits: request.maxOutputUnits,
          maxCostMicros: request.maxCostMicros,
          allowFallback: request.allowFallback,
        }
      },
      execute: async (value, context) => {
        try {
          return await this.run(
            value as unknown as ProviderRequestInput,
            context,
          )
        } catch (error) {
          let code: ProviderErrorCode = 'PROVIDER_FAILED'
          try {
            if (error instanceof ToolFault) code = providerErrorCode(error.code)
          } catch {
            /* Only fixed public codes may escape host dependencies. */
          }
          fail(code)
        }
      },
    }
  }
  private command(command: ProviderRuntimeCommand) {
    const result = this.#runtime.dispatch(command)
    if (!result.ok)
      throw new ToolFault('PROVIDER_ACCOUNTING_UNRESOLVED', message)
  }
  private async run(
    input: ProviderRequestInput,
    context: ToolContext,
  ): Promise<RuntimeJson> {
    const { executionId: requestId, agentId, taskId, signal } = context
    const primary = this.#registry.lookup(input.providerId)
    const routes = [
      { providerId: input.providerId, modelId: input.modelId },
      ...(input.allowFallback ? (primary?.descriptor.fallbacks ?? []) : []),
    ]
    const fallbackReasons: ProviderErrorCode[] = []
    const baseInputUnits = Buffer.byteLength(
      JSON.stringify(input.input),
      'utf8',
    )
    const estimateUnits = (providerId: string) => {
      const units =
        this.#registry
          .lookup(providerId)
          ?.adapter.estimateInputUnits?.(input.input) ?? baseInputUnits
      if (!whole(units, 100000) || units < baseInputUnits)
        fail('INVALID_PROVIDER_REQUEST')
      return units
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
    const reservation = (
      providerId: string,
      modelId: string,
    ): ProviderReservationInput => ({
      requestId,
      agentId,
      taskId,
      requestedProviderId: input.providerId,
      requestedModelId: input.modelId,
      selectedProviderId: providerId,
      selectedModelId: modelId,
      capability: input.capability,
      requestFingerprint: fingerprint,
      pricing: this.#registry
        .lookup(providerId)
        ?.descriptor.models.find((model) => model.id === modelId)?.pricing ?? {
        inputMicrosPerUnit: 0,
        outputMicrosPerUnit: 0,
      },
      inputUnits: estimateUnits(providerId),
      maxOutputUnits: input.maxOutputUnits,
      maxCostMicros: input.maxCostMicros,
      fallbackReasons: [...fallbackReasons],
    })
    let last = reservation(input.providerId, input.modelId)
    let reason: ProviderErrorCode = 'PROVIDER_UNAVAILABLE'
    for (const route of routes) {
      last = reservation(route.providerId, route.modelId)
      const registration = this.#registry.lookup(route.providerId)
      const model = registration?.descriptor.models.find(
        (candidate) => candidate.id === route.modelId,
      )
      const agent = this.#runtime.getSnapshot().agents[agentId]
      const grant = this.#grants.some(
        (item) =>
          item.agentId === agentId &&
          item.providerIds.includes(route.providerId) &&
          item.capabilities.includes(input.capability),
      )
      if (!registration) reason = 'UNKNOWN_PROVIDER'
      else if (!registration.descriptor.enabled) reason = 'PROVIDER_DISABLED'
      else if (!model) reason = 'MODEL_UNAVAILABLE'
      else if (!model.capabilities.includes(input.capability))
        reason = 'CAPABILITY_UNSUPPORTED'
      else if (!agent?.capabilities.includes(input.capability) || !grant)
        reason = 'PROVIDER_PERMISSION_DENIED'
      else if (
        last.inputUnits > model.maxInputUnits ||
        input.maxOutputUnits > model.maxOutputUnits
      )
        reason = 'INVALID_PROVIDER_REQUEST'
      else if (registration.descriptor.status !== 'available')
        reason = 'PROVIDER_UNAVAILABLE'
      else if (!this.#secrets.has(registration.secretReference))
        reason = 'CREDENTIAL_UNAVAILABLE'
      else {
        // The synchronous transaction reserves shared budget before any secret is read or adapter runs.
        const reserved = this.#runtime.dispatch({
          type: 'reserveProviderRequest',
          request: last,
        })
        if (reserved.ok) return this.execute(last, input, context, registration)
        if (
          reserved.error.code !== 'BUDGET_EXCEEDED' &&
          reserved.error.code !== 'QUOTA_EXCEEDED'
        )
          fail('PROVIDER_ACCOUNTING_UNRESOLVED')
        reason = reserved.error.code
      }
      fallbackReasons.push(reason)
      if (!canRoute.has(reason)) break
      if (signal.aborted) fail('PROVIDER_CANCELLED')
    }
    this.command({
      type: 'denyProviderRequest',
      request: { ...last, fallbackReasons },
      errorCode: reason,
    })
    fail(reason)
  }
  private async execute(
    reservation: ProviderReservationInput,
    input: ProviderRequestInput,
    context: ToolContext,
    registration: NonNullable<ReturnType<ProviderRegistry['lookup']>>,
  ): Promise<RuntimeJson> {
    const { requestId } = reservation
    const { signal } = context
    let submitted = false
    let usage: ProviderUsage | undefined
    const current = () =>
      this.#runtime.getSnapshot().providerRequests[requestId]
    const settle = (
      status: 'succeeded' | 'failed' | 'cancelled',
      errorCode?: ProviderErrorCode,
    ) => {
      const previous = current()
      if (previous.status !== 'reserved') {
        if (previous.disposition === 'unknown' && usage)
          this.command({
            type: 'reconcileProviderCharge',
            requestId,
            reconciliationId: `${requestId}.usage`,
            usage,
            evidenceReference: `provider-response:${requestId}`,
          })
        return
      }
      this.command({
        type: 'settleProviderRequest',
        requestId,
        status,
        disposition: usage ? 'charged' : submitted ? 'unknown' : 'released',
        ...(usage ? { usage } : {}),
        ...(errorCode ? { errorCode } : {}),
      })
    }
    const abort = () => {
      // Runtime subscribers cannot dispatch reentrantly. Unknown billing stays reserved if persistence fails.
      queueMicrotask(() => {
        try {
          if (current().status === 'reserved')
            settle('cancelled', 'PROVIDER_CANCELLED')
        } catch {
          /* Retained reservation requires host reconciliation. */
        }
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (signal.aborted) fail('PROVIDER_CANCELLED')
      const credential = this.#secrets.get(registration.secretReference)
      if (!credential) fail('CREDENTIAL_UNAVAILABLE')
      submitted = true
      const result: ProviderAdapterResult = await registration.adapter.execute({
        modelId: reservation.selectedModelId,
        capability: input.capability,
        input: input.input,
        maxOutputUnits: input.maxOutputUnits,
        credential,
        signal,
      })
      if (!result || !['completed', 'failed'].includes(result.status))
        fail('PROVIDER_OUTPUT_INVALID')
      if (result.usage !== null) {
        try {
          this.#secrets.assertPublic(result.usage)
          memoryObject(result.usage, ['inputUnits', 'outputUnits'])
          if (
            !whole(result.usage.inputUnits) ||
            !whole(result.usage.outputUnits)
          )
            fail('PROVIDER_USAGE_INVALID')
          const measured = {
            inputUnits: result.usage.inputUnits,
            outputUnits: result.usage.outputUnits,
          }
          calculateProviderCost(reservation.pricing, measured)
          usage = measured
        } catch {
          fail('PROVIDER_USAGE_INVALID')
        }
      }
      if (signal.aborted || current().status !== 'reserved')
        fail('PROVIDER_CANCELLED')
      if (result.status === 'failed') fail('PROVIDER_FAILED')
      if (
        !usage ||
        usage.inputUnits > reservation.inputUnits ||
        usage.outputUnits > input.maxOutputUnits
      )
        fail('PROVIDER_USAGE_INVALID')
      let output: RuntimeJson
      try {
        output = this.#secrets.assertPublic(result.output)
      } catch {
        fail('PROVIDER_OUTPUT_INVALID')
      }
      const content = this.#storage
        ? await this.#storage.put(
            Buffer.from(JSON.stringify(output), 'utf8'),
            'application/json',
          )
        : undefined
      if (signal.aborted || current().status !== 'reserved')
        fail('PROVIDER_CANCELLED')
      const record = current()
      const response = this.#secrets.assertPublic(
        {
          requestId,
          providerId: record.selectedProviderId,
          modelId: record.selectedModelId,
          capability: record.capability,
          status: 'succeeded',
          output,
          usage,
          estimateMicros: record.estimateMicros,
          actualMicros: calculateProviderCost(record.pricing, usage),
          unit: record.unit,
          errorCode: null,
          retryable: false,
          ...(content ? { content } : {}),
        },
        32768,
      )
      settle('succeeded')
      return response
    } catch (error) {
      const allowed: readonly ProviderErrorCode[] = [
        'PROVIDER_CANCELLED',
        'CREDENTIAL_UNAVAILABLE',
        'PROVIDER_OUTPUT_INVALID',
        'PROVIDER_USAGE_INVALID',
        'PROVIDER_ACCOUNTING_UNRESOLVED',
      ]
      const code: ProviderErrorCode = signal.aborted
        ? 'PROVIDER_CANCELLED'
        : error instanceof ToolFault &&
            allowed.includes(error.code as ProviderErrorCode)
          ? (error.code as ProviderErrorCode)
          : 'PROVIDER_FAILED'
      settle(code === 'PROVIDER_CANCELLED' ? 'cancelled' : 'failed', code)
      fail(code)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
}
