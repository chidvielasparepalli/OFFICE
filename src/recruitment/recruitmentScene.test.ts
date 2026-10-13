import { describe, expect, it } from 'vitest'
import { createRecruitmentScene } from './recruitmentScene'
import type { RecruitmentSession, RecruitmentSpec } from './recruitmentTypes'
import { emptyRealtimeView } from '../realtime/realtimeCodec'
import type { AgentSpatialSnapshot } from '../office/officeState'
import { createCharacterMotion } from '../office/characterMotion'

const spec: RecruitmentSpec = {
  name: 'Synthetic candidate',
  role: 'Researcher',
  departmentId: 'research',
  mission: 'Evaluate a synthetic criterion',
  responsibilities: ['Research'],
  instructions: 'Stay within approved scope',
  personality: 'Professional',
  skills: [
    {
      id: 'finding',
      description: 'Explain one finding',
      prompt: 'Name the synthetic fixture',
      expectedIncludes: ['fixture'],
      mandatory: true,
    },
  ],
  modelId: 'gpt-6-astra',
  providerId: 'openai',
  adapterMode: 'mock-success',
  toolIds: ['provider.invoke'],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: 'manager',
  budgetMicros: 1000,
  maxOutputUnits: 128,
}
const session = (): RecruitmentSession => ({
  recruitmentId: 'recruitment-test',
  candidateId: 'candidate-test',
  requestedBy: 'ceo',
  state: 'candidate_arriving',
  proposals: [
    { version: 1, spec, createdAt: '2026-10-13T00:00:00Z', createdBy: 'ceo' },
  ],
  approvedVersion: 1,
  approvals: [],
  assessments: [],
  failures: [],
  attempt: 1,
  maxAttempts: 3,
  scene: {
    phase: 'arrival',
    intentId: 'arrival-1',
    from: [0, 0, 17],
    to: [0, 0, 10],
    headingRadians: Math.PI,
    arrived: false,
  },
  workstationId: null,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
})
const state = () => ({
  ...emptyRealtimeView().state,
  recruitments: { 'recruitment-test': session() },
})

