import { ToolFault, type ToolSchema } from '../../src/tools/toolTypes.ts'

export interface HostRoot {
  readonly path: string
  readonly writable?: boolean
}
export type HostRoots = Readonly<Record<string, Readonly<HostRoot>>>

export function assertTool(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ToolFault(code, message)
}

export function object(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  assertTool(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_INPUT',
    'Expected a plain input object.',
  )
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  assertTool(
    (prototype === Object.prototype || prototype === null) &&
      required.every((key) => Object.hasOwn(value, key)) &&
      keys.every(
        (key) =>
          typeof key === 'string' &&
          [...required, ...optional].includes(key) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
      ),
    'INVALID_INPUT',
    'Input fields do not match the tool schema.',
  )
  return value as Record<string, unknown>
}

export function text(
  value: unknown,
  label: string,
  max = 4096,
  empty = false,
): string {
  assertTool(
    typeof value === 'string' &&
      (empty || value.trim().length > 0) &&
      value.length <= max &&
      !value.includes('\0'),
    'INVALID_INPUT',
    `${label} must be bounded text.`,
  )
  return value
}

export function rootId(value: unknown): string {
  const id = text(value, 'Root ID', 80)
  assertTool(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) &&
      !['constructor', 'prototype', '__proto__'].includes(id),
    'INVALID_INPUT',
    'Root ID is invalid.',
  )
  return id
}

export function schema<T>(
  description: string,
  parse: (value: unknown) => T,
): ToolSchema<T> {
  return { description, parse }
}

export function abort(signal: AbortSignal) {
  if (signal.aborted)
    throw new ToolFault('CANCELLED', 'Execution was cancelled.')
}

export function safeError(error: unknown): never {
  if (error instanceof ToolFault) throw error
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT')
    throw new ToolFault(
      'FILE_NOT_FOUND',
      'The requested file or directory does not exist.',
    )
  if (code === 'EACCES' || code === 'EPERM')
    throw new ToolFault(
      'ACCESS_DENIED',
      'The host denied access to the requested resource.',
    )
  throw new ToolFault('HOST_IO_ERROR', 'The host operation failed.')
}

export function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  const result = value ?? fallback
  assertTool(
    Number.isSafeInteger(result) && result > 0 && result <= maximum,
    'INVALID_POLICY',
    'Host limit must be a positive bounded integer.',
  )
  return result
}
