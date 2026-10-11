import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryOfficeRuntimeRepository,
  createOfficeRuntime,
  type OfficeRuntime,
} from '../runtime/officeRuntime'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import { InMemoryMemoryRepository } from './InMemoryMemoryRepository'
import type { MemorySource, MemoryTrust, MemoryWriteInput } from './memoryTypes'

const PROJECT = { kind: 'project', id: 'office' } as const
const NOW = '2026-10-11T10:00:00.000Z'

function send(runtime: OfficeRuntime, command: RuntimeCommand) {
  const result = runtime.dispatch(command)
  if (!result.ok) throw new Error(result.error.code)
}

function setup(workerMayVerify = false) {
  const backing = createInMemoryOfficeRuntimeRepository()
  const runtime = createOfficeRuntime({
    repository: backing,
    now: () => NOW,
    memoryPolicy: {
      grants: [
        {
          agentId: 'worker',
          scope: PROJECT,
          permissions: workerMayVerify
            ? ['read', 'write', 'verify']
            : ['read', 'write'],
        },
        {
          agentId: 'manager',
          scope: PROJECT,
          permissions: ['read', 'write', 'verify'],
          allowSourceAttribution: true,
        },
      ],
    },
  })
  send(runtime, { type: 'connect' })
  send(runtime, {
    type: 'registerDepartment',
    department: { id: 'engineering', name: 'Engineering' },
  })
  for (const id of ['manager', 'worker'])
    send(runtime, {
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
        capabilities: ['research'],
      },
    })
  function task(id: string) {
    send(runtime, {
      type: 'createTask',
      task: { id, title: id, metadata: { projectId: PROJECT.id } },
    })
    send(runtime, { type: 'assignTask', taskId: id, agentId: 'worker' })
    send(runtime, { type: 'startTask', taskId: id })
  }
  task('earlier')
  for (const executionId of ['evidence', 'other-evidence']) {
    send(runtime, {
      type: 'requestToolExecution',
      executionId,
      agentId: 'worker',
      taskId: 'earlier',
      toolId: 'research.search',
      inputSummary: {},
      permission: {
        allowed: true,
        code: 'ALLOWED',
        reason: 'Explicit test host grant.',
        requiredPermissions: ['read'],
      },
      metadata: { category: 'research' },
    })
    send(runtime, { type: 'startToolExecution', executionId })
    send(runtime, {
      type: 'completeToolExecution',
      executionId,
      output: { finding: 'Synthetic unverified finding.' },
    })
  }
  send(runtime, { type: 'completeTask', taskId: 'earlier' })
  task('later')
  const worker = new InMemoryMemoryRepository(runtime, 'worker')
  const manager = new InMemoryMemoryRepository(runtime, 'manager')
  const notified = vi.fn()
  runtime.subscribe(notified)
  function rejected(action: () => unknown, code: string) {
    const before = runtime.getSnapshot()
    const persisted = backing.read()
    const calls = notified.mock.calls.length
    expect(action).toThrow(expect.objectContaining({ code }))
    expect(runtime.getSnapshot()).toBe(before)
    expect(backing.read()).toBe(persisted)
    expect(notified).toHaveBeenCalledTimes(calls)
  }
  return { runtime, worker, manager, rejected }
}

function input(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    scope: PROJECT,
    type: 'semantic',
    content: 'Validate memory boundaries before using context.',
    source: { kind: 'agent', id: 'worker' },
    trust: 'unverified',
    reason: 'lesson',
    rationale: 'Preserve the explicit boundary lesson.',
    ...overrides,
  }
}

const credentials = [
  '{"password":"synthetic-fixture-only"}',
  "'client_secret' = 'synthetic-fixture-only'",
  '{"access_token":"synthetic-fixture-only"}',
  'https://fixture:synthetic-fixture-only@example.test/path',
  'Bearer synthetic-fixture-only',
  '-----BEGIN PRIVATE KEY-----\nsynthetic-fixture-only\n-----END PRIVATE KEY-----',
  'sk-fixture1234567890',
  'ghp_fixture1234567890123',
]

