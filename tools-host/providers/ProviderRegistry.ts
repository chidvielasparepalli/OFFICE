import {
  memoryId,
  memoryObject,
  memorySafeJson,
} from '../../src/memory/memoryPolicy'
import type { RuntimeJson } from '../../src/runtime/runtimeTypes'
import { ToolFault } from '../../src/tools/toolTypes'
import type {
  ProviderCapability,
  ProviderDescriptor,
} from '../../src/providers/providerTypes'

export interface ProviderAdapterInput {
  readonly modelId: string
  readonly capability: ProviderCapability
  readonly input: RuntimeJson
  readonly maxOutputUnits: number
  readonly credential: string
  readonly signal: AbortSignal
}
export interface ProviderAdapterResult {
  readonly status: 'completed' | 'failed'
  readonly output: unknown
  /** Null means billing is unknown; failures must never imply a free request. */
  readonly usage: {
    readonly inputUnits: number
    readonly outputUnits: number
  } | null
}
export interface ProviderAdapter {
  execute(input: ProviderAdapterInput): Promise<ProviderAdapterResult>
}
interface Registration {
  readonly descriptor: ProviderDescriptor
  readonly secretReference: string
  readonly adapter: ProviderAdapter
}
const capabilities: readonly ProviderCapability[] = [
  'text',
  'structured',
  'research',
  'image',
  'video',
]
function assert(value: unknown): asserts value {
  if (!value)
    throw new ToolFault(
      'INVALID_PROVIDER_CONFIGURATION',
      'Provider configuration is invalid.',
    )
}
function whole(value: unknown, max: number) {
  assert(
    Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= max,
  )
}
function caps(value: readonly ProviderCapability[]) {
  assert(
    Array.isArray(value) &&
      value.length > 0 &&
      value.length <= capabilities.length &&
      new Set(value).size === value.length,
  )
  for (const item of value) assert(capabilities.includes(item))
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

/** Trusted host registrations; public descriptors never contain adapters or secret references. */
export class ProviderRegistry {
  readonly #registrations = new Map<string, Registration>()
  register(registration: Registration): void {
    const descriptor = structuredClone(registration.descriptor)
    memorySafeJson(descriptor, 16384)
    memoryObject(descriptor, [
      'id',
      'displayName',
      'enabled',
      'status',
      'capabilities',
      'models',
      'fallbacks',
    ])
    memoryId(descriptor.id)
    assert(!this.#registrations.has(descriptor.id))
    assert(
      typeof descriptor.displayName === 'string' &&
        descriptor.displayName.trim() &&
        descriptor.displayName.length <= 120,
    )
    assert(
      typeof descriptor.enabled === 'boolean' &&
        ['available', 'unavailable'].includes(descriptor.status),
    )
    caps(descriptor.capabilities)
    assert(
      Array.isArray(descriptor.models) &&
        descriptor.models.length > 0 &&
        descriptor.models.length <= 20,
    )
    assert(
      new Set(descriptor.models.map((model) => model.id)).size ===
        descriptor.models.length,
    )
    for (const model of descriptor.models) {
      memoryObject(model, [
        'id',
        'capabilities',
        'pricing',
        'maxInputUnits',
        'maxOutputUnits',
      ])
      memoryId(model.id)
      caps(model.capabilities)
      assert(
        model.capabilities.every((capability: ProviderCapability) =>
          descriptor.capabilities.includes(capability),
        ),
      )
      memoryObject(model.pricing, ['inputMicrosPerUnit', 'outputMicrosPerUnit'])
      whole(model.pricing.inputMicrosPerUnit, 1_000_000_000)
      whole(model.pricing.outputMicrosPerUnit, 1_000_000_000)
      whole(model.maxInputUnits, 100_000)
      whole(model.maxOutputUnits, 100_000)
      assert(model.maxInputUnits > 0 && model.maxOutputUnits > 0)
    }
    assert(
      Array.isArray(descriptor.fallbacks) && descriptor.fallbacks.length <= 3,
    )
    const routes = new Set<string>()
    for (const fallback of descriptor.fallbacks) {
      memoryObject(fallback, ['providerId', 'modelId'])
      memoryId(fallback.providerId)
      memoryId(fallback.modelId)
      const key = `${fallback.providerId}/${fallback.modelId}`
      assert(fallback.providerId !== descriptor.id && !routes.has(key))
      routes.add(key)
    }
    assert(
      typeof registration.secretReference === 'string' &&
        registration.secretReference.length > 0 &&
        registration.secretReference.length <= 256,
    )
    assert(typeof registration.adapter?.execute === 'function')
    // Capture the implementation so later caller mutation cannot switch an approved adapter.
    this.#registrations.set(
      descriptor.id,
      Object.freeze({
        descriptor: freeze(descriptor),
        secretReference: registration.secretReference,
        adapter: Object.freeze({
          execute: registration.adapter.execute.bind(registration.adapter),
        }),
      }),
    )
  }
  lookup(id: string): Registration | undefined {
    return this.#registrations.get(id)
  }
  list(): readonly ProviderDescriptor[] {
    return Object.freeze(
      [...this.#registrations.values()].map(({ descriptor }) => descriptor),
    )
  }
}