describe('recruitment scene presentation', () => {
  it('renders one labeled file-carrying candidate without registering an employee and reuses duplicate routes', () => {
    const project = createRecruitmentScene(),
      snapshot = state()
    const first = project(snapshot)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      id: 'candidate-test',
      kind: 'standard-worker',
      status: 'walking',
      recruitmentFile: true,
    })
    expect(first[0].candidateLabel).toContain('SIMULATION')
    expect(first[0].motion?.points).toEqual([
      [0, 0, 17],
      [0, 0, 10],
    ])
    expect(project(snapshot)[0].motion).toBe(first[0].motion)
    expect(snapshot.agents).toEqual({})
    expect(snapshot.employees).toEqual({})
    const motion = createCharacterMotion(first[0])
    expect(motion.advance(0.5).headbandVisible).toBe(false)
  })
  it('uses authoritative interview/pending state and never shows skills rejection for a technical failure', () => {
    const snapshot = state(),
      project = createRecruitmentScene()
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      state: 'interview_in_progress',
      scene: { ...session().scene!, phase: 'interview', arrived: true },
    }
    expect(project(snapshot)[0]).toMatchObject({
      status: 'collaborating',
      position: [0, 0, 10],
      motion: undefined,
    })
    snapshot.recruitments['recruitment-test'] = {
      ...snapshot.recruitments['recruitment-test'],
      state: 'technical_failure',
      scene: { ...session().scene!, phase: 'waiting', arrived: true },
    }
    expect(project(snapshot)[0]).toMatchObject({
      status: 'queued',
      position: [0, 0, 10],
      motion: undefined,
    })
    expect(project(snapshot)[0].candidateLabel).toContain('technical failure')
  })
  it('routes rejection or cancellation to the exit and removes only host-confirmed departed visitors', () => {
    const snapshot = state(),
      project = createRecruitmentScene()
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      state: 'rejected',
      scene: {
        ...session().scene!,
        phase: 'exit',
        intentId: 'exit-1',
        from: [0, 0, 10],
        to: [0, 0, 17],
      },
    }
    expect(project(snapshot)[0].motion?.points).toEqual([
      [0, 0, 10],
      [0, 0, 17],
    ])
    snapshot.recruitments['recruitment-test'] = {
      ...snapshot.recruitments['recruitment-test'],
      scene: {
        ...snapshot.recruitments['recruitment-test'].scene!,
        phase: 'departed',
        arrived: true,
      },
    }
    expect(project(snapshot)).toEqual([])
  })
  it('replans an interrupted candidate from current presentation position without teleporting', () => {
    const snapshot = state(),
      project = createRecruitmentScene()
    const original = project(snapshot)[0],
      controller = createCharacterMotion(original)
    let frame = controller.advance(1)
    frame = controller.advance(2)
    const position = [...frame.position] as const
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      state: 'cancelled',
      scene: {
        ...session().scene!,
        phase: 'exit',
        intentId: 'cancel-exit',
        from: [0, 0, 10],
        to: [0, 0, 17],
      },
    }
    const view = { position } as AgentSpatialSnapshot
    const replacement = project(
      snapshot,
      new Map([['candidate-test', view]]),
    )[0]
    expect(replacement.motion!.points).toContainEqual(position)
    controller.update(replacement)
    expect(controller.advance(0).position).toEqual(position)
    expect(replacement.motion!.points.at(-1)).toEqual([0, 0, 17])
  })
  it('returns a cancelled candidate safely when its old walk advances before replacement props commit', () => {
    const snapshot = state(),
      project = createRecruitmentScene(),
      controller = createCharacterMotion(project(snapshot)[0])
    for (let frame = 0; frame < 25; frame++) controller.advance(0.1)
    const position = [...controller.advance(0).position] as const
    const view = { position } as AgentSpatialSnapshot
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      state: 'cancelled',
      scene: {
        ...session().scene!,
        phase: 'exit',
        intentId: 'cancelled-late-commit',
        to: [0, 0, 17],
      },
    }
    const replacement = project(
      snapshot,
      new Map([['candidate-test', view]]),
    )[0]
    const beforeCommit = [...controller.advance(0.1).position]
    controller.update(replacement)
    expect(controller.advance(0).position).toEqual(beforeCommit)
    expect(controller.advance(0).diagnostic).toBeNull()
    for (let frame = 0; frame < 80; frame++) controller.advance(0.1)
    expect(controller.advance(0).position).toEqual([0, 0, 17])
  })
  it('restores a visitor from the committed scene and does not duplicate an activated runtime employee', () => {
    const snapshot = state()
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      scene: { ...session().scene!, arrived: true },
    }
    expect(createRecruitmentScene()(snapshot)[0].position).toEqual([0, 0, 10])
    const projected = createRecruitmentScene()({
      ...snapshot,
      agents: { 'candidate-test': { id: 'candidate-test' } as never },
    })
    expect(projected).toEqual([])
  })
  it('never turns a historically hired employee back into a candidate after its active agent is removed', () => {
    const snapshot = state()
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      state: 'hired',
      scene: { ...session().scene!, phase: 'workstation', arrived: true },
    }
    expect(snapshot.agents).toEqual({})
    expect(createRecruitmentScene()(snapshot)).toEqual([])
  })
  it('rejects unavailable destinations instead of inventing a straight route', () => {
    const snapshot = state()
    snapshot.recruitments['recruitment-test'] = {
      ...session(),
      scene: { ...session().scene!, to: [40, 0, 40] },
    }
    const candidate = createRecruitmentScene()(snapshot)[0]
    expect(candidate.motion).toBeUndefined()
    expect(candidate.navigationDiagnostic).toContain('unavailable')
  })
})