describe('memory credential rejection across source and storage paths', () => {
  it.each([
    { kind: 'agent', id: 'worker' },
    { kind: 'manager', id: 'manager' },
    { kind: 'task', id: 'earlier' },
    { kind: 'tool', id: 'evidence' },
    { kind: 'user', id: 'operator' },
    { kind: 'system', id: 'host' },
  ] as const)(
    'rejects credential strings for $kind sources without publishing them',
    (source) => {
      const { runtime, worker, manager, rejected } = setup()
      const repository = ['manager', 'user', 'system'].includes(source.kind)
        ? manager
        : worker
      const safe = input({ source })
      const record = repository.add(safe)
      for (const value of credentials) {
        const variants: Partial<MemoryWriteInput>[] = [
          { content: value },
          { rationale: value },
          { metadata: { note: value } },
          { metadata: { nested: [{ details: [value] }] } },
        ]
        for (const fields of variants)
          rejected(
            () => repository.add({ ...safe, ...fields }),
            'SECRET_REJECTED',
          )
        const metadata = { nested: [{ details: [value] }] }
        rejected(
          () => repository.update(record.id, 1, { metadata }),
          'SECRET_REJECTED',
        )
        rejected(
          () => repository.supersede(record.id, 1, { ...safe, metadata }),
          'SECRET_REJECTED',
        )
      }
      const context = worker.buildContext({ taskId: 'later' })
      expect(context.memories).toEqual([record])
      const history = JSON.stringify(runtime.getSnapshot())
      for (const value of credentials) {
        expect(context.serialized).not.toContain(
          JSON.stringify(value).slice(1, -1),
        )
        expect(history).not.toContain(JSON.stringify(value).slice(1, -1))
      }
    },
  )

  it('applies credential rejection to an otherwise authorized verification assertion', () => {
    const { worker, manager, rejected } = setup()
    const record = worker.add(input())
    for (const verificationEvidence of credentials)
      rejected(
        () =>
          manager.update(record.id, 1, {
            trust: 'verified',
            verificationEvidence,
          }),
        'SECRET_REJECTED',
      )
    expect(worker.get(record.id)?.trust).toBe('unverified')
  })

  it('preserves ordinary nested application data and non-credential URLs', () => {
    const { worker } = setup()
    const record = worker.add(
      input({
        metadata: {
          note: 'Review password handling without retaining credentials.',
          nested: [
            { url: 'https://example.test/design', result: 'Build passed.' },
          ],
        },
      }),
    )
    expect(worker.buildContext({ taskId: 'later' }).memories).toEqual([record])
  })
})

