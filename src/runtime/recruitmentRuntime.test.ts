import { describe, expect, it, vi } from 'vitest'
import {
  createOfficeRuntime,
  InMemoryOfficeRuntimeRepository,
  type OfficeRuntime,
} from './officeRuntime'
import type { RuntimeCommand, RuntimeState } from './runtimeTypes'
import {
  currentProposal,
  type RecruitmentSpec,
  type RecruitmentState,
} from '../recruitment/recruitmentTypes'
import {
  copyRecruitmentPolicy,
  validateRecruitmentSpec,
} from '../recruitment/recruitmentPolicy'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'

const policy = {
  ceoIds: ['ceo'],
  managerIds: ['manager'],
  serviceIds: ['service'],
}
const spec: RecruitmentSpec = {
  name: 'Review Employee',
  role: 'Security Analyst',
  departmentId: 'security',
  mission: 'Review authorized synthetic fixtures.',
  responsibilities: ['Review only authorized material.'],
  instructions: 'Respect the approved scope.',
  personality: 'Careful',
  skills: [
    {
      id: 'review',
      description: 'Identify a fixture defect.',
      mandatory: true,
      prompt: 'Review the synthetic fixture.',
      expectedIncludes: ['unsafe'],
    },
  ],
  modelId: 'fixture-model',
  providerId: 'fixture-provider',
  toolIds: [],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: 'manager',
  budgetMicros: 1000,
  maxOutputUnits: 100,
  adapterMode: 'mock-success',
}
const issue = (runtime: OfficeRuntime, command: RuntimeCommand) => {
  const result = runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.state
}
function reject(
  runtime: OfficeRuntime,
  command: RuntimeCommand,
  code?: string,
) {
  const before = runtime.getSnapshot()
  const result = runtime.dispatch(command)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected a rejected command.')
  if (code) expect(result.error.code).toBe(code)
  expect(runtime.getSnapshot()).toBe(before)
  expect(runtime.getSnapshot().events).toBe(before.events)
}
function setup(repository = new InMemoryOfficeRuntimeRepository()) {
  const runtime = createOfficeRuntime({
    recruitmentPolicy: policy,
    repository,
    now: () => '2026-10-13T12:00:00.000Z',
  })
  if (runtime.getSnapshot().connection === 'local') return runtime
  issue(runtime, { type: 'connect' })
  issue(runtime, {
    type: 'registerDepartment',
    department: { id: 'security', name: 'Security' },
  })
  issue(runtime, {
    type: 'registerWorkstation',
    workstation: {
      id: 'desk',
      departmentId: 'security',
      position: [3, 0, 3],
      headingRadians: 0,
    },
  })
  issue(runtime, {
    type: 'registerAgent',
    agent: {
      id: 'manager',
      name: 'Manager',
      role: 'Manager',
      kind: 'manager',
      departmentId: 'security',
      position: [0, 0, 0],
      headingRadians: 0,
    },
  })
  return runtime
}
function request(runtime: OfficeRuntime, value = spec) {
  return issue(runtime, {
    type: 'requestRecruitment',
    actorId: 'ceo',
    recruitmentId: 'hire',
    candidateId: 'candidate',
    spec: value,
  })
}
function approve(runtime: OfficeRuntime, version = 1) {
  return issue(runtime, {
    type: 'decideRecruitment',
    actorId: 'ceo',
    recruitmentId: 'hire',
    version,
    decision: 'approve',
    reason: 'Approved for a local assessment.',
  })
}
function advance(
  runtime: OfficeRuntime,
  state: RecruitmentState,
  approvedVersion = 1,
) {
  return issue(runtime, {
    type: 'advanceRecruitment',
    actorId: 'service',
    recruitmentId: 'hire',
    approvedVersion,
    state,
  })
}
function assessing(runtime: OfficeRuntime, value = spec) {
  request(runtime, value)
  approve(runtime)
  for (const state of [
    'candidate_arriving',
    'interview_in_progress',
    'agent_configuration_created',
    'runtime_initializing',
    'capability_checks_running',
  ] as const)
    advance(runtime, state)
}
function interviewTask(runtime: OfficeRuntime) {
  assessing(runtime)
  issue(runtime, {
    type: 'setRecruitmentScene',
    actorId: 'service',
    recruitmentId: 'hire',
    scene: {
      phase: 'interview',
      intentId: 'interview',
      from: [-0.8, 0, 10],
      to: [-0.8, 0, 10],
      headingRadians: Math.PI / 2,
      arrived: true,
    },
  })
  issue(runtime, {
    type: 'requestMovement',
    agentId: 'manager',
    destinationType: 'waypoint',
    destinationId: 'interview:manager',
    movementReason: 'Approved interview.',
    arrivalStatus: 'collaborating',
  })
  issue(runtime, {
    type: 'arrive',
    agentId: 'manager',
    intentId: runtime.getSnapshot().agents.manager.destination!.id,
    position: [0.8, 0, 10],
    headingRadians: -Math.PI / 2,
  })
  issue(runtime, {
    type: 'createTask',
    task: {
      id: 'assessment-task',
      title: 'Approved assessment',
      metadata: { recruitmentId: 'hire' },
    },
  })
  issue(runtime, {
    type: 'assignTask',
    taskId: 'assessment-task',
    agentId: 'manager',
  })
}
function assess(
  runtime: OfficeRuntime,
  status: 'passed' | 'failed' | 'blocked' = 'passed',
  mode: 'live' | 'simulation' = 'simulation',
) {
  return issue(runtime, {
    type: 'recordRecruitmentAssessment',
    actorId: 'service',
    recruitmentId: 'hire',
    approvedVersion: 1,
    assessment: {
      testId: 'review',
      status,
      mode,
      evidence: [`Explicit ${mode} fixture assessment: ${status}.`],
    },
  })
}
function hire(runtime: OfficeRuntime) {
  assessing(runtime)
  assess(runtime)
  for (const state of [
    'capability_checks_passed',
    'recruitment_committing',
    'employee_activating',
  ] as const)
    advance(runtime, state)
  return issue(runtime, {
    type: 'activateRecruitment',
    actorId: 'service',
    recruitmentId: 'hire',
    approvedVersion: 1,
    workstationId: 'desk',
    position: [0, 0, 10],
    headingRadians: 0,
  })
}

