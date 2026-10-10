import type { RuntimeJson } from '../runtime/runtimeTypes'
import { ToolFault, type ToolSchema } from './toolTypes'

export function toolObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new ToolFault('INVALID_INPUT', 'Expected a plain input object.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key)))
    throw new ToolFault('INVALID_INPUT', 'Unexpected input field.')
  return record
}

export function toolText(value: unknown, label: string, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    // oxlint-disable-next-line no-control-regex -- Text at this boundary must exclude controls.
    /[\u0000-\u001f]/u.test(value)
  )
    throw new ToolFault(
      'INVALID_INPUT',
      `${label} must be nonempty bounded text.`,
    )
  return value
}

export function toolId(value: unknown): string {
  const id = toolText(value, 'Identifier', 120)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(id))
    throw new ToolFault('INVALID_INPUT', 'Invalid identifier.')
  return id
}

/** Reject oversized/non-JSON output rather than silently truncating a structured result. */
export function publicToolJson(
  value: unknown,
  maxBytes = 64 * 1024,
): RuntimeJson {
  let nodes = 0
  function visit(input: unknown, depth: number): RuntimeJson {
    if (++nodes > 5000 || depth > 12)
      throw new ToolFault(
        'INVALID_OUTPUT',
        'Tool output exceeds structural limits.',
      )
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number' && Number.isFinite(input)) return input
    if (typeof input === 'string') return redactToolText(input)
    if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1))
    if (
      input &&
      typeof input === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      const result: Record<string, RuntimeJson> = {}
      for (const [key, entry] of Object.entries(input)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new ToolFault('INVALID_OUTPUT', 'Unsafe output field.')
        result[key] =
          /password|secret|token|authorization|credential|api.?key|private.?key/iu.test(
            key,
          )
            ? '[REDACTED]'
            : visit(entry, depth + 1)
      }
      return result
    }
    throw new ToolFault(
      'INVALID_OUTPUT',
      'Tool output must be finite JSON data.',
    )
  }
  const result = visit(value, 0)
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes)
    throw new ToolFault('OUTPUT_LIMIT', 'Tool output exceeds its byte limit.')
  return result
}

/** Defense in depth. Tools must still limit readable sources; this is not a secret detector. */
export function redactToolText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(
      /\b((?:api[_-]?key|password|secret|access[_-]?token|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1[REDACTED]',
    )
}

export const jsonOutputSchema: ToolSchema<RuntimeJson> = {
  description: 'Bounded public JSON; no credentials or host environment.',
  parse: publicToolJson,
}
