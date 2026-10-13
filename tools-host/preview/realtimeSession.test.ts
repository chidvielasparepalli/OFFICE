// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createRealtimePreviewSession } from './realtimeSession'
import { ARTIFACT_PREVIEW as ids } from '../../src/dev/artifactFixtures'
import { seatedWorkstationAnchor } from '../../src/office/characterMotion'
import { parseRealtimeAction } from './plugin'
import type { RealtimeEnvelope } from '../../src/realtime/realtimeTypes'
import type { RuntimeCommand } from '../../src/runtime/runtimeTypes'

const sessions: ReturnType<typeof createRealtimePreviewSession>[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose()
})
function session() {
  const value = createRealtimePreviewSession()
  sessions.push(value)
  return value
}
async function arrive(value: ReturnType<typeof session>) {
  const agent = value.runtime.getSnapshot().agents[ids.workerA]
  if (!agent.destination) return
  const desk = value.runtime.getSnapshot().workstations[agent.workstationId!]
  await value.action({
    action: 'feedback',
    command: {
      type: 'arrive',
      agentId: agent.id,
      intentId: agent.destination.id,
      position: seatedWorkstationAnchor(desk),
      headingRadians: desk.headingRadians,
    },
  })
}
describe('host-driven realtime development fixture', () => {
  it('acknowledges a proven delayed QA arrival without mutating completed work or accepted history', async () => {
    const value = session()
    for (const action of ['prepare', 'start'] as const)
      await value.action({ action })
    await arrive(value)
    for (const action of [
      'write',
      'artifact',
      'qa-request',
      'complete',
      'qa-run',
    ] as const)
      await value.action({ action })
    const state = value.runtime.getSnapshot()
    const qaAgent = state.agents[ids.workerB]
    const issued = state.events
      .map((event) => event.changes.agents?.[qaAgent.id]?.destination)
      .find((intent) => intent?.destinationType === 'workstation')
    expect(issued).toBeDefined()
    expect(qaAgent.destination).toBeNull()
    const desk = state.workstations[qaAgent.workstationId!]
    const command: RuntimeCommand = {
      type: 'arrive',
      agentId: qaAgent.id,
      intentId: issued!.id,
      position: seatedWorkstationAnchor(desk),
      headingRadians: desk.headingRadians,
    }
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await value.action({ action: 'feedback', command })).toContain(
        'Ignored obsolete',
      )
    expect(value.runtime.getSnapshot()).toBe(state)
    expect(value.runtime.getSnapshot().events).toBe(state.events)
    expect(value.snapshot().revision).toBe(state.revision)
    for (const invalid of [
      { ...command, agentId: ids.workerA },
      { ...command, intentId: 'invented-intent' },
    ])
      await expect(
        value.action({ action: 'feedback', command: invalid }),
      ).rejects.toThrow()
    expect(value.runtime.getSnapshot()).toBe(state)
  })
  it('treats duplicate accepted arrivals as no-ops but does not accept another agent intent', async () => {
    const value = session()
    await value.action({ action: 'prepare' })
    await value.action({ action: 'start' })
    const agent = value.runtime.getSnapshot().agents[ids.workerA]
    const desk = value.runtime.getSnapshot().workstations[agent.workstationId!]
    const command: RuntimeCommand = {
      type: 'arrive',
      agentId: agent.id,
      intentId: agent.destination!.id,
      position: seatedWorkstationAnchor(desk),
      headingRadians: desk.headingRadians,
    }
    await value.action({ action: 'feedback', command })
    const state = value.runtime.getSnapshot()
    expect(await value.action({ action: 'feedback', command })).toContain(
      'Ignored obsolete',
    )
    expect(value.runtime.getSnapshot()).toBe(state)
    await expect(
      value.action({
        action: 'feedback',
        command: { ...command, agentId: ids.manager },
      }),
    ).rejects.toThrow()
    expect(value.runtime.getSnapshot()).toBe(state)
  })
  it('keeps publication available when Manager arrival precedes worker dispatch, as in the 3D office', async () => {
    const value = session()
    await value.action({ action: 'prepare' })
    const manager = value.runtime.getSnapshot().agents[ids.manager]
    const desk =
      value.runtime.getSnapshot().workstations[manager.workstationId!]
    if (manager.destination)
      await value.action({
        action: 'feedback',
        command: {
          type: 'arrive',
          agentId: manager.id,
          intentId: manager.destination.id,
          position: seatedWorkstationAnchor(desk),
          headingRadians: desk.headingRadians,
        },
      })
    await value.action({ action: 'start' })
    expect(() => value.snapshot()).not.toThrow()
    expect(() =>
      value.subscribe(
        () => {},
        () => {},
      ),
    ).not.toThrow()
  })
  it('injects a real revision gap even when the worker used by the fault is already selected', async () => {
    const value = session()
    await value.action({
      action: 'feedback',
      command: { type: 'selectAgent', agentId: ids.workerB },
    })
    const received: RealtimeEnvelope[] = []
    value.subscribe(
      (message) => received.push(message),
      () => {},
    )
    const before = value.runtime.getSnapshot().revision
    await value.action({ action: 'gap' })
    expect(value.runtime.getSnapshot().revision).toBe(before + 2)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      kind: 'delta',
      baseRevision: before + 1,
      revision: before + 2,
    })
    expect(value.runtime.getSnapshot().selectedAgentId).toBe(ids.workerB)
  })
  it('publishes actual tool, artifact, QA and handoff updates through the one runtime', async () => {
    const value = session()
    const received: RealtimeEnvelope[] = []
    value.subscribe(
      (message) => received.push(message),
      () => {},
    )
    expect(Object.keys(value.snapshot().view.state.tasks)).toHaveLength(0)
    await value.action({ action: 'prepare' })
    await value.action({ action: 'start' })
    await arrive(value)
    await value.action({ action: 'write' })
    await value.action({ action: 'artifact' })
    await value.action({ action: 'qa-request' })
    await value.action({ action: 'complete' })
    await value.action({ action: 'qa-run' })
    await value.action({ action: 'handoff' })
    const view = value.snapshot().view
    expect(Object.values(view.state.artifacts)[0]).toMatchObject({
      status: 'verified',
      source: { kind: 'tool', agentId: ids.workerA },
    })
    expect(Object.values(view.state.qaRequests)[0].status).toBe('passed')
    expect(view.handoffs).toHaveLength(1)
    expect(view.handoffs[0].toTaskId).toBe('phase12-handoff-task')
    expect(view.notifications.length).toBeGreaterThan(0)
    expect(received.some((envelope) => envelope.kind === 'delta')).toBe(true)
    expect(view.state.agents[ids.manager].kind).toBe('manager')
    expect(view.costs.chargedMicros).toBe('0')
  })
  it('replays real envelopes without fabricating business records and closes subscriptions cleanly', async () => {
    const value = session()
    const received: RealtimeEnvelope[] = []
    let dropped = 0
    value.subscribe(
      (message) => received.push(message),
      () => {
        dropped++
      },
    )
    await value.action({ action: 'prepare' })
    const state = value.runtime.getSnapshot()
    await value.action({ action: 'duplicate' })
    await value.action({ action: 'stale' })
    expect(value.runtime.getSnapshot()).toBe(state)
    const beforeGap = received.length
    await value.action({ action: 'gap' })
    expect(value.runtime.getSnapshot().revision).toBe(state.revision + 2)
    expect(received.length).toBe(beforeGap + 1)
    await value.action({ action: 'drop' })
    expect(dropped).toBe(1)
    expect(value.getMetrics().streams).toBe(0)
  })
  it('preserves exact spatial feedback checks and accepts no browser authority or arbitrary commands', async () => {
    const value = session()
    await value.action({ action: 'prepare' })
    await value.action({ action: 'start' })
    const state = value.runtime.getSnapshot()
    await expect(
      value.action({
        action: 'feedback',
        command: {
          type: 'arrive',
          agentId: ids.workerA,
          intentId: 'unrelated-intent',
          position: [0, 0, 0],
          headingRadians: 0,
        },
      }),
    ).rejects.toThrow()
    expect(value.runtime.getSnapshot()).toBe(state)
    for (const input of [
      { action: 'prepare', principalAgentId: ids.workerA },
      { action: 'write', content: 'browser text' },
      { action: 'execute', command: 'anything' },
      {
        action: 'feedback',
        command: { type: 'completeTask', taskId: ids.task },
      },
    ])
      expect(() => parseRealtimeAction(input)).toThrow()
  })
})
