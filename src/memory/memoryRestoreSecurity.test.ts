import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryPreviewSession,
  memoryPreviewPolicy,
  MEMORY_PREVIEW as ids,
} from '../dev/memoryFixtures'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeState } from '../runtime/runtimeTypes'
import { InMemoryMemoryRepository } from './InMemoryMemoryRepository'
import { memorySafeJson } from './memoryPolicy'
import { buildMemoryContext, serializeMemoryContext } from './memoryRetrieval'
import type { MemoryRecord } from './memoryTypes'

const secret = '{"password":"synthetic-restore-fixture-only"}'
const now = '2026-10-11T12:00:00.000Z'

function fixture() {
  const session = createMemoryPreviewSession()
  session.connect()
  session.begin(ids.laterTask)
  const record = session.write(ids.workerA, {
    id: 'safe-memory',
    trust: 'unverified',
    content: 'Safe restore and context fixture.',
  })
  return { ...session, record, state: session.runtime.getSnapshot() }
}

function rejectedRestore(state: RuntimeState, code: string) {
  const write = vi.fn()
  const read = () => state
  expect(() =>
    createOfficeRuntime({
      repository: { read, write },
      memoryPolicy: memoryPreviewPolicy,
    }),
  ).toThrow(expect.objectContaining({ code }))
  expect(read()).toBe(state)
  expect(write).not.toHaveBeenCalled()
}

describe('the single credential boundary scans all memory JSON', () => {
  it.each([
    ['quoted authorization', '{"authorization":"synthetic-fixture-only"}'],
    ['quoted secret', '{"secret":"synthetic-fixture-only"}'],
    ['quoted refresh token', "'refresh_token': 'synthetic-fixture-only'"],
    ['quoted token', '{"token":"synthetic-fixture-only"}'],
    ['quoted credential', '{"credential":"synthetic-fixture-only"}'],
    ['AWS-shaped key', 'AKIAABCDEFGHIJKLMNOP'],
    ['JWT-shaped token', 'eyJmaXh0dXJl.eyJmaXh0dXJl.c3ludGhldGlj'],
  ])('rejects %s in an arbitrary metadata string', (_label, value) => {
    expect(() => memorySafeJson({ nested: [{ note: value }] })).toThrow(
      expect.objectContaining({ code: 'SECRET_REJECTED' }),
    )
  })

  it('rejects credential-like object keys and pre-redacted credential fields', () => {
    for (const value of [
      { [secret]: 'placeholder' },
      { 'https://fixture:synthetic@example.test': 'placeholder' },
      { password: '[REDACTED]' },
    ])
      expect(() => memorySafeJson(value)).toThrow(
        expect.objectContaining({ code: 'SECRET_REJECTED' }),
      )
  })
})

