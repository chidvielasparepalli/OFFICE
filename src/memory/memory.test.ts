import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyRuntimeState,
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type {
  OfficeRuntimeOptions,
  RuntimeCommand,
  RuntimeState,
} from '../runtime/runtimeTypes'
import { createOfficeRuntimeBridge } from '../runtime/officeRuntimeBridge'
import { InMemoryMemoryRepository } from './InMemoryMemoryRepository'
import { MemoryService } from './MemoryService'
import {
  MemoryFault,
  type MemoryGrant,
  type MemoryWriteInput,
} from './memoryTypes'

const START = '2026-10-10T08:00:00.000Z'
const grants: MemoryGrant[] = [
  ...['a', 'b', 'manager'].map((agentId) => ({
    agentId,
    scope: { kind: 'project' as const, id: 'office' },
    permissions: ['read', 'write'] as const,
  })),
  {
    agentId: 'manager',
    scope: { kind: 'project', id: 'office' },
    permissions: ['verify'],
    allowSourceAttribution: true,
  },
  {
    agentId: 'manager',
    scope: { kind: 'project', id: 'office' },
    permissions: ['write'],
    allowSourceAttribution: true,
  },
]
function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new MemoryFault(result.error.code, result.error.message)
  return result.state
}
function setup(options: OfficeRuntimeOptions = {}) {
  let time = START
  const runtime = createOfficeRuntime({
    now: () => time,
    memoryPolicy: { grants },
    ...options,
  })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'engineering', name: 'Engineering' },
  })
  for (const id of ['manager', 'a', 'b'])
    send(runtime, {
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: id,
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        departmentId: 'engineering',
        managerId: id === 'manager' ? null : 'manager',
        position: [0, 0, 0],
        headingRadians: 0,
        capabilities: ['research'],
      },
    })
  const a = new InMemoryMemoryRepository(runtime, 'a'),
    b = new InMemoryMemoryRepository(runtime, 'b'),
    manager = new InMemoryMemoryRepository(runtime, 'manager')
  return {
    runtime,
    a,
    b,
    manager,
    service: new MemoryService(a),
    advance(hours: number) {
      time = new Date(Date.parse(time) + hours * 3600000).toISOString()
    },
  }
}
function input(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    scope: { kind: 'agent', id: 'a' },
    type: 'semantic',
    content: 'Validate structured input before dispatch.',
    trust: 'observed',
    source: { kind: 'agent', id: 'a' },
    reason: 'lesson',
    rationale: 'Reuse the validated boundary approach.',
    ...overrides,
  }
}
function task(
  runtime: OfficeRuntime,
  id: string,
  agentId = 'a',
  projectId: string | null = 'office',
) {
  send(runtime, {
    type: 'createTask',
    task: { id, title: id, metadata: { projectId } },
  })
  send(runtime, { type: 'assignTask', taskId: id, agentId })
  send(runtime, { type: 'startTask', taskId: id })
}
function denied(action: () => unknown, code = 'MEMORY_ACCESS_DENIED') {
  try {
    action()
    throw new Error('Expected rejection')
  } catch (error) {
    expect(error).toHaveProperty('code', code)
  }
}

