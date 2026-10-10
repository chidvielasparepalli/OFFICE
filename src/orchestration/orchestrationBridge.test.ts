import { expect, it } from 'vitest'
import {
  managerDevelopmentPlan,
  managerRegistrations,
  MANAGER_PREVIEW_IDS,
} from '../dev/managerFixtures'
import {
  createCharacterMotion,
  seatedWorkstationAnchor,
  type CharacterClip,
} from '../office/characterMotion'
import type { AgentSpatialSnapshot } from '../office/officeState'
import { presentedAgents } from '../office/workerPresentation'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import { createOfficeRuntimeBridge } from '../runtime/officeRuntimeBridge'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import { ManagerOrchestrator } from './ManagerOrchestrator'

it('connects actual Manager planning and dependent dispatch to the existing distinct character behaviors', async () => {
  const runtime = createOfficeRuntime({ now: () => '2026-10-09T12:00:00.000Z' })
  function send(command: RuntimeCommand) {
    const result = runtime.dispatch(command)
    if (!result.ok)
      throw new Error(`${result.error.code}: ${result.error.message}`)
  }
  send({ type: 'connect' })
  for (const command of managerRegistrations()) send(command)
  const bridge = createOfficeRuntimeBridge()
  const views = new Map<string, AgentSpatialSnapshot>()
  let projected = bridge.project(runtime.getSnapshot(), views)!
  const controllers = new Map(
    presentedAgents(projected).map((agent) => [
      agent.id,
      createCharacterMotion(agent),
    ]),
  )
  const clips = new Map(
    [...controllers.keys()].map((id) => [id, new Set<CharacterClip>()]),
  )
  const diagnostics: string[] = []
  const eventKeys = new Map<string, string>()
  const ids = MANAGER_PREVIEW_IDS

  function capture(id: string) {
    const frame = controllers.get(id)!.advance(0)
    const agent = projected.agents[id]
    clips.get(id)!.add(frame.clip)
    if (frame.diagnostic) diagnostics.push(`${id}: ${frame.diagnostic}`)
    if (id === ids.manager) {
      expect(frame.headbandVisible).toBe(false)
      expect(frame.headbandProgress).toBe(0)
      expect(frame.workingHard).toBe(false)
    }
    const snapshot: AgentSpatialSnapshot = {
      ...frame,
      agentId: id,
      position: [...frame.position],
      workstation: agent.workstation ?? null,
      destination: agent.motion?.destination ?? null,
      movementState: frame.paused
        ? 'paused'
        : frame.moving
          ? 'moving'
          : frame.phase === 'turning'
            ? 'turning'
            : 'stationary',
      speedMetersPerSecond: frame.moving
        ? frame.walkingSpeedMetersPerSecond
        : 0,
      collaborationTargetId: null,
    }
    views.set(id, snapshot)
  }
  for (const id of controllers.keys()) capture(id)

  function project() {
    for (let pass = 0; pass < 12; pass++) {
      projected = bridge.project(runtime.getSnapshot(), views)!
      for (const agent of presentedAgents(projected)) {
        controllers.get(agent.id)!.update(agent)
        capture(agent.id)
      }
      const feedback = bridge.drainFeedback()
      if (!feedback.length) return
      for (const command of feedback) send(command)
    }
    throw new Error('Feedback did not settle')
  }
  function step() {
    for (const [id, controller] of controllers) {
      controller.advance(0.05)
      capture(id)
    }
    for (const [id, snapshot] of views) {
      const key = `${runtime.getSnapshot().agents[id].status}:${snapshot.phase}:${snapshot.motionId}:${snapshot.completedMotionId}:${snapshot.diagnostic}`
      if (eventKeys.get(id) === key) continue
      eventKeys.set(id, key)
      bridge.onSpatialEvent(runtime.getSnapshot(), snapshot, views)
      for (const command of bridge.drainFeedback()) send(command)
    }
    project()
  }
  function until(predicate: () => boolean) {
    project()
    for (let frame = 0; frame < 2400 && !predicate(); frame++) step()
    expect(predicate()).toBe(true)
  }

  let resolveProposal!: (proposal: unknown) => void
  const orchestrator = new ManagerOrchestrator({
    runtime,
    managerId: ids.manager,
    planner: {
      plan: () =>
        new Promise((resolve) => {
          resolveProposal = resolve
        }),
    },
  })
  orchestrator.start()
  try {
    expect(
      orchestrator.receiveRequest({
        requestId: 'connected',
        title: 'Explicit connected development request',
        description: 'Verify the state-to-animation boundary.',
        requestedBy: 'test-user',
        priority: 'normal',
        constraints: ['No task execution'],
      }).ok,
    ).toBe(true)
    const planning = orchestrator.planRequest('connected')
    until(() => controllers.get(ids.manager)!.advance(0).clip === 'seated_work')
    expect(runtime.getSnapshot().requests.connected.status).toBe('planning')
    expect(
      runtime.getSnapshot().agents[ids.researcher].currentTaskId,
    ).toBeNull()
    const calmTime = controllers.get(ids.manager)!.advance(0).clipTimeSeconds
    for (let index = 0; index < 10; index++) step()
    expect(
      controllers.get(ids.manager)!.advance(0).clipTimeSeconds,
    ).toBeGreaterThan(calmTime)

    resolveProposal(
      managerDevelopmentPlan(runtime.getSnapshot().requests.connected),
    )
    expect((await planning).ok).toBe(true)
    expect(orchestrator.dispatchReady('connected').dispatchedTaskIds).toEqual([
      'connected:research',
    ])
    until(
      () =>
        controllers.get(ids.researcher)!.advance(0).workingHard &&
        runtime.getSnapshot().agents[ids.researcher].destination === null,
    )
    const researcher = controllers.get(ids.researcher)!.advance(0)
    const deskId = runtime.getSnapshot().agents[ids.researcher].workstationId!
    expect(researcher.position).toEqual(
      seatedWorkstationAnchor(runtime.getSnapshot().workstations[deskId]),
    )
    expect(researcher.headbandVisible).toBe(true)
    expect([...clips.get(ids.researcher)!]).toEqual(
      expect.arrayContaining([
        'walk',
        'sit_down',
        'headband_on',
        'seated_work_hard',
      ]),
    )
    expect(
      runtime.getSnapshot().tasks['connected:research'].progressPercent,
    ).toBe(0)
    expect(runtime.getSnapshot().tasks['connected:implementation'].status).toBe(
      'waiting',
    )

    send({ type: 'completeTask', taskId: 'connected:research' })
    until(
      () => controllers.get(ids.researcher)!.advance(0).clip === 'seated_idle',
    )
    expect(controllers.get(ids.researcher)!.advance(0).headbandProgress).toBe(0)
    expect(clips.get(ids.researcher)!.has('headband_off')).toBe(true)
    expect(
      runtime.getSnapshot().tasks['connected:implementation'],
    ).toMatchObject({
      status: 'queued',
      assignedAgentId: null,
      startedAt: null,
    })
    expect(runtime.getSnapshot().agents[ids.implementer].status).toBe(
      'sleeping',
    )
    expect(controllers.get(ids.implementer)!.advance(0).clip).toBe(
      'seated_sleep',
    )
    expect(controllers.get(ids.manager)!.advance(0).clip).toBe('seated_work')

    expect(orchestrator.dispatchReady('connected').dispatchedTaskIds).toEqual([
      'connected:implementation',
    ])
    until(() => controllers.get(ids.implementer)!.advance(0).workingHard)
    send({ type: 'completeTask', taskId: 'connected:implementation' })
    until(
      () =>
        controllers.get(ids.implementer)!.advance(0).clip === 'seated_idle' &&
        controllers.get(ids.manager)!.advance(0).clip === 'seated_idle',
    )
    expect(runtime.getSnapshot().requests.connected.status).toBe('completed')
    expect([...clips.get(ids.manager)!]).not.toEqual(
      expect.arrayContaining(['headband_on']),
    )
    expect(
      [...clips.get(ids.manager)!].some((clip) =>
        ['headband_on', 'headband_off', 'seated_work_hard'].includes(clip),
      ),
    ).toBe(false)
    expect(diagnostics).toEqual([])
  } finally {
    orchestrator.dispose()
  }
})
