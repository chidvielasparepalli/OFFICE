import { memoryId, memoryObject, memorySafeJson } from '../memory/memoryPolicy'
import type { RuntimeState } from '../runtime/runtimeTypes'
import {
  currentProposal,
  RecruitmentFault,
  type RecruitmentAssessmentInput,
  type RecruitmentPolicy,
  type RecruitmentScene,
  type RecruitmentSession,
  type RecruitmentSpec,
} from './recruitmentTypes'

export function recruitmentAssert(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new RecruitmentFault(code, message)
}
function text(value: unknown, max = 2000): asserts value is string {
  recruitmentAssert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    'INVALID_RECRUITMENT',
    'Recruitment text must be nonempty and bounded.',
  )
}
function strings(
  value: unknown,
  maximum = 32,
  identifiers = false,
): asserts value is string[] {
  recruitmentAssert(
    Array.isArray(value) &&
      value.length <= maximum &&
      new Set(value).size === value.length,
    'INVALID_RECRUITMENT',
    'Recruitment lists must be bounded and unique.',
  )
  for (const entry of value) {
    if (identifiers) memoryId(entry)
    else text(entry)
  }
}
export function copyRecruitmentPolicy(
  value: RecruitmentPolicy,
): RecruitmentPolicy {
  memoryObject(value, ['ceoIds', 'managerIds', 'serviceIds'])
  for (const list of [value.ceoIds, value.managerIds, value.serviceIds])
    strings(list, 32, true)
  recruitmentAssert(
    value.ceoIds.every(
      (id) => !value.managerIds.includes(id) && !value.serviceIds.includes(id),
    ) && value.managerIds.every((id) => !value.serviceIds.includes(id)),
    'INVALID_RECRUITMENT_POLICY',
    'CEO, Manager and service principals must have distinct identities.',
  )
  return Object.freeze({
    ceoIds: Object.freeze([...value.ceoIds]),
    managerIds: Object.freeze([...value.managerIds]),
    serviceIds: Object.freeze([...value.serviceIds]),
  })
}
export function validateRecruitmentSpec(value: unknown): RecruitmentSpec {
  memorySafeJson(value, 32768)
  const spec = memoryObject(value, [
    'name',
    'role',
    'departmentId',
    'mission',
    'responsibilities',
    'skills',
    'instructions',
    'personality',
    'modelId',
    'providerId',
    'toolIds',
    'memoryScopes',
    'knowledgeIds',
    'collaboratorIds',
    'managerId',
    'budgetMicros',
    'maxOutputUnits',
    'adapterMode',
  ])
  for (const key of ['name', 'role', 'personality']) text(spec[key], 200)
  text(spec.mission)
  text(spec.instructions, 4000)
  for (const key of ['departmentId', 'modelId', 'providerId', 'managerId'])
    memoryId(spec[key])
  strings(spec.responsibilities, 16)
  for (const key of [
    'toolIds',
    'memoryScopes',
    'knowledgeIds',
    'collaboratorIds',
  ])
    strings(spec[key], 32, true)
  recruitmentAssert(
    Array.isArray(spec.skills) &&
      spec.skills.length > 0 &&
      spec.skills.length <= 16,
    'INVALID_RECRUITMENT',
    'Select between one and sixteen capability criteria.',
  )
  for (const item of spec.skills) {
    const skill = memoryObject(item, [
      'id',
      'description',
      'mandatory',
      'prompt',
      'expectedIncludes',
    ])
    memoryId(skill.id)
    text(skill.description)
    text(skill.prompt)
    strings(skill.expectedIncludes, 16)
    recruitmentAssert(
      typeof skill.mandatory === 'boolean' && skill.expectedIncludes.length > 0,
      'INVALID_RECRUITMENT',
      'Capability criteria require explicit expectations.',
    )
  }
  recruitmentAssert(
    new Set(spec.skills.map((skill) => skill.id)).size === spec.skills.length &&
      spec.skills.some((skill) => skill.mandatory),
    'INVALID_RECRUITMENT',
    'Capability identifiers must be unique and include a mandatory check.',
  )
  recruitmentAssert(
    Number.isSafeInteger(spec.budgetMicros) &&
      (spec.budgetMicros as number) >= 0 &&
      Number.isSafeInteger(spec.maxOutputUnits) &&
      (spec.maxOutputUnits as number) > 0 &&
      (spec.maxOutputUnits as number) <= 100000,
    'INVALID_RECRUITMENT',
    'Resource limits must be nonnegative integer microcredits and bounded positive output units.',
  )
  recruitmentAssert(
    [
      'openai',
      'mock-success',
      'mock-capability-failure',
      'mock-technical-failure',
    ].includes(spec.adapterMode as string),
    'INVALID_RECRUITMENT',
    'An explicit supported execution mode is required.',
  )
  return structuredClone(value) as RecruitmentSpec
}
export function validateRecruitmentReferences(
  state: RuntimeState,
  spec: RecruitmentSpec,
) {
  recruitmentAssert(
    Object.hasOwn(state.departments, spec.departmentId),
    'DEPARTMENT_UNAVAILABLE',
    'The proposed department is not registered.',
  )
  recruitmentAssert(
    state.agents[spec.managerId]?.kind === 'manager',
    'MANAGER_UNAVAILABLE',
    'The reporting Manager must be registered.',
  )
  recruitmentAssert(
    spec.collaboratorIds.every((id) => Object.hasOwn(state.agents, id)),
    'COLLABORATOR_UNAVAILABLE',
    'A proposed collaborator is unavailable.',
  )
}
export function validateRecruitmentAssessment(
  session: RecruitmentSession,
  value: RecruitmentAssessmentInput,
) {
  memorySafeJson(value, 12000)
  memoryObject(value, ['testId', 'status', 'mode', 'evidence'])
  memoryId(value.testId)
  const spec = currentProposal(session).spec
  recruitmentAssert(
    spec.skills.some((skill) => skill.id === value.testId),
    'INVALID_ASSESSMENT',
    'The check is not part of the approved proposal.',
  )
  recruitmentAssert(
    ['passed', 'failed', 'blocked'].includes(value.status) &&
      value.mode === (spec.adapterMode === 'openai' ? 'live' : 'simulation'),
    'INVALID_ASSESSMENT',
    'Assessment status and execution mode must match the approved configuration.',
  )
  recruitmentAssert(
    Array.isArray(value.evidence) &&
      value.evidence.length <= 12 &&
      new Set(value.evidence).size === value.evidence.length,
    'INVALID_ASSESSMENT',
    'Assessment evidence must be bounded and unique.',
  )
  value.evidence.forEach((item) => text(item, 4000))
  recruitmentAssert(
    value.evidence.length > 0,
    'INVALID_ASSESSMENT',
    'An assessment requires evidence.',
  )
}
export function recruitmentAssessmentStatus(session: RecruitmentSession) {
  const checks = currentProposal(session).spec.skills.filter(
    (skill) => skill.mandatory,
  )
  const results = session.assessments.filter(
    (item) =>
      item.attempt === session.attempt &&
      item.version === session.approvedVersion,
  )
  const required = checks.map((skill) =>
    results.find((item) => item.testId === skill.id),
  )
  if (
    required.some((item) => item?.status === 'blocked') ||
    required.some((item) => !item)
  )
    return 'blocked' as const
  if (required.some((item) => item?.status === 'failed'))
    return 'failed' as const
  return 'passed' as const
}
export function validateRecruitmentScene(value: RecruitmentScene) {
  memorySafeJson(value, 2048)
  memoryObject(value, [
    'phase',
    'intentId',
    'from',
    'to',
    'headingRadians',
    'arrived',
  ])
  memoryId(value.intentId)
  recruitmentAssert(
    [
      'arrival',
      'interview',
      'waiting',
      'welcome',
      'workstation',
      'exit',
      'departed',
    ].includes(value.phase) &&
      typeof value.arrived === 'boolean' &&
      Number.isFinite(value.headingRadians),
    'INVALID_SCENE',
    'Candidate presentation is invalid.',
  )
  for (const position of [value.from, value.to])
    recruitmentAssert(
      Array.isArray(position) &&
        position.length === 3 &&
        position[1] === 0 &&
        position.every((n) => Number.isFinite(n) && Math.abs(n) <= 100),
      'INVALID_SCENE',
      'Candidate paths use finite grounded office coordinates.',
    )
}

