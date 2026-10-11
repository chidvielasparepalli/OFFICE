import { Buffer } from 'node:buffer'
import { memorySafeJson } from '../../src/memory/memoryPolicy'
import { ToolFault } from '../../src/tools/toolTypes'
import type { RuntimeJson } from '../../src/runtime/runtimeTypes'

/** Host-only dependency. Neither this object nor its references belong in public snapshots. */
export interface SecretStore {
  has(reference: string): boolean
  get(reference: string): string | undefined
  assertPublic(value: unknown, maxBytes?: number): RuntimeJson
}

export class InMemorySecretStore implements SecretStore {
  readonly #values: ReadonlyMap<string, string>
  constructor(values: Readonly<Record<string, string>>) {
    if (
      Object.values(values).some(
        (value) =>
          typeof value !== 'string' || value.length < 8 || value.length > 8192,
      )
    )
      throw new ToolFault(
        'INVALID_SECRET_CONFIGURATION',
        'Host secret configuration is invalid.',
      )
    this.#values = new Map(Object.entries(values))
  }
  has(reference: string) {
    return this.#values.has(reference)
  }
  get(reference: string) {
    return this.#values.get(reference)
  }
  assertPublic(value: unknown, maxBytes = 16384): RuntimeJson {
    try {
      const safe = memorySafeJson(value, maxBytes)
      const serialized = JSON.stringify(safe)
      for (const secret of this.#values.values()) {
        // Exact configured values supplement the existing pattern boundary; no claim of universal detection.
        const representations = [
          JSON.stringify(secret).slice(1, -1),
          encodeURIComponent(secret),
          Buffer.from(secret).toString('base64'),
        ]
        if (
          representations.some((representation) =>
            serialized.includes(representation),
          )
        )
          throw new Error('unsafe')
      }
      return safe
    } catch {
      throw new ToolFault(
        'UNSAFE_PROVIDER_DATA',
        'Provider data did not pass the public-data boundary.',
      )
    }
  }
}