describe('memory provenance and trust cannot be relabelled', () => {
  it.each(['unverified', 'inferred', 'observed'] as const)(
    'rejects repeated ordinary trust changes from %s on updates and replacements',
    (trust) => {
      const { worker, rejected } = setup()
      const record = worker.add(input({ trust }))
      for (let attempt = 0; attempt < 2; attempt++)
        for (const next of ['unverified', 'inferred', 'observed'] as const) {
          if (next === trust) continue
          rejected(
            () => worker.update(record.id, 1, { trust: next }),
            'INVALID_TRUST',
          )
          rejected(
            () => worker.supersede(record.id, 1, input({ trust: next })),
            'INVALID_TRUST',
          )
        }
      expect(worker.search({ scopes: [PROJECT] }).memories).toEqual([record])
      expect(worker.buildContext({ taskId: 'later' }).memories).toEqual([
        record,
      ])
    },
  )

  it('blocks the first source-laundering hop and retains tool provenance through repeated safe replacements', () => {
    const { runtime, worker, rejected } = setup()
    const source = { kind: 'tool', id: 'evidence' } as const
    const first = worker.add(input({ source }))
    for (const replacement of [
      input(),
      input({ trust: 'observed' }),
      input({ source: { kind: 'tool', id: 'other-evidence' } }),
    ])
      rejected(
        () => worker.supersede(first.id, 1, replacement),
        'INVALID_TRUST',
      )
    const second = worker.supersede(
      first.id,
      1,
      input({
        source,
        content: 'Clarified synthetic finding, still unverified.',
      }),
    )
    const third = worker.supersede(
      second.id,
      1,
      input({
        source,
        content: 'Further clarified synthetic finding, still unverified.',
      }),
    )
    for (const trust of ['observed', 'inferred'] as const) {
      rejected(() => worker.update(third.id, 1, { trust }), 'INVALID_TRUST')
      rejected(
        () => worker.supersede(third.id, 1, input({ source, trust })),
        'INVALID_TRUST',
      )
    }
    expect(third).toMatchObject({
      source,
      trust: 'unverified',
      verification: null,
      supersedesId: second.id,
    })
    expect(runtime.getSnapshot().memories[first.id]).toMatchObject({
      source,
      supersededById: second.id,
    })
    expect(runtime.getSnapshot().memories[second.id]).toMatchObject({
      source,
      supersedesId: first.id,
      supersededById: third.id,
    })
    const context = worker.buildContext({ taskId: 'later' })
    expect(context.memories).toEqual([third])
    expect(JSON.parse(context.serialized).memories[0]).toMatchObject({
      source,
      trust: 'unverified',
    })
  })

  it('retains exact source identity even when the replacement attribution is otherwise authorized', () => {
    const { manager, rejected } = setup()
    const source: MemorySource = { kind: 'user', id: 'original-user' }
    const record = manager.add(input({ source }))
    for (const changed of [
      { kind: 'user', id: 'another-user' },
      { kind: 'manager', id: 'manager' },
      { kind: 'system', id: 'host' },
    ] as const)
      rejected(
        () => manager.supersede(record.id, 1, input({ source: changed })),
        'INVALID_TRUST',
      )
    expect(manager.get(record.id)?.source).toEqual(source)
  })

  it.each(['agent', 'tool'] as const)(
    'requires an explicit verify grant and evidence to verify %s memory',
    (kind) => {
      const { worker, manager, rejected } = setup()
      const source = { kind, id: kind === 'tool' ? 'evidence' : 'worker' }
      const record = worker.add(input({ source }))
      rejected(
        () =>
          worker.supersede(
            record.id,
            1,
            input({
              source,
              trust: 'verified',
              verificationEvidence: 'An update must verify the record first.',
            }),
          ),
        'MEMORY_ACCESS_DENIED',
      )
      rejected(
        () =>
          worker.update(record.id, 1, {
            trust: 'verified',
            verificationEvidence: 'Independent review.',
          }),
        'MEMORY_ACCESS_DENIED',
      )
      expect(() =>
        manager.update(record.id, 1, { trust: 'verified' }),
      ).toThrow()
      const verified = manager.update(record.id, 1, {
        trust: 'verified',
        verificationEvidence: 'Authorized reviewer checked the finding.',
      })
      expect(verified).toMatchObject({
        source,
        trust: 'verified',
        verification: { agentId: 'manager', at: NOW },
      })
      rejected(
        () =>
          worker.supersede(
            record.id,
            2,
            input({
              source,
              trust: 'verified',
              verificationEvidence:
                'A worker assertion does not grant verification.',
            }),
          ),
        'MEMORY_ACCESS_DENIED',
      )
      for (const trust of [
        'unverified',
        'inferred',
        'observed',
      ] as MemoryTrust[])
        rejected(() => manager.update(record.id, 2, { trust }), 'INVALID_TRUST')
      expect(worker.buildContext({ taskId: 'later' }).memories).toEqual([
        verified,
      ])
    },
  )

  it.each(['agent', 'tool'] as const)(
    'requires fresh verification for changed %s replacement content',
    (kind) => {
      const { worker, rejected } = setup(true)
      const source = { kind, id: kind === 'tool' ? 'evidence' : 'worker' }
      if (kind === 'tool')
        rejected(
          () =>
            worker.add(
              input({
                source,
                trust: 'verified',
                verificationEvidence:
                  'A new tool record must start unverified.',
              }),
            ),
          'INVALID_TRUST',
        )
      const original = worker.add(input({ source }))
      rejected(
        () =>
          worker.supersede(
            original.id,
            1,
            input({
              source,
              trust: 'verified',
              verificationEvidence:
                'Verification must be a separate operation.',
            }),
          ),
        'INVALID_TRUST',
      )
      const verified = worker.update(original.id, 1, {
        trust: 'verified',
        verificationEvidence: 'Original content was reviewed.',
      })
      const replacement = input({
        source,
        trust: 'verified',
        content: 'New content requires its own review.',
      })
      rejected(
        () => worker.supersede(verified.id, 2, replacement),
        'INVALID_MEMORY',
      )
      const updated = worker.supersede(verified.id, 2, {
        ...replacement,
        verificationEvidence: 'Replacement content was reviewed separately.',
      })
      expect(updated.source).toEqual(verified.source)
      expect(updated.trust).toBe('verified')
      expect(updated.verification?.evidence).toBe(
        'Replacement content was reviewed separately.',
      )
      expect(updated.supersedesId).toBe(verified.id)
    },
  )
})