describe('explicit memory writes and provenance', () => {
  it('uses the runtime collection, repository boundary, immutable records and existing event/activity stream', () => {
    const { runtime, a, service } = setup()
    const listener = vi.fn()
    runtime.subscribe(listener)
    const record = service.remember(input())
    expect(runtime.getSnapshot().memories[record.id]).toBe(record)
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record.scope)).toBe(true)
    expect(a.get(record.id)).toBe(record)
    expect(
      runtime
        .getSnapshot()
        .events.slice(-2)
        .map((e) => e.type),
    ).toEqual(['MEMORY_CREATED', 'MEMORY_RETRIEVED'])
    expect(runtime.getSnapshot().activities.at(-1)?.summary).not.toContain(
      record.content,
    )
    expect(listener).toHaveBeenCalledTimes(2)
  })
  it.each([
    'working',
    'episodic',
    'semantic',
    'project',
    'preference',
  ] as const)('supports %s memory without additional categories', (type) => {
    expect(setup().a.add(input({ type })).type).toBe(type)
  })
  it('creates no memory from task completion or ordinary runtime events', () => {
    const { runtime } = setup()
    task(runtime, 'past')
    send(runtime, { type: 'completeTask', taskId: 'past' })
    expect(runtime.getSnapshot().memories).toEqual({})
  })
  it('requires explicit useful reason, rationale and bounded content', () => {
    const { a } = setup()
    for (const invalid of [
      { reason: 'chat' },
      { rationale: '' },
      { content: '' },
      { content: 'a'.repeat(4001) },
      { type: 'thought' },
      { importance: 'urgent' },
      { trust: 'certain' },
    ]) {
      expect(() =>
        a.add({ ...input(), ...invalid } as MemoryWriteInput),
      ).toThrow()
    }
  })
  it('does not let a worker impersonate another worker, Manager, user or system', () => {
    const { a } = setup()
    for (const source of [
      { kind: 'agent', id: 'b' },
      { kind: 'manager', id: 'a' },
      { kind: 'user', id: 'user' },
      { kind: 'system', id: 'system' },
    ] as const)
      denied(() => a.add(input({ source })), 'INVALID_SOURCE')
  })
  it('supports explicit user preferences through a host-authorized Manager attribution', () => {
    const { manager, b } = setup()
    const record = manager.add(
      input({
        scope: { kind: 'project', id: 'office' },
        type: 'preference',
        source: { kind: 'user', id: 'operator' },
        reason: 'preference',
        content: 'Prefer explicit task completion.',
        trust: 'observed',
      }),
    )
    expect(b.listByProject('office').memories[0]).toBe(record)
    expect(record.source).toEqual({ kind: 'user', id: 'operator' })
  })
  it('retains inferred trust and requires separate permission plus evidence for verification', () => {
    const { a, manager } = setup()
    const record = a.add(
      input({ scope: { kind: 'project', id: 'office' }, trust: 'inferred' }),
    )
    denied(() =>
      a.update(record.id, 1, {
        trust: 'verified',
        verificationEvidence: 'Reviewed source.',
      }),
    )
    expect(() => manager.update(record.id, 1, { trust: 'verified' })).toThrow()
    const verified = manager.update(record.id, 1, {
      trust: 'verified',
      verificationEvidence: 'Operator checked the documented boundary.',
    })
    expect(verified.verification).toMatchObject({
      agentId: 'manager',
      at: START,
    })
    expect(verified.source).toEqual(record.source)
    denied(
      () =>
        manager.update(record.id, 2, {
          metadata: { fact: 'Changed evidence.' },
        }),
      'INVALID_TRUST',
    )
  })
  it('retains tool evidence as unverified and never automatically stores tool output', () => {
    const { runtime, a, manager } = setup()
    task(runtime, 'research')
    send(runtime, {
      type: 'requestToolExecution',
      executionId: 'execution',
      agentId: 'a',
      taskId: 'research',
      toolId: 'research.search',
      inputSummary: {},
      permission: {
        allowed: true,
        code: 'ALLOWED',
        reason: 'Test host grant.',
        requiredPermissions: ['read'],
      },
      metadata: { category: 'research' },
    })
    send(runtime, { type: 'startToolExecution', executionId: 'execution' })
    send(runtime, {
      type: 'completeToolExecution',
      executionId: 'execution',
      output: { finding: 'Explicit unverified test finding.' },
    })
    expect(runtime.getSnapshot().memories).toEqual({})
    const write = input({
      scope: { kind: 'project', id: 'office' },
      source: { kind: 'tool', id: 'execution' },
      trust: 'unverified',
    })
    denied(() => a.add({ ...write, trust: 'observed' }), 'INVALID_TRUST')
    const record = a.add(write)
    denied(
      () =>
        a.supersede(record.id, 1, {
          ...write,
          source: { kind: 'agent', id: 'a' },
          trust: 'observed',
        }),
      'INVALID_TRUST',
    )
    denied(() => a.update(record.id, 1, { trust: 'observed' }), 'INVALID_TRUST')
    expect(
      manager.update(record.id, 1, {
        trust: 'verified',
        verificationEvidence:
          'Explicit independent review of fixture evidence.',
      }).trust,
    ).toBe('verified')
    expect(runtime.getSnapshot().tasks.research.status).toBe('in_progress')
    expect(runtime.getSnapshot().tasks.research.progressPercent).toBe(0)
  })
})

