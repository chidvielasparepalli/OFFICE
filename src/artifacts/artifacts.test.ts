// @vitest-environment node
/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOfficeRuntime,
  InMemoryOfficeRuntimeRepository,
} from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeState } from '../runtime/runtimeTypes'
import { ArtifactService } from './ArtifactService'
import { InMemoryMemoryRepository } from '../memory/InMemoryMemoryRepository'
import { MemoryService } from '../memory/MemoryService'
import { hashArtifactBytes, InMemoryArtifactStorage } from './ArtifactStorage'
import { InMemoryArtifactRepository } from './InMemoryArtifactRepository'
import { taskOutputAssessment } from './artifactSelectors'
import { validateArtifactExpectations } from './artifactPolicy'
import type {
  ArtifactCreateInput,
  ArtifactPolicy,
  ArtifactStorage,
} from './artifactTypes'

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())
const encode = (value: string) => new TextEncoder().encode(value)
function setup(
  policy: ArtifactPolicy = { grants: [] },
  persistence = new InMemoryOfficeRuntimeRepository(),
) {
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    artifactPolicy: policy,
    repository: persistence,
  })
  const issue = (command: RuntimeCommand) => {
    const result = runtime.dispatch(command)
    if (!result.ok)
      throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.state
  }
  issue({ type: 'connect' })
  issue({
    type: 'registerDepartment',
    department: { id: 'engineering', name: 'Engineering' },
  })
  for (const id of ['manager', 'worker-a', 'worker-b'])
    issue({
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: id,
        departmentId: 'engineering',
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        managerId: id === 'manager' ? null : 'manager',
        position: [0, 0, 0],
        headingRadians: 0,
        capabilities: ['qa', 'write'],
      },
    })
  issue({
    type: 'createTask',
    task: {
      id: 'source',
      title: 'Produce explicit output',
      metadata: { projectId: 'project-a' },
    },
  })
  issue({ type: 'assignTask', taskId: 'source', agentId: 'worker-a' })
  issue({ type: 'startTask', taskId: 'source' })
  const repo = new InMemoryArtifactRepository(runtime, 'worker-a')
  const service = new ArtifactService(repo, storage)
  const input = async (
    patch: Partial<ArtifactCreateInput> = {},
  ): Promise<ArtifactCreateInput> => ({
    artifactId: 'report-v1',
    name: 'Report',
    description: 'Curated task output.',
    type: 'report',
    role: 'output',
    outputRole: 'report',
    taskId: 'source',
    projectId: 'project-a',
    scope: { kind: 'task', id: 'source' },
    status: 'completed',
    source: { kind: 'task', taskId: 'source' },
    content: await storage.put(encode('Original content'), 'text/plain'),
    ...patch,
  })
  return { runtime, issue, repo, service, storage, input, persistence }
}