describe('restored memory never republishes legacy unsafe values', () => {
  it.each(['active', 'archived', 'superseded'] as const)(
    'rejects credential metadata even in %s records without rewriting history',
    (status) => {
      const { record, state } = fixture()
      rejectedRestore(
        {
          ...state,
          memories: {
            [record.id]: { ...record, status, metadata: { note: secret } },
          },
        },
        'SECRET_REJECTED',
      )
    },
  )

  it('rejects historical after-images even when the latest memory is clean', () => {
    const { record, state } = fixture()
    const events = state.events.map((event) =>
      event.changes.memories?.[record.id]
        ? {
            ...event,
            changes: {
              ...event.changes,
              memories: { [record.id]: { ...record, content: secret } },
            },
          }
        : event,
    )
    rejectedRestore({ ...state, events }, 'SECRET_REJECTED')
  })

  it('rejects credential-like memory event payloads', () => {
    const { state } = fixture()
    const events = state.events.map((event) =>
      event.type === 'MEMORY_CREATED'
        ? { ...event, payload: { ...event.payload, note: secret } }
        : event,
    )
    rejectedRestore({ ...state, events }, 'SECRET_REJECTED')
  })

  it('rejects legacy ordinary trust escalation retained in history', () => {
    const { record, state } = fixture()
    const escalated: MemoryRecord = {
      ...record,
      trust: 'observed',
      revision: 2,
    }
    const last = state.events.at(-1)!
    rejectedRestore(
      {
        ...state,
        memories: { [record.id]: escalated },
        events: [
          ...state.events,
          {
            ...last,
            type: 'MEMORY_UPDATED',
            changes: { memories: { [record.id]: escalated } },
          },
        ],
      },
      'INVALID_TRUST',
    )
  })

  it('rejects a restored source-laundering supersession chain', () => {
    const { record, state } = fixture()
    const replacement: MemoryRecord = {
      ...record,
      id: 'laundered-source',
      source: { kind: 'manager', id: ids.manager },
      supersedesId: record.id,
    }
    rejectedRestore(
      {
        ...state,
        memories: {
          [record.id]: {
            ...record,
            status: 'superseded',
            supersededById: replacement.id,
          },
          [replacement.id]: replacement,
        },
      },
      'INVALID_TRUST',
    )
  })

  it.each([
    null,
    undefined,
    false,
    {},
    {
      agentId: ids.manager,
      evidence: 'Explicit fixture evidence.',
      at: 'invalid',
    },
  ])(
    'rejects a verified label lacking a valid verification assertion (%#)',
    (verification) => {
      const { record, state } = fixture()
      rejectedRestore(
        {
          ...state,
          memories: {
            [record.id]: {
              ...record,
              trust: 'verified',
              verification: verification as MemoryRecord['verification'],
            },
          },
        },
        verification === undefined
          ? 'INVALID_MEMORY'
          : verification && Object.keys(verification).length === 0
            ? 'INVALID_INPUT'
            : 'INVALID_TRUST',
      )
    },
  )

  it('restores valid large records and histories after grants are revoked', () => {
    const { runtime, repositories, record } = fixture()
    const next = repositories[ids.workerA].supersede(record.id, 1, {
      scope: record.scope,
      source: record.source,
      type: record.type,
      trust: record.trust,
      content: 'a'.repeat(3900),
      reason: record.reason,
      rationale: record.rationale,
    })
    const updated = repositories[ids.workerA].update(next.id, 1, {
      metadata: { note: 'b'.repeat(7800) },
    })
    const state = runtime.getSnapshot()
    const restored = createOfficeRuntime({
      repository: { read: () => state, write: vi.fn() },
    })
    expect(restored.getSnapshot().memories[updated.id]).toEqual(updated)
    expect(restored.getSnapshot().events).toEqual(state.events)
    expect(() =>
      new InMemoryMemoryRepository(restored, ids.workerA).get(updated.id),
    ).toThrow(expect.objectContaining({ code: 'MEMORY_ACCESS_DENIED' }))
  })

  it('accepts valid verification and retrieval/context history', () => {
    const { runtime, repositories, record } = fixture()
    repositories[ids.manager].update(record.id, 1, {
      trust: 'verified',
      verificationEvidence:
        'Authorized reviewer explicitly checked this fixture.',
    })
    repositories[ids.workerA].get(record.id)
    repositories[ids.workerA].buildContext({ taskId: ids.laterTask })
    const state = runtime.getSnapshot()
    const restored = createOfficeRuntime({
      repository: { read: () => state, write: vi.fn() },
      memoryPolicy: memoryPreviewPolicy,
    })
    expect(restored.getSnapshot()).toEqual(state)
  })
})

describe('context boundaries validate the records they assemble', () => {
  it('rejects unsafe legacy records in direct context construction and serialization', () => {
    const { state, record } = fixture()
    const unsafe = { ...record, metadata: { note: secret } }
    const altered = { ...state, memories: { [record.id]: unsafe } }
    expect(() =>
      buildMemoryContext(
        altered,
        memoryPreviewPolicy,
        ids.workerA,
        { taskId: ids.laterTask },
        now,
      ),
    ).toThrow(expect.objectContaining({ code: 'SECRET_REJECTED' }))
    expect(() =>
      serializeMemoryContext(ids.workerA, ids.laterTask, ids.project, [unsafe]),
    ).toThrow(expect.objectContaining({ code: 'SECRET_REJECTED' }))
    expect(state.memories[record.id]).toBe(record)
  })
})
