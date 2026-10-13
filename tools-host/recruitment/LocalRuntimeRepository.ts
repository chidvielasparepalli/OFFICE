import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  OfficeRuntimeRepository,
  RuntimeState,
} from '../../src/runtime/runtimeTypes'

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const MAPS = [
  'agents',
  'tasks',
  'departments',
  'workstations',
  'requests',
  'plans',
  'toolExecutions',
  'memories',
  'qaRequests',
  'repairRequests',
  'artifacts',
  'providerRequests',
]

export class LocalRepositoryFault extends Error {
  readonly code: string
  constructor(code: string) {
    super(
      'Local office storage is unavailable; inspect its integrity and ownership before retrying.',
    )
    this.code = code
  }
}

function regularFile(file: string) {
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink())
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_UNSAFE_PATH')
  return info
}

function safeJson(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || depth > 100 || ancestors.has(value))
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
  ancestors.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
    safeJson(child, ancestors, depth + 1)
  }
  ancestors.delete(value)
}

function snapshotShape(value: unknown): asserts value is RuntimeState {
  safeJson(value)
  const state = value as RuntimeState | null
  if (
    !state ||
    typeof state !== 'object' ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !['local', 'disconnected'].includes(state.connection) ||
    MAPS.some((key) => {
      const field = (state as unknown as Record<string, unknown>)[key]
      return !field || typeof field !== 'object' || Array.isArray(field)
    }) ||
    ![state.events, state.activities, state.creditLedger].every(Array.isArray)
  )
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

/** Host-configured directory only. Never accept a browser-supplied path. */
export class LocalRuntimeRepository implements OfficeRuntimeRepository {
  readonly #file: string
  readonly #lock: string
  readonly #temporary: string
  readonly #recovery: string
  readonly #token = randomUUID()
  #lockFd: number | null = null
  #snapshot: RuntimeState | null = null

  constructor(options: { readonly directory: string }) {
    const directory = path.resolve(options.directory)
    this.#file = path.join(directory, 'runtime.json')
    this.#lock = path.join(directory, 'runtime.lock')
    this.#temporary = path.join(directory, 'runtime.json.tmp')
    this.#recovery = path.join(directory, 'runtime.recovery.lock')
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const info = lstatSync(directory)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new LocalRepositoryFault('LOCAL_REPOSITORY_UNSAFE_PATH')
      this.acquire()
      if (existsSync(this.#file)) {
        if (regularFile(this.#file).size > MAX_SNAPSHOT_BYTES)
          throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
        const envelope = JSON.parse(readFileSync(this.#file, 'utf8'))
        if (
          envelope?.version !== 1 ||
          typeof envelope.checksum !== 'string' ||
          envelope.checksum !== digest(JSON.stringify(envelope.snapshot))
        )
          throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
        snapshotShape(envelope.snapshot)
        this.#snapshot = freeze(envelope.snapshot)
      }
      // A temporary file was never committed; the complete runtime.json remains authoritative.
      if (existsSync(this.#temporary)) {
        regularFile(this.#temporary)
        unlinkSync(this.#temporary)
      }
    } catch (error) {
      this.close()
      if (error instanceof LocalRepositoryFault) throw error
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_UNAVAILABLE')
    }
  }

  private acquire() {
    if (existsSync(this.#recovery))
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
    if (existsSync(this.#lock)) {
      if (regularFile(this.#lock).size > 1024)
        throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
      const owner = JSON.parse(readFileSync(this.#lock, 'utf8'))
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
        throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
      try {
        process.kill(owner.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH')
          // shortcut: hard-crash recovery is an explicit local CLI operation, never an automatic competing writer.
          throw new LocalRepositoryFault('LOCAL_REPOSITORY_STALE_LOCK')
      }
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
    }
    this.#lockFd = openSync(this.#lock, 'wx', 0o600)
    writeFileSync(
      this.#lockFd,
      JSON.stringify({ pid: process.pid, token: this.#token }),
    )
    fsyncSync(this.#lockFd)
  }

  read() {
    if (this.#lockFd === null)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_CLOSED')
    return this.#snapshot
  }

  write(snapshot: RuntimeState) {
    if (this.#lockFd === null)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_CLOSED')
    snapshotShape(snapshot)
    if (this.#snapshot && snapshot.revision <= this.#snapshot.revision)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_STALE_SNAPSHOT')
    const serialized = JSON.stringify(snapshot)
    const data = JSON.stringify({
      version: 1,
      checksum: digest(serialized),
      snapshot,
    })
    if (Buffer.byteLength(data, 'utf8') > MAX_SNAPSHOT_BYTES)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_INVALID_SNAPSHOT')
    // Parse/freeze before committing: nothing fallible remains after the atomic rename.
    const copy = freeze(JSON.parse(serialized) as RuntimeState)
    let fd: number | null = null
    try {
      fd = openSync(this.#temporary, 'wx', 0o600)
      writeFileSync(fd, data, 'utf8')
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      renameSync(this.#temporary, this.#file)
      this.#snapshot = copy
    } catch {
      if (fd !== null) closeSync(fd)
      // Only this exclusive owner's temporary file can be removed.
      try {
        if (existsSync(this.#temporary)) {
          regularFile(this.#temporary)
          unlinkSync(this.#temporary)
        }
      } catch {
        /* Preserve diagnostics when cleanup cannot complete. */
      }
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_COMMIT_FAILED')
    }
  }

  close() {
    if (this.#lockFd === null) return
    closeSync(this.#lockFd)
    this.#lockFd = null
    try {
      regularFile(this.#lock)
      const owner = JSON.parse(readFileSync(this.#lock, 'utf8'))
      if (owner.token === this.#token) unlinkSync(this.#lock)
    } catch {
      /* Leave a lock rather than release another owner's storage. */
    }
  }
}

/** Explicit operator recovery; normal startup never deletes a possibly active writer's lock. */
export function recoverLocalRuntimeLock(directory: string) {
  const root = path.resolve(directory)
  const folder = lstatSync(root)
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_UNSAFE_PATH')
  const lock = path.join(root, 'runtime.lock')
  const guard = path.join(root, 'runtime.recovery.lock')
  let fd: number | null = null
  try {
    fd = openSync(guard, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify({ pid: process.pid }))
    fsyncSync(fd)
    if (!existsSync(lock)) return false
    if (regularFile(lock).size > 1024)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
    const original = readFileSync(lock, 'utf8')
    const owner = JSON.parse(original)
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
    let dead = false
    try {
      process.kill(owner.pid, 0)
    } catch (error) {
      dead = (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
    if (!dead || readFileSync(lock, 'utf8') !== original)
      throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
    unlinkSync(lock)
    return true
  } catch (error) {
    if (error instanceof LocalRepositoryFault) throw error
    throw new LocalRepositoryFault('LOCAL_REPOSITORY_LOCKED')
  } finally {
    if (fd !== null) {
      closeSync(fd)
      unlinkSync(guard)
    }
  }
}