describe('artifact storage and integrity', () => {
  it('hashes actual bytes with the SHA-256 standard and deduplicates identical immutable content', async () => {
    const storage = new InMemoryArtifactStorage()
    const bytes = encode('abc')
    const ref = await storage.put(bytes, 'text/plain')
    expect(ref.sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await storage.put(encode('abc'), 'text/plain')).toBe(ref)
    bytes[0] = 0
    const read = await storage.read(ref)
    read[0] = 0
    expect(new TextDecoder().decode(await storage.read(ref))).toBe('abc')
    expect(await hashArtifactBytes(encode('abcd'))).not.toBe(ref.sha256)
  })
  it('rejects forged content references and unsupported media types', async () => {
    const storage = new InMemoryArtifactStorage()
    const ref = await storage.put(encode('abc'), 'text/plain')
    expect(storage.inspect({ ...ref, byteLength: 4 })).toBeNull()
    await expect(
      storage.read({ ...ref, sha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' })
    await expect(
      storage.put(encode('abc'), 'file:///private'),
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT' })
  })
  it('rejects credential-like UTF-8 content without returning it in an error', async () => {
    const storage = new InMemoryArtifactStorage()
    const synthetic = 'password=synthetic-artifact-fixture'
    await expect(
      storage.put(encode(synthetic), 'text/plain'),
    ).rejects.toMatchObject({ code: 'SECRET_REJECTED' })
  })
  it('rejects invalid UTF-8 and oversized storage values', async () => {
    const storage = new InMemoryArtifactStorage()
    await expect(
      storage.put(new Uint8Array([0xff]), 'text/plain'),
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT' })
    await expect(
      storage.put(
        new Uint8Array(8 * 1024 * 1024 + 1),
        'application/octet-stream',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT' })
  })
  it('does not put content bytes into metadata, events or task context', async () => {
    const { input, repo, runtime } = setup()
    const artifact = repo.create(await input())
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(
      'Original content',
    )
    expect(artifact.content.byteLength).toBe(16)
    expect(artifact.status).toBe('completed')
    expect(artifact.verifiedByQA).toBeNull()
  })
  it('checks integrity and access again after asynchronous content reads', async () => {
    const { input, repo, storage, issue } = setup()
    const artifact = repo.create(await input())
    const changed: ArtifactStorage = {
      put: storage.put.bind(storage),
      inspect: storage.inspect.bind(storage),
      read: async () => encode('Changed'),
    }
    await expect(
      new ArtifactService(repo, changed).read(artifact.artifactId),
    ).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY' })
    const revoked: ArtifactStorage = {
      ...changed,
      read: async (ref) => {
        const bytes = await storage.read(ref)
        issue({ type: 'disconnect' })
        return bytes
      },
    }
    await expect(
      new ArtifactService(repo, revoked).read(artifact.artifactId),
    ).rejects.toMatchObject({ code: 'ARTIFACT_ACCESS_DENIED' })
  })
})

describe('canonical artifact records and version history', () => {
  it('creates task/agent/project links and matching committed event/activity', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input())
    expect(repo.get(artifact.artifactId)).toBe(artifact)
    expect(repo.listByTask('source')).toEqual([artifact])
    expect(repo.listByAgent('worker-a')).toEqual([artifact])
    expect(repo.listByProject('project-a')).toEqual([artifact])
    const state = runtime.getSnapshot()
    expect(state.tasks.source.outputArtifactIds).toEqual(['report-v1'])
    expect(state.events.at(-1)?.type).toBe('ARTIFACT_CREATED')
    expect(state.activities.at(-1)?.eventId).toBe(state.events.at(-1)?.id)
    expect(Object.isFrozen(artifact.source)).toBe(true)
  })
  it('creates a new immutable version and retains original content and source history', async () => {
    const { repo, input, storage, runtime } = setup()
    const original = repo.create(await input())
    const next = repo.createVersion(original.artifactId, original.revision, {
      artifactId: 'report-v2',
      source: { kind: 'task', taskId: 'source' },
      content: await storage.put(encode('Revised content'), 'text/plain'),
      metadata: { change: 'Explicit revision' },
    })
    expect(next).toMatchObject({
      version: 2,
      lineageId: original.artifactId,
      supersedesArtifactId: original.artifactId,
      verifiedByQA: null,
    })
    expect(repo.get(original.artifactId)).toMatchObject({
      status: 'superseded',
      source: original.source,
      content: original.content,
      supersededByArtifactId: next.artifactId,
    })
    expect(new TextDecoder().decode(await storage.read(original.content))).toBe(
      'Original content',
    )
    expect(runtime.getSnapshot().tasks.source.outputArtifactIds).toEqual([
      'report-v1',
      'report-v2',
    ])
    expect(
      runtime
        .getSnapshot()
        .events.slice(-2)
        .map((e) => e.type),
    ).toEqual(['ARTIFACT_SUPERSEDED', 'ARTIFACT_VERSION_CREATED'])
    expect(() =>
      repo.createVersion(original.artifactId, 1, {
        source: { kind: 'task', taskId: 'source' },
        content: next.content,
      }),
    ).toThrow()
  })
  it('allows lifecycle changes but rejects mutation of completed version content and direct verification', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input({ status: 'created' }))
    const active = repo.update(
      artifact.artifactId,
      artifact.revision,
      'in_progress',
    )
    const completed = repo.update(
      active.artifactId,
      active.revision,
      'completed',
    )
    const before = runtime.getSnapshot()
    expect(
      runtime.dispatch({
        type: 'updateArtifact',
        agentId: 'worker-a',
        artifactId: completed.artifactId,
        expectedRevision: completed.revision,
        status: 'verified',
      } as unknown as RuntimeCommand).ok,
    ).toBe(false)
    expect(runtime.getSnapshot()).toBe(before)
    expect(() =>
      repo.update(completed.artifactId, completed.revision, 'in_progress'),
    ).toThrow()
  })
  it('archives without deleting history and rejects stale revisions', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input())
    expect(() => repo.archive(artifact.artifactId, 99)).toThrow()
    expect(repo.archive(artifact.artifactId, 1).status).toBe('archived')
    expect(runtime.getSnapshot().events.at(-1)?.type).toBe('ARTIFACT_ARCHIVED')
    expect(repo.get(artifact.artifactId)?.content).toEqual(artifact.content)
  })
  it('rejects arbitrary URLs/filesystem locations and nonexistent content', async () => {
    const { repo, input, runtime } = setup()
    const value = await input()
    const before = runtime.getSnapshot()
    expect(() =>
      repo.create({
        ...value,
        content: { ...value.content, contentId: 'C:\\private\\output' },
      }),
    ).toThrow()
    expect(() =>
      repo.create({
        ...value,
        content: { ...value.content, sha256: '0'.repeat(64) },
      }),
    ).toThrow()
    expect(runtime.getSnapshot()).toBe(before)
  })
  it('counts only current output heads, not two versions as two outputs', async () => {
    const { repo, input, storage, runtime } = setup()
    const original = repo.create(await input())
    repo.createVersion(original.artifactId, 1, {
      source: { kind: 'task', taskId: 'source' },
      content: await storage.put(encode('v2'), 'text/plain'),
    })
    const state = runtime.getSnapshot()
    expect(
      taskOutputAssessment(state, {
        ...state.tasks.source,
        expectedOutputs: [{ role: 'report', type: 'report', count: 2 }],
      }).missing,
    ).toEqual(['report'])
    expect(
      taskOutputAssessment(state, {
        ...state.tasks.source,
        expectedOutputs: [{ role: 'report', type: 'report', count: 1 }],
      }).unverified,
    ).toEqual(['report'])
  })
  it('bounds output expectations and query results', async () => {
    expect(() =>
      validateArtifactExpectations([
        { role: 'report', type: 'report', count: 0 },
      ]),
    ).toThrow()
    expect(() => validateArtifactExpectations(Array(1))).toThrow()
    const { repo } = setup()
    expect(() => repo.list({ limit: 100 })).toThrow()
    expect(() => repo.list({ taskId: '../private' })).toThrow()
  })
  it('rolls back artifact/task/event changes when canonical persistence fails', async () => {
    const backing = new InMemoryOfficeRuntimeRepository()
    const { repo, input, runtime } = setup({ grants: [] }, backing)
    const value = await input()
    const before = runtime.getSnapshot()
    vi.spyOn(backing, 'write').mockImplementation(() => {
      throw new Error('Synthetic unavailable repository')
    })
    expect(() => repo.create(value)).toThrow('could not commit')
    expect(runtime.getSnapshot()).toBe(before)
    expect(backing.read()).toBe(before)
  })
})

describe('artifact principals and Phase 8 security boundaries', () => {
  it('keeps worker-private artifacts private from another worker and Manager', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(
      await input({ scope: { kind: 'agent', id: 'worker-a' } }),
    )
    for (const id of ['worker-b', 'manager']) {
      const other = new InMemoryArtifactRepository(runtime, id)
      expect(other.canRead(artifact.artifactId)).toBe(false)
      expect(other.list()).toEqual([])
      expect(() => other.get(artifact.artifactId)).toThrow()
      expect(() => other.archive(artifact.artifactId, 1)).toThrow()
    }
    expect(() => Object.assign(repo, { agentId: 'manager' })).toThrow()
    expect(repo.agentId).toBe('worker-a')
  })
  it('allows exact scope grants without widening modify or archive rights', async () => {
    const { repo, input, runtime } = setup({
      grants: [
        {
          agentId: 'worker-b',
          scope: { kind: 'agent', id: 'worker-a' },
          permissions: ['read'],
        },
      ],
    })
    const artifact = repo.create(
      await input({ scope: { kind: 'agent', id: 'worker-a' } }),
    )
    const other = new InMemoryArtifactRepository(runtime, 'worker-b')
    expect(other.get(artifact.artifactId)).toEqual(artifact)
    expect(other.canModify(artifact.artifactId)).toBe(false)
    expect(other.canArchive(artifact.artifactId)).toBe(false)
  })
  it('requires a matching project grant and owning task project', async () => {
    const { repo, input } = setup({
      grants: [
        {
          agentId: 'worker-a',
          scope: { kind: 'project', id: 'project-a' },
          permissions: ['read', 'modify', 'archive'],
        },
      ],
    })
    const artifact = repo.create(
      await input({ scope: { kind: 'project', id: 'project-a' } }),
    )
    expect(repo.listByProject('project-a')).toEqual([artifact])
    const wrongScope = await input({
      artifactId: 'bad-project',
      scope: { kind: 'project', id: 'project-b' },
      projectId: 'project-b',
    })
    const wrongTaskProject = await input({
      artifactId: 'bad-task-project',
      scope: { kind: 'project', id: 'project-a' },
      projectId: 'project-b',
    })
    expect(() => repo.create(wrongScope)).toThrow()
    expect(() => repo.create(wrongTaskProject)).toThrow()
  })
  it.each(['modify', 'archive'] as const)(
    'cannot disclose private metadata through a %s-only grant',
    async (permission) => {
      const scope = { kind: 'agent', id: 'worker-a' } as const
      const { repo, input, runtime } = setup({
        grants: [{ agentId: 'worker-b', scope, permissions: [permission] }],
      })
      const artifact = repo.create(await input({ scope, status: 'created' }))
      const other = new InMemoryArtifactRepository(runtime, 'worker-b')
      const before = runtime.getSnapshot()
      expect(() =>
        permission === 'archive'
          ? other.archive(artifact.artifactId, 1)
          : other.update(artifact.artifactId, 1, 'completed'),
      ).toThrow()
      expect(runtime.getSnapshot()).toBe(before)
      expect(other.canRead(artifact.artifactId)).toBe(false)
    },
  )
  it('rejects fabricated source identity and duplicate record IDs', async () => {
    const { repo, input, runtime } = setup()
    const value = await input()
    const before = runtime.getSnapshot()
    expect(() =>
      repo.create({
        ...value,
        source: { kind: 'tool', executionId: 'not-executed' },
      }),
    ).toThrow()
    expect(() =>
      repo.create({
        ...value,
        source: { kind: 'manager', taskId: 'source', requestId: 'absent' },
      }),
    ).toThrow()
    expect(runtime.getSnapshot()).toBe(before)
    repo.create(value)
    expect(() => repo.create(value)).toThrow()
  })
  it('requires explicit import permission and preserves user provenance when handed to a task', async () => {
    const scope = { kind: 'agent', id: 'worker-a' } as const
    const { repo, input, runtime, issue } = setup({
      grants: [{ agentId: 'worker-a', scope, permissions: ['import'] }],
    })
    const output = await input()
    const {
      outputRole: _role,
      taskId: _task,
      projectId: _project,
      ...base
    } = output
    const artifact = repo.create({
      ...base,
      role: 'input',
      source: { kind: 'user', reference: 'provided-brief' },
      scope,
    })
    expect(artifact.agentId).toBeNull()
    issue({ type: 'completeTask', taskId: 'source' })
    issue({
      type: 'createTask',
      task: { id: 'later', title: 'Read supplied brief' },
    })
    issue({ type: 'assignTask', taskId: 'later', agentId: 'worker-a' })
    repo.linkInput('later', artifact.artifactId)
    expect(runtime.getSnapshot().tasks.later.inputArtifactIds).toEqual([
      artifact.artifactId,
    ])
    expect(runtime.getSnapshot().tasks.later.outputArtifactIds ?? []).toEqual(
      [],
    )
    expect(repo.get(artifact.artifactId)?.source).toEqual(artifact.source)
    expect(
      new InMemoryArtifactRepository(runtime, 'worker-b').canRead(
        artifact.artifactId,
      ),
    ).toBe(false)
  })
  it('rejects user input attribution without a host grant', async () => {
    const { repo, input } = setup()
    const {
      taskId: _task,
      outputRole: _role,
      projectId: _project,
      ...value
    } = await input()
    expect(() =>
      repo.create({
        ...value,
        role: 'input',
        source: { kind: 'user', reference: 'provided-brief' },
      }),
    ).toThrow()
  })
  it('cannot bypass explicit task input handoff by claiming a task at import', async () => {
    const scope = { kind: 'agent', id: 'worker-a' } as const
    const { repo, input, runtime, issue } = setup({
      grants: [{ agentId: 'worker-a', scope, permissions: ['import'] }],
    })
    issue({
      type: 'createTask',
      task: { id: 'unrelated', title: 'Unrelated worker task' },
    })
    issue({ type: 'assignTask', taskId: 'unrelated', agentId: 'worker-b' })
    const { outputRole: _role, projectId: _project, ...value } = await input()
    const before = runtime.getSnapshot()
    expect(() =>
      repo.create({
        ...value,
        role: 'input',
        taskId: 'unrelated',
        scope,
        source: { kind: 'user', reference: 'provided-brief' },
      }),
    ).toThrow()
    expect(runtime.getSnapshot()).toBe(before)
  })
  it.each(['content', 'metadata', 'source'] as const)(
    'rejects credential-like %s without persistence or misleading activity',
    async (field) => {
      const { repo, input, runtime } = setup()
      const value = await input()
      const synthetic = 'password=synthetic-rejected-value'
      const unsafe =
        field === 'content'
          ? { ...value, description: synthetic }
          : field === 'metadata'
            ? {
                ...value,
                metadata: {
                  nested: [{ access_token: 'synthetic-rejected-value' }],
                },
              }
            : { ...value, source: { kind: 'user', reference: synthetic } }
      const before = runtime.getSnapshot()
      expect(() => repo.create(unsafe as ArtifactCreateInput)).toThrow()
      expect(runtime.getSnapshot()).toBe(before)
      expect(JSON.stringify(runtime.getSnapshot())).not.toContain(
        'synthetic-rejected-value',
      )
    },
  )
  it('rejects unsafe replacement and restored current/historical metadata', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input())
    const before = runtime.getSnapshot()
    expect(() =>
      repo.createVersion(artifact.artifactId, 1, {
        source: { kind: 'task', taskId: 'source' },
        content: artifact.content,
        metadata: { nested: { password: 'synthetic-unsafe' } },
      }),
    ).toThrow()
    expect(runtime.getSnapshot()).toBe(before)
    for (const historical of [false, true]) {
      const restored = structuredClone(before)
      const record = historical
        ? restored.events.at(-1)!.changes.artifacts![artifact.artifactId]
        : restored.artifacts[artifact.artifactId]
      Object.assign(record, {
        metadata: { nested: { password: 'synthetic-unsafe' } },
      })
      expect(() =>
        createOfficeRuntime({
          repository: new InMemoryOfficeRuntimeRepository(restored),
        }),
      ).toThrow()
    }
  })
  it('preserves safe restored history and rejects fabricated verified status', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input())
    expect(
      createOfficeRuntime({
        repository: new InMemoryOfficeRuntimeRepository(runtime.getSnapshot()),
      }).getSnapshot().artifacts,
    ).toEqual(runtime.getSnapshot().artifacts)
    const restored = structuredClone(runtime.getSnapshot()) as RuntimeState
    Object.assign(restored.artifacts[artifact.artifactId], {
      status: 'verified',
      verifiedByQA: 'fabricated',
    })
    expect(() =>
      createOfficeRuntime({
        repository: new InMemoryOfficeRuntimeRepository(restored),
      }),
    ).toThrow()
  })
  it('requires explicit memory transfer and preserves memory trust and credential boundaries', async () => {
    const { repo, input, runtime } = setup()
    const artifact = repo.create(await input())
    expect(runtime.getSnapshot().memories).toEqual({})
    const memoryRepo = new InMemoryMemoryRepository(runtime, 'worker-a')
    const service = new MemoryService(memoryRepo)
    const lesson = service.remember({
      scope: { kind: 'agent', id: 'worker-a' },
      type: 'episodic',
      content: 'Retain output identity when comparing later revisions.',
      metadata: {
        artifactId: artifact.artifactId,
        sha256: artifact.content.sha256,
      },
      trust: 'unverified',
      source: { kind: 'agent', id: 'worker-a' },
      reason: 'lesson',
      rationale: 'Explicitly curated versioning lesson.',
    })
    expect(lesson.trust).toBe('unverified')
    expect(() =>
      memoryRepo.update(lesson.id, lesson.revision, { trust: 'observed' }),
    ).toThrow()
    expect(() =>
      memoryRepo.update(lesson.id, lesson.revision, {
        metadata: { nested: { password: 'synthetic-rejected-memory' } },
      }),
    ).toThrow()
    expect(memoryRepo.get(lesson.id)?.trust).toBe('unverified')
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(
      'synthetic-rejected-memory',
    )
  })
})
