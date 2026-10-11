import { afterEach, describe, expect, it } from 'vitest'
import { createQAPreviewSession, QA_PREVIEW as ids } from '../dev/qaFixtures'
import { InMemoryMemoryRepository } from '../memory/InMemoryMemoryRepository'
import {
  createOfficeRuntime,
  InMemoryOfficeRuntimeRepository,
} from './officeRuntime'
import type { RuntimeCommand } from './runtimeTypes'

const sessions: ReturnType<typeof createQAPreviewSession>[] = []
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()))
async function prepared(failed = false) {
  const session = createQAPreviewSession()
  sessions.push(session)
  session.connect()
  await session.begin()
  if (failed) {
    await session.write(false)
    session.finish()
    await session.runQA()
  }
  return session
}
function rejected(
  session: Awaited<ReturnType<typeof prepared>>,
  command: RuntimeCommand,
) {
  const before = session.runtime.getSnapshot()
  expect(session.runtime.dispatch(command).ok).toBe(false)
  expect(session.runtime.getSnapshot()).toBe(before)
}
describe('canonical QA transaction invariants', () => {
  it('does not run QA on unfinished work or emit success without recorded evidence', async () => {
    const s = await prepared()
    rejected(s, { type: 'startQA', qaId: ids.qa, verifierAgentId: ids.workerB })
    rejected(s, { type: 'completeQA', qaId: ids.qa })
    s.finish()
    s.issue({ type: 'startQA', qaId: ids.qa, verifierAgentId: ids.workerB })
    s.issue({ type: 'completeQA', qaId: ids.qa })
    expect(s.latest()?.status).toBe('blocked')
    expect(
      s.runtime
        .getSnapshot()
        .events.some((event) => event.type === 'QA_PASSED'),
    ).toBe(false)
  })
  it('never accepts a Manager or unqualified worker as QA verifier', async () => {
    const s = await prepared()
    s.finish()
    for (const verifierAgentId of [ids.manager, ids.workerA])
      rejected(s, { type: 'startQA', qaId: ids.qa, verifierAgentId })
  })
  it('blocks generic assignment from bypassing repair capabilities or Manager identity', async () => {
    const s = await prepared(true)
    for (const agentId of [ids.manager, ids.workerB])
      rejected(s, { type: 'assignTask', taskId: s.repair()!.taskId, agentId })
    s.issue({
      type: 'assignTask',
      taskId: s.repair()!.taskId,
      agentId: ids.workerA,
    })
    expect(s.repair()?.status).toBe('assigned')
    s.issue({ type: 'startTask', taskId: s.repair()!.taskId })
    expect(s.repair()?.status).toBe('in_progress')
    expect(s.runtime.getSnapshot().agents[ids.workerA].status).toBe('repair')
  })
  it('canonical repair failure releases repair posture and records failure history', async () => {
    const s = await prepared(true)
    s.assignRepair()
    s.issue({
      type: 'failTask',
      taskId: s.repair()!.taskId,
      reason: 'Explicit development failure.',
    })
    expect(s.repair()?.status).toBe('failed')
    expect(s.runtime.getSnapshot().agents[ids.workerA].status).toBe('blocked')
    expect(
      s.runtime
        .getSnapshot()
        .events.some((event) => event.type === 'REPAIR_FAILED'),
    ).toBe(true)
    rejected(s, { type: 'recheckQA', qaId: ids.qa })
  })
  it('cannot reset retry policy by attaching QA to an existing source or its repair task', async () => {
    const s = await prepared(true)
    const original = s.latest()!
    for (const taskId of [ids.task, s.repair()!.taskId])
      rejected(s, {
        type: 'requestQA',
        request: {
          qaId: 'replacement',
          taskId,
          requestedBy: ids.manager,
          scope: original.scope,
          checks: original.checks,
          repairCapabilities: original.repairCapabilities,
          maxRepairAttempts: 5,
        },
      })
    s.issue({ type: 'requestRepair', qaId: ids.qa })
    expect(Object.keys(s.runtime.getSnapshot().repairRequests)).toHaveLength(1)
  })
  it('cannot attach nested QA to the inspection task', async () => {
    const s = await prepared()
    s.finish()
    s.issue({ type: 'startQA', qaId: ids.qa, verifierAgentId: ids.workerB })
    const qa = s.latest()!
    rejected(s, {
      type: 'requestQA',
      request: {
        taskId: qa.inspectionTaskId!,
        requestedBy: ids.manager,
        scope: qa.scope,
        checks: qa.checks,
        repairCapabilities: qa.repairCapabilities,
      },
    })
  })
  it('cannot reopen a cancelled workflow through QA recheck or repair assignment', async () => {
    const s = await prepared(true)
    s.issue({
      type: 'cancelRequest',
      managerId: ids.manager,
      requestId: ids.request,
      reason: 'Explicit operator stop.',
    })
    rejected(s, { type: 'recheckQA', qaId: ids.qa })
    rejected(s, { type: 'assignRepair', repairId: s.repair()!.repairId })
    rejected(s, { type: 'startTask', taskId: s.repair()!.taskId })
  })
  it('disconnect cancels pending inspection with no passing result', async () => {
    const s = await prepared()
    s.finish()
    s.issue({ type: 'startQA', qaId: ids.qa, verifierAgentId: ids.workerB })
    const inspectionId = s.latest()!.inspectionTaskId!
    s.issue({ type: 'disconnect' })
    expect(s.latest()?.status).toBe('cancelled')
    expect(s.runtime.getSnapshot().tasks[inspectionId].status).toBe('cancelled')
    expect(s.runtime.getSnapshot().tasks[ids.task].verification?.status).toBe(
      'cancelled',
    )
  })
  it('does not clobber a source worker already assigned unrelated work', async () => {
    const s = await prepared()
    await s.write(false)
    s.finish()
    s.issue({
      type: 'createTask',
      task: {
        id: 'unrelated',
        title: 'Other work',
        description: 'Explicit later work.',
      },
    })
    s.issue({ type: 'assignTask', taskId: 'unrelated', agentId: ids.workerA })
    s.issue({ type: 'startTask', taskId: 'unrelated' })
    await s.runQA()
    expect(s.runtime.getSnapshot().agents[ids.workerA].currentTaskId).toBe(
      'unrelated',
    )
    expect(s.runtime.getSnapshot().agents[ids.workerA].status).toBe('working')
    rejected(s, {
      type: 'assignRepair',
      repairId: s.repair()!.repairId,
      agentId: ids.workerA,
    })
  })
  it('freezes results and retains failed attempts across repository restoration', async () => {
    const s = await prepared(true)
    const failure = s.latest()!
    s.assignRepair()
    await s.write(true)
    s.finish()
    s.recheck()
    await s.runQA()
    expect(s.runtime.getSnapshot().qaRequests[failure.qaId]).toBe(failure)
    expect(Object.isFrozen(failure.result!.findings)).toBe(true)
    const restored = createOfficeRuntime({
      repository: new InMemoryOfficeRuntimeRepository(s.runtime.getSnapshot()),
    }).getSnapshot()
    expect(restored.qaRequests[failure.qaId].status).toBe('failed')
    expect(restored.tasks[ids.task].verification?.status).toBe('verified')
    expect(Object.values(restored.repairRequests)[0].status).toBe('completed')
  })
  it('accepted QA and repair events carry after-images and matching activity', async () => {
    const s = await prepared(true)
    s.assignRepair()
    await s.write(true)
    s.finish()
    s.recheck()
    await s.runQA()
    const state = s.runtime.getSnapshot()
    const events = state.events.filter((event) =>
      /^(QA_|REPAIR_)/u.test(event.type),
    )
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'QA_REQUESTED',
        'QA_STARTED',
        'QA_FAILED',
        'REPAIR_REQUESTED',
        'REPAIR_ASSIGNED',
        'REPAIR_STARTED',
        'REPAIR_COMPLETED',
        'QA_PASSED',
      ]),
    )
    for (const event of events)
      expect(
        state.activities.some((activity) => activity.eventId === event.id),
      ).toBe(true)
    expect(
      events.find((event) => event.type === 'QA_FAILED')?.changes.qaRequests?.[
        ids.qa
      ].status,
    ).toBe('failed')
  })
})