describe('principal, scope and project access', () => {
  it('keeps worker-private memory unavailable to another worker and the Manager', () => {
    const { a, b, manager } = setup()
    const record = a.add(input())
    for (const other of [b, manager]) {
      denied(() => other.get(record.id))
      denied(() => other.listByAgent('a'))
      denied(() => other.update(record.id, 1, { importance: 'high' }))
      denied(() => other.archive(record.id, 1))
      denied(() => other.supersede(record.id, 1, input()))
    }
    expect(a.listByAgent('a').memories).toEqual([record])
  })
  it('supports explicitly shared private scopes without granting write', () => {
    const { a, b } = setup({
      memoryPolicy: {
        grants: [
          ...grants,
          {
            agentId: 'b',
            scope: { kind: 'agent', id: 'a' },
            permissions: ['read'],
          },
        ],
      },
    })
    const record = a.add(input())
    expect(b.get(record.id)).toBe(record)
    denied(() => b.update(record.id, 1, { importance: 'high' }))
  })
  it('keeps Manager-private decisions separate from workers', () => {
    const { manager, a } = setup()
    const record = manager.add(
      input({
        scope: { kind: 'agent', id: 'manager' },
        source: { kind: 'manager', id: 'manager' },
      }),
    )
    expect(manager.listByAgent('manager').memories).toEqual([record])
    denied(() => a.get(record.id))
  })
  it('denies unrelated projects and organization memory without exact grants', () => {
    const { a, manager } = setup()
    for (const scope of [
      { kind: 'project', id: 'other' },
      { kind: 'organization', id: 'company' },
    ] as const) {
      denied(() => a.listByScope(scope))
      denied(() => manager.listByScope(scope))
      denied(() => a.add(input({ scope })))
    }
  })
  it('allows explicitly scoped organization access only to the named principal', () => {
    const { a, b } = setup({
      memoryPolicy: {
        grants: [
          {
            agentId: 'a',
            scope: { kind: 'organization', id: 'company' },
            permissions: ['read', 'write'],
          },
        ],
      },
    })
    const record = a.add(
      input({ scope: { kind: 'organization', id: 'company' } }),
    )
    expect(a.get(record.id)).toBe(record)
    denied(() => b.get(record.id))
  })
  it('captures policy defensively so mutating the input cannot grant new access', () => {
    const policy: { grants: MemoryGrant[] } = { grants: [] }
    const { a } = setup({ memoryPolicy: policy })
    policy.grants.push(...grants)
    denied(() => a.listByProject('office'))
  })
  it('rejects command-provided permissions or identity overrides', () => {
    const { runtime } = setup()
    const before = runtime.getSnapshot()
    const result = runtime.dispatch({
      type: 'createMemory',
      agentId: 'a',
      memory: input(),
      permissions: ['verify'],
    } as unknown as RuntimeCommand)
    expect(result.ok).toBe(false)
    expect(runtime.getSnapshot()).toBe(before)
  })
  it('checks project affiliation even for individually addressed private records', () => {
    const { runtime, a } = setup()
    const record = a.add(input({ projectId: 'office' }))
    const restored = createOfficeRuntime({
      repository: createInMemoryOfficeRuntimeRepository(runtime.getSnapshot()),
      memoryPolicy: { grants: [] },
    })
    denied(() => new InMemoryMemoryRepository(restored, 'a').get(record.id))
  })
  it('rejects mixed unauthorized scopes instead of returning a partially authorized answer', () => {
    const { a } = setup()
    a.add(input())
    denied(() =>
      a.search({
        scopes: [
          { kind: 'agent', id: 'a' },
          { kind: 'agent', id: 'b' },
        ],
      }),
    )
  })
})

