// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyRuntimeState,
  createOfficeRuntime,
} from '../../src/runtime/officeRuntime'
import {
  LocalRuntimeRepository,
  recoverLocalRuntimeLock,
} from './LocalRuntimeRepository'

let directory: string
const opened: LocalRuntimeRepository[] = []
const repository = () => {
  const result = new LocalRuntimeRepository({ directory })
  opened.push(result)
  return result
}
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'office-repository-test-'))
})
afterEach(() => {
  opened.splice(0).forEach((item) => item.close())
  rmSync(directory, { recursive: true, force: true })
})

describe('durable local runtime repository', () => {
  it('persists accepted canonical runtime commands before subscriber delivery and restores after restart', () => {
    const store = repository()
    const runtime = createOfficeRuntime({ repository: store })
    let notifications = 0
    runtime.subscribe(() => {
      notifications += 1
      const disk = JSON.parse(
        readFileSync(path.join(directory, 'runtime.json'), 'utf8'),
      )
      expect(disk.snapshot.revision).toBe(runtime.getSnapshot().revision)
    })
    expect(runtime.dispatch({ type: 'connect' }).ok).toBe(true)
    expect(
      runtime.dispatch({
        type: 'createTask',
        task: { id: 'durable-task', title: 'Stored task' },
      }).ok,
    ).toBe(true)
    const expected = runtime.getSnapshot()
    expect(notifications).toBe(2)
    store.close()
    const restored = createOfficeRuntime({ repository: repository() })
    expect(restored.getSnapshot()).toEqual(expected)
    expect(
      restored.dispatch({
        type: 'createTask',
        task: { id: 'next-task', title: 'After restart' },
      }).ok,
    ).toBe(true)
    expect(restored.getSnapshot().revision).toBe(expected.revision + 1)
  })

  it('does not persist rejected commands or emit false accepted updates', () => {
    const runtime = createOfficeRuntime({ repository: repository() })
    const before = runtime.getSnapshot()
    expect(runtime.dispatch({ type: 'startTask', taskId: 'missing' }).ok).toBe(
      false,
    )
    expect(runtime.getSnapshot()).toBe(before)
    expect(readdirSync(directory)).toEqual(['runtime.lock'])
  })

  it('rejects competing runtime owners and preserves the original lock', () => {
    repository()
    const before = readFileSync(path.join(directory, 'runtime.lock'), 'utf8')
    expect(repository).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_LOCKED' }),
    )
    expect(readFileSync(path.join(directory, 'runtime.lock'), 'utf8')).toBe(
      before,
    )
  })

  it('returns immutable detached snapshots and rejects stale writes', () => {
    const store = repository()
    const state = { ...createEmptyRuntimeState(), revision: 1 }
    store.write(state)
    state.revision = 99
    expect(store.read()?.revision).toBe(1)
    expect(Object.isFrozen(store.read())).toBe(true)
    expect(() =>
      store.write({ ...createEmptyRuntimeState(), revision: 1 }),
    ).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_STALE_SNAPSHOT' }),
    )
  })

  it('preserves the previous committed snapshot on invalid new state', () => {
    const store = repository()
    store.write({ ...createEmptyRuntimeState(), revision: 1 })
    const before = readFileSync(path.join(directory, 'runtime.json'), 'utf8')
    expect(() =>
      store.write({ ...createEmptyRuntimeState(), revision: Number.NaN }),
    ).toThrow()
    expect(readFileSync(path.join(directory, 'runtime.json'), 'utf8')).toBe(
      before,
    )
    expect(store.read()?.revision).toBe(1)
  })

  it('keeps prior data and runtime state when an atomic write cannot create its temporary file', () => {
    const store = repository()
    const runtime = createOfficeRuntime({ repository: store })
    expect(runtime.dispatch({ type: 'connect' }).ok).toBe(true)
    const before = runtime.getSnapshot()
    const disk = readFileSync(path.join(directory, 'runtime.json'), 'utf8')
    mkdirSync(path.join(directory, 'runtime.json.tmp'))
    const notify = vi.fn()
    runtime.subscribe(notify)
    expect(
      runtime.dispatch({
        type: 'createTask',
        task: { title: 'Not committed' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'REPOSITORY_ERROR' } })
    expect(runtime.getSnapshot()).toBe(before)
    expect(readFileSync(path.join(directory, 'runtime.json'), 'utf8')).toBe(
      disk,
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects corrupt snapshots without resetting or deleting them and releases its lock', () => {
    writeFileSync(path.join(directory, 'runtime.json'), '{corrupt test fixture')
    expect(repository).toThrow()
    expect(readFileSync(path.join(directory, 'runtime.json'), 'utf8')).toBe(
      '{corrupt test fixture',
    )
    expect(readdirSync(directory)).toEqual(['runtime.json'])
  })

  it('detects changed committed data through the integrity checksum', () => {
    const store = repository()
    store.write({ ...createEmptyRuntimeState(), revision: 1 })
    store.close()
    const envelope = JSON.parse(
      readFileSync(path.join(directory, 'runtime.json'), 'utf8'),
    )
    envelope.snapshot.revision = 50
    writeFileSync(
      path.join(directory, 'runtime.json'),
      JSON.stringify(envelope),
    )
    expect(repository).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_INVALID_SNAPSHOT' }),
    )
  })

  it('ignores uncommitted partial temporary data and restores the complete snapshot', () => {
    const store = repository()
    store.write({ ...createEmptyRuntimeState(), revision: 3 })
    store.close()
    writeFileSync(
      path.join(directory, 'runtime.json.tmp'),
      '{partial test data',
    )
    expect(repository().read()?.revision).toBe(3)
    expect(readdirSync(directory)).not.toContain('runtime.json.tmp')
  })

  it('fails closed after close and releases ownership idempotently', () => {
    const store = repository()
    store.close()
    store.close()
    expect(() => store.read()).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_CLOSED' }),
    )
    expect(() => store.write(createEmptyRuntimeState())).toThrow()
    expect(repository().read()).toBeNull()
  })

  it('surfaces repository failures without advancing runtime or notifying subscribers', () => {
    const store = repository()
    const runtime = createOfficeRuntime({ repository: store })
    const notify = vi.fn()
    runtime.subscribe(notify)
    const before = runtime.getSnapshot()
    store.close()
    expect(runtime.dispatch({ type: 'connect' })).toMatchObject({
      ok: false,
      error: { code: 'REPOSITORY_ERROR' },
    })
    expect(runtime.getSnapshot()).toBe(before)
    expect(notify).not.toHaveBeenCalled()
  })

  it('requires explicit dead-owner recovery and leaves committed data unchanged', () => {
    const store = repository()
    store.write({ ...createEmptyRuntimeState(), revision: 5 })
    store.close()
    const before = readFileSync(path.join(directory, 'runtime.json'), 'utf8')
    writeFileSync(
      path.join(directory, 'runtime.lock'),
      JSON.stringify({ pid: 999999, token: 'dead-test-owner' }),
    )
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('synthetic process absent'), {
        code: 'ESRCH',
      })
    })
    expect(repository).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_STALE_LOCK' }),
    )
    expect(recoverLocalRuntimeLock(directory)).toBe(true)
    expect(readFileSync(path.join(directory, 'runtime.json'), 'utf8')).toBe(
      before,
    )
    expect(repository().read()?.revision).toBe(5)
  })

  it('will never recover a live owner, unknown owner, or competing recovery', () => {
    repository()
    const before = readFileSync(path.join(directory, 'runtime.lock'), 'utf8')
    expect(() => recoverLocalRuntimeLock(directory)).toThrowError(
      expect.objectContaining({ code: 'LOCAL_REPOSITORY_LOCKED' }),
    )
    expect(readFileSync(path.join(directory, 'runtime.lock'), 'utf8')).toBe(
      before,
    )
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('synthetic permission denied'), {
        code: 'EPERM',
      })
    })
    expect(() => recoverLocalRuntimeLock(directory)).toThrow()
    writeFileSync(path.join(directory, 'runtime.recovery.lock'), 'occupied')
    expect(() => recoverLocalRuntimeLock(directory)).toThrow()
    expect(repository).toThrow()
    expect(readFileSync(path.join(directory, 'runtime.lock'), 'utf8')).toBe(
      before,
    )
  })
})