describe('QA preserves the Phase 8 memory boundary', () => {
  it('rejects credential-like check metadata before QA persistence or events', async () => {
    const s = await prepared()
    const original = s.latest()!
    const before = s.runtime.getSnapshot()
    const result = s.runtime.dispatch({
      type: 'requestQA',
      request: {
        taskId: ids.task,
        requestedBy: ids.manager,
        scope: original.scope,
        repairCapabilities: ['development.document'],
        checks: [
          {
            ...original.checks[0],
            input: { nested: { password: 'SYNTHETIC_TEST_ONLY' } },
          },
        ],
      },
    })
    expect(result.ok).toBe(false)
    expect(s.runtime.getSnapshot()).toBe(before)
    expect(JSON.stringify(before)).not.toContain('SYNTHETIC_TEST_ONLY')
  })
  it('a passing recheck grants no memory trust, permissions or secret exception', async () => {
    const s = await prepared(true)
    s.assignRepair()
    await s.write(true)
    s.finish()
    s.recheck()
    await s.runQA()
    s.lesson()
    const memory = new InMemoryMemoryRepository(s.runtime, ids.workerA)
    const original = s.runtime.getSnapshot().memories[ids.lesson]
    expect(original.trust).toBe('unverified')
    expect(original.source.kind).toBe('tool')
    const before = s.runtime.getSnapshot()
    expect(() =>
      memory.update(ids.lesson, original.revision, {
        trust: 'verified',
        verificationEvidence: 'QA passed.',
      }),
    ).toThrow()
    expect(() =>
      memory.update(ids.lesson, original.revision, {
        metadata: { nested: { password: 'SYNTHETIC_TEST_ONLY' } },
      }),
    ).toThrow()
    expect(s.runtime.getSnapshot()).toBe(before)
    const context = s.context()
    expect(JSON.stringify(context)).not.toContain('SYNTHETIC_TEST_ONLY')
    expect(s.runtime.getSnapshot().memories[ids.lesson].trust).toBe(
      'unverified',
    )
    expect(s.runtime.getSnapshot().memories[ids.lesson].source).toEqual(
      original.source,
    )
  })
})