describe('task/project context and deterministic retrieval', () => {
  it('excludes another project from task context even when the actor can access both projects', () => {
    const { runtime, a } = setup({
      memoryPolicy: {
        grants: [
          ...grants,
          {
            agentId: 'a',
            scope: { kind: 'project', id: 'other' },
            permissions: ['read', 'write'],
          },
        ],
      },
    })
    task(runtime, 'current')
    a.add(input({ projectId: 'other', content: 'Other project private fact.' }))
    const relevant = a.add(
      input({ projectId: 'office', content: 'Current project private fact.' }),
    )
    expect(a.buildContext({ taskId: 'current' }).memories).toEqual([relevant])
  })
  it('records explicit failure lessons without inventing a successful outcome', () => {
    const { runtime, a } = setup()
    task(runtime, 'failed-task')
    send(runtime, {
      type: 'failTask',
      taskId: 'failed-task',
      reason: 'Explicit test failure.',
    })
    const record = a.add(
      input({
        type: 'episodic',
        scope: { kind: 'project', id: 'office' },
        source: { kind: 'task', id: 'failed-task' },
      }),
    )
    expect(record.source.id).toBe('failed-task')
    expect(runtime.getSnapshot().tasks['failed-task'].status).toBe('failed')
  })
  it('stores explicit completed-task lessons for a later task in the same project', () => {
    const { runtime, a, service } = setup()
    task(runtime, 'past')
    const write = input({
      scope: { kind: 'project', id: 'office' },
      type: 'episodic',
      source: { kind: 'task', id: 'past' },
      reason: 'outcome',
    })
    denied(() => a.add(write), 'TASK_NOT_COMPLETED')
    send(runtime, { type: 'completeTask', taskId: 'past' })
    const record = service.remember(write)
    task(runtime, 'future')
    const context = service.forTask({ taskId: 'future', query: 'structured' })
    expect(context.memories).toEqual([record])
    expect(context.projectId).toBe('office')
    expect(JSON.parse(context.serialized).memories[0].source.id).toBe('past')
  })
  it('does not expose another task’s private memories without explicit task access', () => {
    const { runtime, a, b } = setup()
    task(runtime, 'task-a')
    const record = a.add(
      input({ scope: { kind: 'task', id: 'task-a' }, type: 'working' }),
    )
    denied(() => b.get(record.id))
    denied(() => b.buildContext({ taskId: 'task-a' }))
    expect(record.projectId).toBe('office')
  })
  it('rejects inconsistent project claims and context filters', () => {
    const { runtime, a } = setup()
    task(runtime, 'task-a')
    denied(
      () =>
        a.add(
          input({ scope: { kind: 'task', id: 'task-a' }, projectId: 'other' }),
        ),
      'PROJECT_MISMATCH',
    )
    denied(
      () =>
        a.add(
          input({
            scope: { kind: 'project', id: 'office' },
            projectId: 'other',
          }),
        ),
      'PROJECT_MISMATCH',
    )
    denied(() =>
      a.search({
        scopes: [{ kind: 'agent', id: 'a' }],
        taskId: 'task-a',
        projectId: 'other',
      }),
    )
  })
  it('ranks exact keyword overlap before importance and importance before recency', () => {
    const { a, advance } = setup()
    a.add(
      input({
        id: 'critical',
        content: 'Validate input.',
        importance: 'critical',
      }),
    )
    advance(1)
    a.add(
      input({
        id: 'recent',
        content: 'Validate other input.',
        importance: 'low',
      }),
    )
    a.add(
      input({
        id: 'match',
        content: 'Validate structured input.',
        importance: 'normal',
      }),
    )
    expect(
      a
        .search({
          scopes: [{ kind: 'agent', id: 'a' }],
          query: 'validate structured',
          maxCharacters: 10000,
        })
        .memories.map((m) => m.id),
    ).toEqual(['match', 'critical', 'recent'])
  })
  it('breaks equal relevance/importance ties by recency then stable ID', () => {
    const { a, advance } = setup()
    a.add(input({ id: 'old', content: 'First boundary decision.' }))
    advance(1)
    a.add(input({ id: 'z', content: 'Second boundary decision.' }))
    a.add(input({ id: 'a', content: 'Third boundary decision.' }))
    expect(a.listByAgent('a').memories.map((m) => m.id)).toEqual([
      'a',
      'z',
      'old',
    ])
  })
  it('returns no irrelevant keyword matches and honors importance thresholds', () => {
    const { a } = setup()
    a.add(input({ importance: 'low' }))
    expect(
      a.search({ scopes: [{ kind: 'agent', id: 'a' }], query: 'unrelated' })
        .memories,
    ).toEqual([])
    expect(a.listByAgent('a', { minimumImportance: 'high' }).memories).toEqual(
      [],
    )
  })
  it('deduplicates identical assertions while retaining distinct trust/provenance', () => {
    const { a } = setup()
    a.add(input())
    a.add(input())
    a.add(input({ trust: 'inferred' }))
    expect(a.listByAgent('a').memories).toHaveLength(2)
  })
  it('bounds full serialized context, including metadata, source and identity', () => {
    const { runtime, a } = setup()
    task(runtime, 'current')
    for (let n = 0; n < 8; n++)
      a.add(
        input({
          content: `Boundary fact ${n}.`,
          metadata: { note: 'x'.repeat(100) },
        }),
      )
    const context = a.buildContext({
      taskId: 'current',
      limit: 2,
      maxCharacters: 2400,
      maxApproxTokens: 500,
    })
    expect(context.memories.length).toBeGreaterThan(0)
    expect(context.memories.length).toBeLessThanOrEqual(2)
    expect(context.serialized.length).toBe(context.characters)
    expect(context.characters).toBeLessThanOrEqual(2000)
    expect(context.approximateTokens).toBe(Math.ceil(context.characters / 4))
    denied(
      () => a.buildContext({ taskId: 'current', maxCharacters: 2 }),
      'CONTEXT_LIMIT',
    )
  })
  it.each([
    { limit: 0 },
    { limit: 21 },
    { maxCharacters: 16001 },
    { maxApproxTokens: 4001 },
    { limit: 1.5 },
  ])('rejects invalid context limits %j', (limits) => {
    denied(() => setup().a.listByAgent('a', limits), 'INVALID_LIMIT')
  })
})