describe('CEO recruitment authority and immutable proposal versions', () => {
  it('starts only the approved settled Manager assessment at its current position', () => {
    const runtime = setup()
    interviewTask(runtime)
    issue(runtime, {
      type: 'startTask',
      taskId: 'assessment-task',
      workLocation: 'current-position',
      recruitmentId: 'hire',
      approvedVersion: 1,
    })
    expect(runtime.getSnapshot().tasks['assessment-task']).toMatchObject({
      status: 'in_progress',
      workLocation: 'current-position',
    })
    expect(runtime.getSnapshot().agents.manager).toMatchObject({
      status: 'working',
      destination: null,
      position: [0.8, 0, 10],
    })
  })
  it.each([
    ['wrong version', { recruitmentId: 'hire', approvedVersion: 2 }],
    ['unrelated recruitment', { recruitmentId: 'other', approvedVersion: 1 }],
    ['missing approval reference', {}],
  ])(
    'rejects standing work with %s without changing task state',
    (_label, authorization) => {
      const runtime = setup()
      interviewTask(runtime)
      reject(
        runtime,
        {
          type: 'startTask',
          taskId: 'assessment-task',
          workLocation: 'current-position',
          ...authorization,
        },
        'INVALID_WORK_LOCATION',
      )
    },
  )
  it('cannot start standing assessment before the candidate settles or after approval is no longer active', () => {
    const runtime = setup()
    interviewTask(runtime)
    issue(runtime, {
      type: 'setRecruitmentScene',
      actorId: 'service',
      recruitmentId: 'hire',
      scene: {
        phase: 'arrival',
        intentId: 'still-arriving',
        from: [0, 0, 17],
        to: [-0.8, 0, 10],
        headingRadians: 0,
        arrived: false,
      },
    })
    const command = {
      type: 'startTask',
      taskId: 'assessment-task',
      workLocation: 'current-position',
      recruitmentId: 'hire',
      approvedVersion: 1,
    } as const
    reject(runtime, command, 'INVALID_WORK_LOCATION')
    issue(runtime, {
      type: 'cancelRecruitment',
      actorId: 'ceo',
      recruitmentId: 'hire',
      reason: 'Stop the assessment.',
    })
    reject(runtime, command, 'INVALID_WORK_LOCATION')
  })
  it('records a CEO request and proposal without activating a candidate', () => {
    const runtime = setup(),
      state = request(runtime)
    expect(state.recruitments.hire.state).toBe('pending_ceo_approval')
    expect(state.agents.candidate).toBeUndefined()
    expect(state.employees).toEqual({})
    expect(state.events.slice(-2).map((e) => e.type)).toEqual([
      'RECRUITMENT_REQUESTED',
      'RECRUITMENT_PROPOSAL_READY',
    ])
    expect(state.events.at(-1)?.changes.recruitments?.hire).toEqual(
      state.recruitments.hire,
    )
  })
  it('denies recruitment when no host policy is configured', () => {
    const runtime = createOfficeRuntime()
    issue(runtime, { type: 'connect' })
    reject(
      runtime,
      {
        type: 'requestRecruitment',
        actorId: 'ceo',
        recruitmentId: 'hire',
        candidateId: 'candidate',
        spec,
      },
      'RECRUITMENT_PERMISSION_DENIED',
    )
  })
  it.each(['manager', 'service', 'worker', 'forged-ceo'])(
    'does not allow %s to approve',
    (actorId) => {
      const runtime = setup()
      request(runtime)
      reject(
        runtime,
        {
          type: 'decideRecruitment',
          actorId,
          recruitmentId: 'hire',
          version: 1,
          decision: 'approve',
          reason: 'Attempted approval.',
        },
        'RECRUITMENT_PERMISSION_DENIED',
      )
    },
  )
  it('requires exact current version and renewed approval after material changes', () => {
    const runtime = setup()
    request(runtime)
    approve(runtime)
    issue(runtime, {
      type: 'reviseRecruitment',
      actorId: 'manager',
      recruitmentId: 'hire',
      spec: { ...spec, budgetMicros: 2000 },
    })
    expect(runtime.getSnapshot().recruitments.hire.approvedVersion).toBeNull()
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'candidate_arriving',
      },
      'APPROVAL_REQUIRED',
    )
    reject(
      runtime,
      {
        type: 'decideRecruitment',
        actorId: 'ceo',
        recruitmentId: 'hire',
        version: 1,
        decision: 'approve',
        reason: 'Old approval.',
      },
      'APPROVAL_VERSION_MISMATCH',
    )
    approve(runtime, 2)
    const session = advance(runtime, 'candidate_arriving', 2).recruitments.hire
    expect(session.proposals[0].spec.budgetMicros).toBe(1000)
    expect(currentProposal(session).spec.budgetMicros).toBe(2000)
  })
  it('cannot revise or activate a CEO-rejected proposal', () => {
    const runtime = setup()
    request(runtime)
    issue(runtime, {
      type: 'decideRecruitment',
      actorId: 'ceo',
      recruitmentId: 'hire',
      version: 1,
      decision: 'reject',
      reason: 'Not required.',
    })
    reject(
      runtime,
      {
        type: 'reviseRecruitment',
        actorId: 'manager',
        recruitmentId: 'hire',
        spec,
      },
      'INVALID_RECRUITMENT_TRANSITION',
    )
    reject(
      runtime,
      {
        type: 'activateRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        workstationId: 'desk',
        position: [0, 0, 0],
        headingRadians: 0,
      },
      'APPROVAL_REQUIRED',
    )
  })
  it('supports requested changes without an implicit approval', () => {
    const runtime = setup()
    request(runtime)
    issue(runtime, {
      type: 'decideRecruitment',
      actorId: 'ceo',
      recruitmentId: 'hire',
      version: 1,
      decision: 'changes',
      reason: 'Reduce budget.',
    })
    issue(runtime, {
      type: 'reviseRecruitment',
      actorId: 'manager',
      recruitmentId: 'hire',
      spec: { ...spec, budgetMicros: 500 },
    })
    expect(runtime.getSnapshot().recruitments.hire.state).toBe(
      'pending_ceo_approval',
    )
    expect(runtime.getSnapshot().recruitments.hire.approvedVersion).toBeNull()
  })
  it('deduplicates exact request retries and rejects conflicting identities', () => {
    const runtime = setup()
    const state = request(runtime)
    expect(request(runtime)).toBe(state)
    reject(
      runtime,
      {
        type: 'requestRecruitment',
        actorId: 'ceo',
        recruitmentId: 'hire',
        candidateId: 'other',
        spec,
      },
      'RECRUITMENT_ID_CONFLICT',
    )
    reject(
      runtime,
      {
        type: 'requestRecruitment',
        actorId: 'ceo',
        recruitmentId: 'other',
        candidateId: 'candidate',
        spec,
      },
      'CANDIDATE_ID_CONFLICT',
    )
  })
  it('reserves candidates against direct registerAgent bypass', () => {
    const runtime = setup()
    request(runtime)
    reject(
      runtime,
      {
        type: 'registerAgent',
        agent: {
          id: 'candidate',
          name: 'Bypass',
          role: 'Employee',
          kind: 'standard-worker',
          departmentId: 'security',
          position: [0, 0, 0],
          headingRadians: 0,
        },
      },
      'ACTIVATION_DENIED',
    )
  })
  it('rejects policies that give Manager or service the CEO identity', () => {
    expect(() =>
      copyRecruitmentPolicy({ ...policy, managerIds: ['ceo'] }),
    ).toThrow('distinct identities')
    expect(() =>
      copyRecruitmentPolicy({ ...policy, serviceIds: ['ceo'] }),
    ).toThrow('distinct identities')
  })
})

