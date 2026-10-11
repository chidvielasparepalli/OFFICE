// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createProviderPreviewSession } from './providerSession'
import { parsePreviewAction } from './plugin'
import { IDS } from './fixtures'
import { seatedWorkstationAnchor } from '../../src/office/characterMotion'
import type { ProviderPreviewScenario } from '../../src/dev/toolPreviewProtocol'

const sessions: Awaited<ReturnType<typeof createProviderPreviewSession>>[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()))
})
async function prepare(scenario: ProviderPreviewScenario) {
  const session = await createProviderPreviewSession()
  sessions.push(session)
  await session.action({ action: 'provider-prepare', scenario })
  const state = session.runtime.getSnapshot()
  const worker = state.agents[IDS.research]
  const desk = state.workstations[worker.workstationId!]
  await session.action({
    action: 'feedback',
    command: {
      type: 'arrive',
      agentId: worker.id,
      intentId: worker.destination!.id,
      position: seatedWorkstationAnchor(desk),
      headingRadians: desk.headingRadians,
    },
  })
  return session
}
describe('host-only deterministic provider preview', () => {
  it('performs no call on connect, then explicitly executes and separately captures artifact and unverified memory', async () => {
    const session = await prepare('success')
    expect(
      Object.keys(session.runtime.getSnapshot().providerRequests),
    ).toHaveLength(0)
    await session.action({ action: 'provider-execute' })
    const snapshot = session.snapshot()
    const request = Object.values(snapshot.state.providerRequests)[0]
    expect(request).toMatchObject({
      status: 'succeeded',
      disposition: 'charged',
      actualMicros: 80,
    })
    expect(snapshot.state.tasks[snapshot.taskId!].status).toBe('in_progress')
    expect(Object.keys(snapshot.state.artifacts)).toHaveLength(0)
    expect(Object.keys(snapshot.state.memories)).toHaveLength(0)
    await session.action({ action: 'provider-artifact' })
    await session.action({ action: 'provider-memory' })
    const captured = session.runtime.getSnapshot()
    expect(Object.values(captured.artifacts)[0]).toMatchObject({
      status: 'completed',
      verifiedByQA: null,
      source: { kind: 'tool', executionId: snapshot.executionId },
    })
    expect(Object.values(captured.memories)[0]).toMatchObject({
      trust: 'unverified',
      verification: null,
      source: { kind: 'tool', id: snapshot.executionId },
    })
    expect(
      JSON.stringify(session.snapshot()).includes(
        'phase11-host-only-synthetic-value',
      ),
    ).toBe(false)
    expect(JSON.stringify(session.snapshot()).includes('preview-only')).toBe(
      false,
    )
    await session.action({ action: 'complete' })
    expect(session.snapshot().state.tasks[snapshot.taskId!].status).toBe(
      'completed',
    )
    expect(session.snapshot().state.agents[IDS.manager].kind).toBe('manager')
  })
  it.each([
    ['denied', 'PROVIDER_PERMISSION_DENIED'],
    ['budget', 'BUDGET_EXCEEDED'],
    ['unavailable', 'PROVIDER_UNAVAILABLE'],
    ['all-unavailable', 'PROVIDER_UNAVAILABLE'],
    ['missing-credential', 'CREDENTIAL_UNAVAILABLE'],
    ['unknown-provider', 'UNKNOWN_PROVIDER'],
  ] as const)(
    'rejects %s without spending or automatic captures',
    async (scenario, code) => {
      const session = await prepare(scenario)
      await session.action({ action: 'provider-execute' })
      const state = session.runtime.getSnapshot()
      const request = Object.values(state.providerRequests)[0]
      expect(request).toMatchObject({
        status: 'denied',
        disposition: 'denied',
        errorCode: code,
      })
      expect(
        state.creditLedger.every(
          (entry) => entry.chargedMicros === 0 && entry.reservedMicros === 0,
        ),
      ).toBe(true)
      expect(Object.keys(state.artifacts)).toHaveLength(0)
      expect(Object.keys(state.memories)).toHaveLength(0)
      expect(state.tasks[session.snapshot().taskId!].status).toBe('blocked')
      await expect(session.action({ action: 'complete' })).rejects.toThrow(
        'successful provider result',
      )
    },
  )
  it('routes only explicit approved fallback and records actual selected provider', async () => {
    const session = await prepare('fallback')
    await session.action({ action: 'provider-execute' })
    expect(
      Object.values(session.runtime.getSnapshot().providerRequests)[0],
    ).toMatchObject({
      requestedProviderId: 'fixture-unavailable',
      selectedProviderId: 'fixture-alternate',
      status: 'succeeded',
      fallbackReasons: ['PROVIDER_UNAVAILABLE'],
    })
  })
  it('retains uncertain failure liability and rejects unsafe output without storing or leaking it', async () => {
    const failed = await prepare('failed')
    await failed.action({ action: 'provider-execute' })
    expect(
      Object.values(failed.runtime.getSnapshot().providerRequests)[0],
    ).toMatchObject({
      status: 'failed',
      disposition: 'unknown',
      actualMicros: null,
    })
    const unsafe = await prepare('unsafe-response')
    await unsafe.action({ action: 'provider-execute' })
    const state = unsafe.runtime.getSnapshot()
    expect(Object.values(state.providerRequests)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_OUTPUT_INVALID',
      disposition: 'charged',
      actualMicros: 80,
    })
    expect(
      JSON.stringify(unsafe.snapshot()).includes(
        'phase11-host-only-synthetic-value',
      ),
    ).toBe(false)
    expect(Object.keys(state.memories)).toHaveLength(0)
    expect(Object.keys(state.artifacts)).toHaveLength(0)
    await expect(
      unsafe.action({ action: 'provider-artifact' }),
    ).rejects.toThrow()
  })
  it('rejects browser authority, ordinary tools actions, stale feedback and execution before arrival', async () => {
    for (const input of [
      { action: 'provider-execute', input: { prompt: 'arbitrary' } },
      { action: 'provider-prepare', scenario: 'success', secret: 'synthetic' },
      { action: 'provider-prepare', scenario: 'not-supported' },
      { action: 'provider-artifact', grants: ['network'] },
    ])
      expect(() => parsePreviewAction(input)).toThrow()
    const session = await createProviderPreviewSession()
    sessions.push(session)
    await session.action({ action: 'provider-prepare', scenario: 'success' })
    await expect(
      session.action({ action: 'provider-execute' }),
    ).rejects.toThrow('reach')
    await expect(
      session.action({ action: 'execute', operation: 'terminal' }),
    ).rejects.toThrow('named provider')
    await expect(
      session.action({
        action: 'feedback',
        command: {
          type: 'arrive',
          agentId: IDS.research,
          intentId: 'stale',
          position: [0, 0, 0],
          headingRadians: 0,
        },
      }),
    ).rejects.toThrow('current host intent')
  })
})