describe('retention, revisions and atomic conflicts', () => {
  it('rejects duplicate IDs and malformed restored replacement cycles without mutation', () => {
    const { runtime, a } = setup()
    const record = a.add(input({ id: 'unique' }))
    denied(() => a.add(input({ id: 'unique' })), 'DUPLICATE_ID')
    const corrupted = {
      ...runtime.getSnapshot(),
      memories: { unique: { ...record, supersedesId: 'unique' } },
    }
    const restored = createOfficeRuntime({
      repository: createInMemoryOfficeRuntimeRepository(corrupted),
      memoryPolicy: { grants },
    })
    const before = restored.getSnapshot()
    denied(
      () =>
        new InMemoryMemoryRepository(restored, 'a').supersede(
          'unique',
          1,
          input(),
        ),
      'INVALID_LINEAGE',
    )
    expect(restored.getSnapshot()).toBe(before)
  })
  it.each([
    ['low', 1],
    ['normal', 8],
    ['high', 24],
    ['critical', 72],
  ] as const)(
    'expires %s working memory after %s hours',
    (importance, hours) => {
      const { a, advance } = setup()
      const record = a.add(input({ type: 'working', importance }))
      advance(hours - 0.01)
      expect(a.get(record.id)).toBe(record)
      advance(0.01)
      expect(a.get(record.id)).toBeNull()
      expect(a.listByAgent('a').memories).toEqual([])
      a.update(record.id, 1, { importance: 'critical' })
      expect(a.get(record.id)).toBeNull()
    },
  )
  it('retains project/preferences and task history until explicitly archived', () => {
    const { a, advance } = setup()
    const record = a.add(input({ type: 'preference' }))
    advance(8760)
    expect(a.get(record.id)).toBe(record)
    const archived = a.archive(record.id, 1)
    expect(archived.status).toBe('archived')
    expect(a.get(record.id)).toBeNull()
    denied(
      () => a.update(record.id, 2, { importance: 'high' }),
      'INACTIVE_MEMORY',
    )
  })
  it('supersedes atomically with reciprocal links and excludes the older assertion', () => {
    const { runtime, a } = setup()
    const first = a.add(input({ content: 'Use the original convention.' }))
    const second = a.supersede(
      first.id,
      1,
      input({ content: 'Use the revised convention.' }),
    )
    expect(a.get(first.id)).toBeNull()
    expect(a.get(second.id)).toBe(second)
    expect(runtime.getSnapshot().memories[first.id]).toMatchObject({
      status: 'superseded',
      supersededById: second.id,
    })
    expect(second.supersedesId).toBe(first.id)
    const event = runtime
      .getSnapshot()
      .events.findLast((e) => e.type === 'MEMORY_SUPERSEDED')!
    expect(Object.keys(event.changes.memories!)).toHaveLength(2)
  })
  it('does not silently merge contradictory independent writes', () => {
    const { a } = setup()
    a.add(input({ content: 'Use convention A.' }))
    a.add(input({ content: 'Use convention B.' }))
    expect(a.listByAgent('a').memories).toHaveLength(2)
  })
  it('rejects stale edits, scope-changing replacements and direct content mutation', () => {
    const { a } = setup()
    const record = a.add(input())
    a.update(record.id, 1, { importance: 'high' })
    denied(() => a.archive(record.id, 1), 'STALE_MEMORY')
    denied(
      () =>
        a.supersede(
          record.id,
          2,
          input({ scope: { kind: 'project', id: 'office' } }),
        ),
      'SCOPE_MISMATCH',
    )
    expect(() =>
      a.update(record.id, 2, { content: 'Replace silently.' } as never),
    ).toThrow()
  })
  it('rolls back memory and events together when persistence fails', () => {
    const backing = createInMemoryOfficeRuntimeRepository()
    let fail = false
    const { runtime, a } = setup({
      repository: {
        read: () => backing.read(),
        write: (state) => {
          if (fail) throw new Error('storage')
          backing.write(state)
        },
      },
    })
    const record = a.add(input())
    const before = runtime.getSnapshot()
    fail = true
    denied(
      () => a.supersede(record.id, 1, input({ content: 'Changed.' })),
      'REPOSITORY_ERROR',
    )
    expect(runtime.getSnapshot()).toBe(before)
    expect(backing.read()).toBe(before)
  })
  it('restores memory through the existing repository with current host permissions', () => {
    const { runtime, a } = setup()
    const record = a.add(input())
    const restored = createOfficeRuntime({
      repository: createInMemoryOfficeRuntimeRepository(runtime.getSnapshot()),
      memoryPolicy: { grants },
      now: () => START,
    })
    expect(new InMemoryMemoryRepository(restored, 'a').get(record.id)).toEqual(
      record,
    )
  })
  it('replays memory after-images from the same event stream', () => {
    const { runtime, a } = setup()
    const old = a.add(input())
    const next = a.supersede(old.id, 1, input({ content: 'New.' }))
    a.archive(next.id, 1)
    let memories: RuntimeState['memories'] = {}
    for (const event of runtime.getSnapshot().events)
      memories = { ...memories, ...event.changes.memories }
    expect(memories).toEqual(runtime.getSnapshot().memories)
  })
  it('does not drive 3D posture, movement, headbands or business progress from memory', () => {
    const { runtime, a } = setup()
    const before = runtime.getSnapshot()
    const bridge = createOfficeRuntimeBridge()
    const views = new Map()
    const scene = bridge.project(before, views)!
    a.add(input())
    a.listByAgent('a')
    expect(runtime.getSnapshot().agents).toBe(before.agents)
    expect(runtime.getSnapshot().tasks).toBe(before.tasks)
    const after = bridge.project(runtime.getSnapshot(), views)!
    expect(after.agents.a.status).toBe(scene.agents.a.status)
    expect(after.agents.manager.kind).toBe('manager')
  })
  it('keeps old snapshots compatible and rejects disconnected operations', () => {
    const { memories: _memories, ...old } = createEmptyRuntimeState()
    const runtime = createOfficeRuntime({
      repository: createInMemoryOfficeRuntimeRepository(old as RuntimeState),
    })
    expect(runtime.getSnapshot().memories).toEqual({})
    denied(
      () => new InMemoryMemoryRepository(runtime, 'a').add(input()),
      'DISCONNECTED',
    )
  })
})