describe('recruitment evaluation, retries and activation', () => {
  it('requires service authority and legal ordered execution stages', () => {
    const runtime = setup()
    request(runtime)
    approve(runtime)
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'ceo',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'candidate_arriving',
      },
      'RECRUITMENT_PERMISSION_DENIED',
    )
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'employee_activating',
      },
      'INVALID_RECRUITMENT_TRANSITION',
    )
  })
  it('requires actual mandatory evidence before declaring checks passed', () => {
    const runtime = setup()
    assessing(runtime)
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'capability_checks_passed',
      },
      'ASSESSMENT_REQUIRED',
    )
    reject(
      runtime,
      {
        type: 'recordRecruitmentAssessment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        assessment: {
          testId: 'review',
          status: 'passed',
          mode: 'simulation',
          evidence: [],
        },
      },
      'INVALID_ASSESSMENT',
    )
  })
  it('keeps simulation assessments distinct from live assessments', () => {
    const runtime = setup()
    assessing(runtime)
    reject(
      runtime,
      {
        type: 'recordRecruitmentAssessment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        assessment: {
          testId: 'review',
          status: 'passed',
          mode: 'live',
          evidence: ['Synthetic assertion.'],
        },
      },
      'INVALID_ASSESSMENT',
    )
  })
  it('does not activate an openai configuration with simulation evidence', () => {
    const runtime = setup()
    assessing(runtime, { ...spec, adapterMode: 'openai' })
    reject(
      runtime,
      {
        type: 'recordRecruitmentAssessment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        assessment: {
          testId: 'review',
          status: 'passed',
          mode: 'simulation',
          evidence: ['Synthetic assertion.'],
        },
      },
      'INVALID_ASSESSMENT',
    )
  })
  it('rejects only after a mandatory capability failure with evidence', () => {
    const runtime = setup()
    assessing(runtime)
    assess(runtime, 'failed')
    advance(runtime, 'capability_checks_failed')
    advance(runtime, 'rejected')
    expect(runtime.getSnapshot().recruitments.hire.assessments).toHaveLength(1)
    expect(runtime.getSnapshot().agents.candidate).toBeUndefined()
  })
  it('keeps a blocked assessment distinct from a failed skill', () => {
    const runtime = setup()
    assessing(runtime)
    assess(runtime, 'blocked')
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'capability_checks_failed',
      },
      'ASSESSMENT_REQUIRED',
    )
    issue(runtime, {
      type: 'failRecruitment',
      actorId: 'service',
      recruitmentId: 'hire',
      approvedVersion: 1,
      code: 'PROVIDER_UNAVAILABLE',
      stage: 'capability_checks_running',
      retryable: true,
    })
    expect(runtime.getSnapshot().recruitments.hire.state).toBe(
      'technical_failure',
    )
    expect(runtime.getSnapshot().events.at(-1)?.type).toBe(
      'RECRUITMENT_TECHNICAL_FAILURE',
    )
  })
  it('deduplicates identical checks without overwriting conflicting evidence', () => {
    const runtime = setup()
    assessing(runtime)
    const state = assess(runtime)
    expect(assess(runtime)).toBe(state)
    reject(
      runtime,
      {
        type: 'recordRecruitmentAssessment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        assessment: {
          testId: 'review',
          status: 'failed',
          mode: 'simulation',
          evidence: ['Different evidence.'],
        },
      },
      'ASSESSMENT_ID_CONFLICT',
    )
  })
  it('stores one simulation employee, immutable configuration and occupied desk atomically', () => {
    const runtime = setup()
    const state = hire(runtime)
    expect(state.employees.candidate).toMatchObject({
      status: 'active',
      mode: 'simulation',
      currentVersion: 1,
      employeeId: 'candidate',
      agentId: 'candidate',
    })
    expect(state.agents.candidate).toMatchObject({
      kind: 'standard-worker',
      status: 'waiting',
      workstationId: 'desk',
    })
    expect(state.recruitments.hire.state).toBe('hired')
    expect(Object.isFrozen(state.employees.candidate.versions[0].spec)).toBe(
      true,
    )
    const again = issue(runtime, {
      type: 'activateRecruitment',
      actorId: 'service',
      recruitmentId: 'hire',
      approvedVersion: 1,
      workstationId: 'desk',
      position: [0, 0, 10],
      headingRadians: 0,
    })
    expect(again).toBe(state)
  })
  it('does not claim activation when no workstation is available', () => {
    const runtime = setup()
    assessing(runtime)
    assess(runtime)
    for (const state of [
      'capability_checks_passed',
      'recruitment_committing',
      'employee_activating',
    ] as const)
      advance(runtime, state)
    issue(runtime, {
      type: 'registerAgent',
      agent: {
        id: 'occupant',
        name: 'Existing worker',
        role: 'Reviewer',
        departmentId: 'security',
        kind: 'standard-worker',
        workstationId: 'desk',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
    reject(
      runtime,
      {
        type: 'activateRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        workstationId: 'desk',
        position: [0, 0, 10],
        headingRadians: 0,
      },
      'WORKSTATION_OCCUPIED',
    )
    expect(runtime.getSnapshot().employees.candidate).toBeUndefined()
  })
  it('preserves failure and assessment history on bounded retry', () => {
    const runtime = setup()
    assessing(runtime)
    assess(runtime, 'blocked')
    issue(runtime, {
      type: 'failRecruitment',
      actorId: 'service',
      recruitmentId: 'hire',
      approvedVersion: 1,
      code: 'UNAVAILABLE',
      stage: 'capability_checks_running',
      retryable: true,
    })
    issue(runtime, {
      type: 'retryRecruitment',
      actorId: 'ceo',
      recruitmentId: 'hire',
    })
    const session = runtime.getSnapshot().recruitments.hire
    expect(session).toMatchObject({
      state: 'pending_retry',
      attempt: 2,
      candidateId: 'candidate',
    })
    expect(session.failures).toHaveLength(1)
    expect(session.assessments).toHaveLength(1)
    for (const state of [
      'candidate_arriving',
      'interview_in_progress',
      'agent_configuration_created',
      'runtime_initializing',
      'capability_checks_running',
    ] as const)
      advance(runtime, state)
    reject(
      runtime,
      {
        type: 'advanceRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        state: 'capability_checks_passed',
      },
      'ASSESSMENT_REQUIRED',
    )
    assess(runtime)
    advance(runtime, 'capability_checks_passed')
    expect(runtime.getSnapshot().recruitments.hire.assessments).toHaveLength(2)
  })
  it('refuses retry after the attempt limit', () => {
    const runtime = setup()
    request(runtime)
    approve(runtime)
    for (let attempt = 1; attempt <= 3; attempt++) {
      advance(runtime, 'candidate_arriving')
      issue(runtime, {
        type: 'failRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        code: 'UNAVAILABLE',
        stage: 'candidate_arriving',
        retryable: true,
      })
      if (attempt < 3)
        issue(runtime, {
          type: 'retryRecruitment',
          actorId: 'ceo',
          recruitmentId: 'hire',
        })
    }
    reject(
      runtime,
      { type: 'retryRecruitment', actorId: 'ceo', recruitmentId: 'hire' },
      'RECRUITMENT_RETRY_DENIED',
    )
  })
  it('ignores no late success after CEO cancellation', () => {
    const runtime = setup()
    assessing(runtime)
    issue(runtime, {
      type: 'cancelRecruitment',
      actorId: 'ceo',
      recruitmentId: 'hire',
      reason: 'Stop.',
    })
    reject(
      runtime,
      {
        type: 'recordRecruitmentAssessment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        assessment: {
          testId: 'review',
          status: 'passed',
          mode: 'simulation',
          evidence: ['Delayed response.'],
        },
      },
      'INVALID_RECRUITMENT_TRANSITION',
    )
    expect(runtime.getSnapshot().employees).toEqual({})
  })
  it('rolls back activation and does not publish success on repository failure', () => {
    const repository = new InMemoryOfficeRuntimeRepository(),
      runtime = setup(repository)
    assessing(runtime)
    assess(runtime)
    for (const state of [
      'capability_checks_passed',
      'recruitment_committing',
      'employee_activating',
    ] as const)
      advance(runtime, state)
    const listener = vi.fn()
    runtime.subscribe(listener)
    vi.spyOn(repository, 'write').mockImplementation(() => {
      throw new Error('Synthetic commit failure.')
    })
    reject(
      runtime,
      {
        type: 'activateRecruitment',
        actorId: 'service',
        recruitmentId: 'hire',
        approvedVersion: 1,
        workstationId: 'desk',
        position: [0, 0, 10],
        headingRadians: 0,
      },
      'REPOSITORY_ERROR',
    )
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('recruitment presentation, termination and restoration', () => {
  it('accepts state-backed scene intents and deduplicates arrival acknowledgement', () => {
    const runtime = setup()
    request(runtime)
    approve(runtime)
    advance(runtime, 'candidate_arriving')
    issue(runtime, {
      type: 'setRecruitmentScene',
      actorId: 'service',
      recruitmentId: 'hire',
      scene: {
        phase: 'arrival',
        intentId: 'arrival:1',
        from: [0, 0, 0],
        to: [0, 0, 10],
        headingRadians: 0,
        arrived: false,
      },
    })
    const state = issue(runtime, {
      type: 'arriveRecruitmentScene',
      actorId: 'service',
      recruitmentId: 'hire',
      intentId: 'arrival:1',
    })
    expect(
      issue(runtime, {
        type: 'arriveRecruitmentScene',
        actorId: 'service',
        recruitmentId: 'hire',
        intentId: 'arrival:1',
      }),
    ).toBe(state)
    reject(
      runtime,
      {
        type: 'arriveRecruitmentScene',
        actorId: 'service',
        recruitmentId: 'hire',
        intentId: 'obsolete',
      },
      'STALE_RECRUITMENT_SCENE',
    )
    expect(state.recruitments.hire.state).toBe('candidate_arriving')
  })
  it('never animates skills rejection for technical failure', () => {
    const runtime = setup()
    request(runtime)
    approve(runtime)
    advance(runtime, 'candidate_arriving')
    issue(runtime, {
      type: 'failRecruitment',
      actorId: 'service',
      recruitmentId: 'hire',
      approvedVersion: 1,
      code: 'UNAVAILABLE',
      stage: 'candidate_arriving',
      retryable: true,
    })
    reject(
      runtime,
      {
        type: 'setRecruitmentScene',
        actorId: 'service',
        recruitmentId: 'hire',
        scene: {
          phase: 'exit',
          intentId: 'exit',
          from: [0, 0, 0],
          to: [0, 0, 10],
          headingRadians: 0,
          arrived: false,
        },
      },
      'INVALID_SCENE',
    )
  })
  it('revokes operational access and cancels assigned work on termination', async () => {
    const runtime = setup()
    hire(runtime)
    issue(runtime, {
      type: 'createTask',
      task: { id: 'task', title: 'Explicit fixture work' },
    })
    issue(runtime, { type: 'assignTask', taskId: 'task', agentId: 'candidate' })
    issue(runtime, {
      type: 'terminateEmployee',
      actorId: 'ceo',
      employeeId: 'candidate',
      reason: 'CEO revoked employment.',
    })
    expect(runtime.getSnapshot().tasks.task.status).toBe('cancelled')
    expect(runtime.getSnapshot().agents.candidate).toMatchObject({
      capabilities: [],
      workstationId: null,
      currentTaskId: null,
    })
    issue(runtime, {
      type: 'createTask',
      task: { id: 'new-task', title: 'Cannot assign' },
    })
    reject(
      runtime,
      { type: 'assignTask', taskId: 'new-task', agentId: 'candidate' },
      'EMPLOYEE_INACTIVE',
    )
    const executor = new ToolExecutor({
      runtime,
      registry: new ToolRegistry(),
      grants: {},
    })
    await expect(
      executor.execute({
        executionId: 'exec',
        agentId: 'candidate',
        taskId: 'new-task',
        toolId: 'anything',
        input: null,
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE' })
    executor.dispose()
  })
  it('does not grant Manager or service termination authority', () => {
    const runtime = setup()
    hire(runtime)
    reject(
      runtime,
      {
        type: 'terminateEmployee',
        actorId: 'manager',
        employeeId: 'candidate',
        reason: 'Unauthorized',
      },
      'RECRUITMENT_PERMISSION_DENIED',
    )
  })
  it('restores stable identity, approved configuration and history without recreating employee', () => {
    const repository = new InMemoryOfficeRuntimeRepository(),
      runtime = setup(repository)
    hire(runtime)
    const restored = createOfficeRuntime({
      repository,
      recruitmentPolicy: policy,
    })
    expect(restored.getSnapshot()).toEqual(runtime.getSnapshot())
    expect(Object.keys(restored.getSnapshot().employees)).toEqual(['candidate'])
  })
  it.each(['approval', 'mode', 'assessment', 'identity'])(
    'rejects a corrupted restored %s',
    (corruption) => {
      const runtime = setup()
      hire(runtime)
      const saved = structuredClone(runtime.getSnapshot()) as unknown as Record<
        string,
        any
      >
      if (corruption === 'approval')
        saved.recruitments.hire.approvals[0].actorId = 'worker'
      if (corruption === 'mode') saved.employees.candidate.mode = 'live'
      if (corruption === 'assessment') saved.recruitments.hire.assessments = []
      if (corruption === 'identity')
        saved.employees.candidate.agentId = 'manager'
      expect(() =>
        createOfficeRuntime({
          repository: new InMemoryOfficeRuntimeRepository(
            saved as RuntimeState,
          ),
          recruitmentPolicy: policy,
        }),
      ).toThrow()
    },
  )
  it.each(['instructions', 'mission', 'personality'])(
    'rejects credential-like %s without history or context leakage',
    (field) => {
      const runtime = setup(),
        before = runtime.getSnapshot()
      const unsafe = {
        ...spec,
        [field]: 'api_key=synthetic_rejected_fixture_value',
      }
      reject(runtime, {
        type: 'requestRecruitment',
        actorId: 'ceo',
        recruitmentId: 'hire',
        candidateId: 'candidate',
        spec: unsafe,
      })
      expect(runtime.getSnapshot()).toBe(before)
      expect(JSON.stringify(runtime.getSnapshot())).not.toContain(
        'synthetic_rejected_fixture_value',
      )
    },
  )
  it('rejects credential-like nested unexpected metadata and unknown specification fields', () => {
    expect(() =>
      validateRecruitmentSpec({
        ...spec,
        metadata: { credential: 'synthetic_fixture' },
      }),
    ).toThrow()
    expect(() => validateRecruitmentSpec({ ...spec, admin: true })).toThrow()
  })
  it('rejects a secret-bearing restored configuration', () => {
    const runtime = setup()
    request(runtime)
    const saved = structuredClone(runtime.getSnapshot()) as unknown as Record<
      string,
      any
    >
    saved.recruitments.hire.proposals[0].spec.instructions =
      'password=synthetic_fixture'
    expect(() =>
      createOfficeRuntime({
        repository: new InMemoryOfficeRuntimeRepository(saved as RuntimeState),
        recruitmentPolicy: policy,
      }),
    ).toThrow()
  })
})