/** Restore is a security boundary; stored approval, assessment and employee identity must agree. */
export function validateRestoredRecruitment(
  state: RuntimeState,
  policy: RecruitmentPolicy,
) {
  const sessions = state.recruitments ?? {}
  const employees = state.employees ?? {}
  const candidates = new Set<string>()
  for (const [id, session] of Object.entries(sessions)) {
    memorySafeJson(session, 60000)
    memoryObject(session, [
      'recruitmentId',
      'candidateId',
      'requestedBy',
      'state',
      'proposals',
      'approvedVersion',
      'approvals',
      'assessments',
      'failures',
      'attempt',
      'maxAttempts',
      'scene',
      'workstationId',
      'createdAt',
      'updatedAt',
    ])
    memoryId(id)
    const states = [
      'requested',
      'pending_ceo_approval',
      'changes_requested',
      'approved',
      'candidate_arriving',
      'interview_in_progress',
      'agent_configuration_created',
      'runtime_initializing',
      'capability_checks_running',
      'capability_checks_passed',
      'capability_checks_failed',
      'recruitment_committing',
      'employee_activating',
      'hired',
      'rejected',
      'technical_failure',
      'pending_retry',
      'cancelled',
    ]
    recruitmentAssert(
      states.includes(session.state) &&
        Number.isFinite(Date.parse(session.createdAt)) &&
        Number.isFinite(Date.parse(session.updatedAt)),
      'INVALID_RECRUITMENT',
      'Stored recruitment stage or timestamp is invalid.',
    )
    recruitmentAssert(
      id === session.recruitmentId && !candidates.has(session.candidateId),
      'INVALID_RECRUITMENT',
      'Stored candidate identity is inconsistent.',
    )
    memoryId(session.candidateId)
    candidates.add(session.candidateId)
    recruitmentAssert(
      policy.ceoIds.includes(session.requestedBy) &&
        session.proposals.length > 0 &&
        session.proposals.length <= 32 &&
        Number.isInteger(session.attempt) &&
        session.attempt >= 1 &&
        session.attempt <= 3 &&
        session.maxAttempts === 3,
      'INVALID_RECRUITMENT',
      'Stored recruitment ownership or attempts are invalid.',
    )
    session.proposals.forEach((proposal, index) => {
      memoryObject(proposal, ['version', 'spec', 'createdAt', 'createdBy'])
      recruitmentAssert(
        proposal.version === index + 1 &&
          (policy.ceoIds.includes(proposal.createdBy) ||
            policy.managerIds.includes(proposal.createdBy)),
        'INVALID_RECRUITMENT',
        'Stored proposal provenance is invalid.',
      )
      validateRecruitmentSpec(proposal.spec)
      validateRecruitmentReferences(state, proposal.spec)
    })
    for (const approval of session.approvals) {
      memoryObject(approval, [
        'version',
        'decision',
        'actorId',
        'reason',
        'occurredAt',
      ])
      recruitmentAssert(
        policy.ceoIds.includes(approval.actorId) &&
          session.proposals.some((p) => p.version === approval.version) &&
          ['approve', 'reject', 'changes'].includes(approval.decision),
        'INVALID_APPROVAL',
        'Stored approval authority is invalid.',
      )
    }
    if (
      ![
        'requested',
        'pending_ceo_approval',
        'changes_requested',
        'rejected',
        'cancelled',
      ].includes(session.state)
    )
      recruitmentAssert(
        session.approvedVersion !== null,
        'INVALID_APPROVAL',
        'Stored execution requires CEO approval.',
      )
    if (session.approvedVersion !== null) {
      const approval = session.approvals.at(-1)
      recruitmentAssert(
        session.approvedVersion === currentProposal(session).version &&
          approval?.decision === 'approve' &&
          approval.version === session.approvedVersion,
        'INVALID_APPROVAL',
        'Stored recruitment is missing its exact approved version.',
      )
    }
    const checkIds = new Set<string>()
    for (const assessment of session.assessments) {
      memoryObject(assessment, [
        'testId',
        'status',
        'mode',
        'evidence',
        'assessmentId',
        'attempt',
        'version',
        'occurredAt',
      ])
      const proposal = session.proposals.find(
        (p) => p.version === assessment.version,
      )
      recruitmentAssert(
        proposal &&
          assessment.attempt >= 1 &&
          assessment.attempt <= session.attempt,
        'INVALID_ASSESSMENT',
        'Stored assessment provenance is invalid.',
      )
      validateRecruitmentAssessment(
        { ...session, proposals: [proposal] },
        {
          testId: assessment.testId,
          status: assessment.status,
          mode: assessment.mode,
          evidence: assessment.evidence,
        },
      )
      const key = `${assessment.attempt}:${assessment.version}:${assessment.testId}`
      recruitmentAssert(
        !checkIds.has(key),
        'INVALID_ASSESSMENT',
        'Stored assessment is duplicated.',
      )
      checkIds.add(key)
    }
    for (const failure of session.failures) {
      memoryObject(failure, [
        'code',
        'stage',
        'retryable',
        'attempt',
        'occurredAt',
      ])
      memoryId(failure.code)
      recruitmentAssert(
        states.includes(failure.stage) &&
          typeof failure.retryable === 'boolean' &&
          Number.isInteger(failure.attempt) &&
          failure.attempt >= 1 &&
          failure.attempt <= session.attempt &&
          Number.isFinite(Date.parse(failure.occurredAt)),
        'INVALID_RECRUITMENT',
        'Stored technical failure history is invalid.',
      )
    }
    if (session.state === 'rejected')
      recruitmentAssert(
        session.approvals.at(-1)?.decision === 'reject' ||
          (session.approvedVersion !== null &&
            recruitmentAssessmentStatus(session) === 'failed'),
        'INVALID_ASSESSMENT',
        'Stored rejection requires a CEO decision or mandatory failed assessment.',
      )
    if (session.scene) validateRecruitmentScene(session.scene)
    if (
      [
        'capability_checks_passed',
        'recruitment_committing',
        'employee_activating',
        'hired',
      ].includes(session.state)
    )
      recruitmentAssert(
        session.approvedVersion !== null &&
          recruitmentAssessmentStatus(session) === 'passed',
        'INVALID_ASSESSMENT',
        'Stored hiring lacks required successful assessments.',
      )
    recruitmentAssert(
      (session.state === 'hired') ===
        Object.hasOwn(employees, session.candidateId),
      'INVALID_EMPLOYEE',
      'Stored activation and recruitment must commit together.',
    )
    if (session.state !== 'hired')
      recruitmentAssert(
        !Object.hasOwn(state.agents, session.candidateId),
        'INVALID_EMPLOYEE',
        'Unactivated candidates cannot be registered as employees.',
      )
  }
  for (const [id, employee] of Object.entries(employees)) {
    memorySafeJson(employee, 60000)
    memoryObject(employee, [
      'employeeId',
      'agentId',
      'recruitmentId',
      'status',
      'mode',
      'currentVersion',
      'versions',
      'activatedAt',
      'terminatedAt',
      'terminationReason',
    ])
    const session = sessions[employee.recruitmentId]
    recruitmentAssert(
      session?.state === 'hired' &&
        id === employee.employeeId &&
        id === employee.agentId &&
        id === session.candidateId &&
        state.agents[id]?.kind === 'standard-worker' &&
        employee.currentVersion === session.approvedVersion &&
        JSON.stringify(employee.versions) ===
          JSON.stringify(session.proposals) &&
        employee.mode ===
          (currentProposal(session).spec.adapterMode === 'openai'
            ? 'live'
            : 'simulation') &&
        ['active', 'terminated'].includes(employee.status),
      'INVALID_EMPLOYEE',
      'Stored employee identity, configuration or activation is invalid.',
    )
    if (employee.status === 'terminated')
      recruitmentAssert(
        state.agents[id]?.currentTaskId === null &&
          state.agents[id]?.destination === null &&
          state.agents[id]?.capabilities.length === 0,
        'INVALID_EMPLOYEE',
        'Terminated employees cannot retain operational access.',
      )
  }
}