describe('secret rejection before persistence', () => {
  it.each([
    'password=hunter2',
    '{"password":"fixture"}',
    'https://user:fixture@example.test',
    'api_key: sample-private-value',
    'Bearer abc.def.ghi',
    '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    'sk-fixture1234567890',
    'ghp_fixture1234567890123',
    'AKIA1234567890123456',
  ])('rejects credential-like text without recording it: %s', (content) => {
    const { runtime, a } = setup()
    const before = runtime.getSnapshot()
    denied(() => a.add(input({ content })), 'SECRET_REJECTED')
    expect(runtime.getSnapshot()).toBe(before)
  })
  it('rejects nested secret fields, secret rationale and verification evidence', () => {
    const { a, manager } = setup()
    denied(
      () => a.add(input({ metadata: { nested: { password: 'fixture' } } })),
      'SECRET_REJECTED',
    )
    denied(
      () => a.add(input({ rationale: 'access_token=fixture' })),
      'SECRET_REJECTED',
    )
    denied(
      () =>
        manager.add(
          input({
            scope: { kind: 'project', id: 'office' },
            source: { kind: 'manager', id: 'manager' },
            trust: 'verified',
            verificationEvidence: 'password=fixture',
          }),
        ),
      'SECRET_REJECTED',
    )
  })
  it('rejects oversized metadata, cycles and invalid schemas', () => {
    const { a } = setup()
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const metadata of [
      { note: 'x'.repeat(9000) },
      cycle,
      { numeric: NaN },
      [],
    ])
      expect(() => a.add(input({ metadata: metadata as never }))).toThrow()
  })
})
