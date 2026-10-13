import { memoryId, memorySafeJson } from '../memory/memoryPolicy'
import {
  recruitmentAssert as ensure,
  recruitmentAssessmentStatus,
  validateRecruitmentAssessment,
  validateRecruitmentReferences,
  validateRecruitmentScene,
  validateRecruitmentSpec,
} from '../recruitment/recruitmentPolicy'
import {
  currentProposal,
  type RecruitmentCommand,
  type RecruitmentPolicy,
  type RecruitmentSession,
  type RecruitmentState,
} from '../recruitment/recruitmentTypes'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type {
  RegisterAgentInput,
  RuntimeCommand,
  RuntimeState,
} from './runtimeTypes'

export interface RecruitmentTransaction extends OrchestrationTransaction {
  readonly recruitmentPolicy: RecruitmentPolicy
  registerRecruitedAgent(agent: RegisterAgentInput): void
}
const commands = new Set([
  'requestRecruitment',
  'reviseRecruitment',
  'decideRecruitment',
  'advanceRecruitment',
  'recordRecruitmentAssessment',
  'failRecruitment',
  'retryRecruitment',
  'cancelRecruitment',
  'activateRecruitment',
  'terminateEmployee',
  'setRecruitmentScene',
  'arriveRecruitmentScene',
])
const terminal = new Set<RecruitmentState>(['hired', 'rejected', 'cancelled'])
const nextState: Partial<
  Record<RecruitmentState, readonly RecruitmentState[]>
> = {
  approved: ['candidate_arriving'],
  pending_retry: ['candidate_arriving'],
  candidate_arriving: ['interview_in_progress'],
  interview_in_progress: ['agent_configuration_created'],
  agent_configuration_created: ['runtime_initializing'],
  runtime_initializing: ['capability_checks_running'],
  capability_checks_running: [
    'capability_checks_passed',
    'capability_checks_failed',
  ],
  capability_checks_passed: ['recruitment_committing'],
  capability_checks_failed: ['rejected'],
  recruitment_committing: ['employee_activating'],
}
export function isRecruitmentCommand(
  command: RuntimeCommand,
): command is RecruitmentCommand {
  return commands.has(command.type)
}
function authorized(
  tx: RecruitmentTransaction,
  actorId: string,
  role: keyof RecruitmentPolicy,
) {
  memoryId(actorId)
  ensure(
    tx.recruitmentPolicy[role].includes(actorId),
    'RECRUITMENT_PERMISSION_DENIED',
    'This principal cannot perform the recruitment operation.',
  )
}
function patch(
  tx: RecruitmentTransaction,
  session: RecruitmentSession,
  changes: Partial<RecruitmentSession>,
) {
  const next = { ...session, ...changes, updatedAt: tx.time }
  memorySafeJson(next, 60000)
  tx.state = {
    ...tx.state,
    recruitments: { ...tx.state.recruitments, [session.recruitmentId]: next },
  }
  return next
}
function requireApproved(session: RecruitmentSession, version: number) {
  ensure(
    Number.isInteger(version) &&
      version === session.approvedVersion &&
      version === currentProposal(session).version &&
      session.approvals.at(-1)?.decision === 'approve',
    'APPROVAL_REQUIRED',
    'An exact current CEO-approved proposal is required.',
  )
}
function event(
  tx: RecruitmentTransaction,
  session: RecruitmentSession,
  type: Parameters<RecruitmentTransaction['emit']>[0],
  summary: string,
) {
  tx.emit(
    type,
    summary,
    session.state === 'hired' ? session.candidateId : null,
    null,
    {
      recruitmentId: session.recruitmentId,
      candidateId: session.candidateId,
      state: session.state,
      version: currentProposal(session).version,
      attempt: session.attempt,
    },
  )
}

/** Existing workers are unchanged; recruited employees must remain active at every execution entry. */
export function assertEmployeeOperational(
  state: RuntimeState,
  agentId: string | null | undefined,
) {
  if (!agentId) return
  const employee = state.employees?.[agentId]
  ensure(
    !employee || employee.status === 'active',
    'EMPLOYEE_INACTIVE',
    'The employee has no operational access.',
  )
}

export function applyRecruitmentCommand(
  tx: RecruitmentTransaction,
  command: RecruitmentCommand,
) {
  memorySafeJson(command, 40000)
  if (command.type === 'terminateEmployee') {
    authorized(tx, command.actorId, 'ceoIds')
    memoryId(command.employeeId)
    const employee = tx.state.employees[command.employeeId]
    ensure(employee, 'EMPLOYEE_NOT_FOUND', 'The employee is unavailable.')
    if (employee.status === 'terminated') return
    ensure(
      command.reason.trim().length > 0 && command.reason.length <= 2000,
      'INVALID_RECRUITMENT',
      'A bounded termination reason is required.',
    )
    for (const task of Object.values(tx.state.tasks))
      if (
        task.assignedAgentId === employee.agentId &&
        !['completed', 'failed', 'cancelled'].includes(task.status)
      )
        tx.apply({
          type: 'cancelTask',
          taskId: task.id,
          reason: 'Employee operational access revoked.',
        })
    for (const execution of Object.values(tx.state.toolExecutions))
      if (
        execution.agentId === employee.agentId &&
        ['queued', 'running'].includes(execution.status)
      )
        tx.apply({
          type: 'cancelToolExecution',
          executionId: execution.executionId,
          reason: 'Employee operational access revoked.',
        })
    const agent = tx.agent(employee.agentId)
    tx.state = {
      ...tx.state,
      employees: {
        ...tx.state.employees,
        [employee.employeeId]: {
          ...employee,
          status: 'terminated',
          terminatedAt: tx.time,
          terminationReason: command.reason,
        },
      },
      agents: {
        ...tx.state.agents,
        [agent.id]: {
          ...agent,
          status: 'sleeping',
          currentTaskId: null,
          workstationId: null,
          destination: null,
          collaboratorIds: [],
          capabilities: [],
          updatedAt: tx.time,
        },
      },
    }
    memorySafeJson(tx.state.employees[employee.employeeId], 60000)
    tx.emit(
      'EMPLOYEE_TERMINATED',
      'CEO terminated employee operational access.',
      employee.agentId,
      null,
      {
        employeeId: employee.employeeId,
        recruitmentId: employee.recruitmentId,
        actorId: command.actorId,
      },
    )
    return
  }
  memoryId(command.recruitmentId)
  if (command.type === 'requestRecruitment') {
    authorized(tx, command.actorId, 'ceoIds')
    memoryId(command.candidateId)
    const spec = validateRecruitmentSpec(command.spec)
    validateRecruitmentReferences(tx.state, spec)
    const previous = tx.state.recruitments[command.recruitmentId]
    if (previous) {
      ensure(
        previous.requestedBy === command.actorId &&
          previous.candidateId === command.candidateId &&
          JSON.stringify(previous.proposals[0].spec) === JSON.stringify(spec),
        'RECRUITMENT_ID_CONFLICT',
        'Recruitment identity belongs to a different request.',
      )
      return
    }
    ensure(
      !Object.hasOwn(tx.state.agents, command.candidateId) &&
        !Object.hasOwn(tx.state.employees, command.candidateId) &&
        !Object.values(tx.state.recruitments).some(
          (item) => item.candidateId === command.candidateId,
        ),
      'CANDIDATE_ID_CONFLICT',
      'Candidate identity is already reserved.',
    )
    let session: RecruitmentSession = {
      recruitmentId: command.recruitmentId,
      candidateId: command.candidateId,
      requestedBy: command.actorId,
      state: 'requested',
      proposals: [
        { version: 1, spec, createdAt: tx.time, createdBy: command.actorId },
      ],
      approvedVersion: null,
      approvals: [],
      assessments: [],
      failures: [],
      attempt: 1,
      maxAttempts: 3,
      scene: null,
      workstationId: null,
      createdAt: tx.time,
      updatedAt: tx.time,
    }
    session = patch(tx, session, {})
    event(
      tx,
      session,
      'RECRUITMENT_REQUESTED',
      'CEO requested an employee proposal.',
    )
    session = patch(tx, session, { state: 'pending_ceo_approval' })
    event(
      tx,
      session,
      'RECRUITMENT_PROPOSAL_READY',
      'Recruitment proposal is awaiting CEO review.',
    )
    return
  }
  const session = tx.state.recruitments[command.recruitmentId]
  ensure(
    session,
    'RECRUITMENT_NOT_FOUND',
    'The recruitment session is unavailable.',
  )
  if (command.type === 'reviseRecruitment') {
    ensure(
      tx.recruitmentPolicy.ceoIds.includes(command.actorId) ||
        tx.recruitmentPolicy.managerIds.includes(command.actorId),
      'RECRUITMENT_PERMISSION_DENIED',
      'Only the CEO or authorized Manager may prepare a revision.',
    )
    ensure(
      ['pending_ceo_approval', 'changes_requested', 'approved'].includes(
        session.state,
      ),
      'INVALID_RECRUITMENT_TRANSITION',
      'Active or terminal recruitment cannot be reconfigured.',
    )
    ensure(
      session.proposals.length < 32,
      'PROPOSAL_LIMIT',
      'The bounded proposal history is full.',
    )
    const spec = validateRecruitmentSpec(command.spec)
    validateRecruitmentReferences(tx.state, spec)
    const next = patch(tx, session, {
      state: 'pending_ceo_approval',
      approvedVersion: null,
      proposals: [
        ...session.proposals,
        {
          version: currentProposal(session).version + 1,
          spec,
          createdAt: tx.time,
          createdBy: command.actorId,
        },
      ],
    })
    event(
      tx,
      next,
      'RECRUITMENT_PROPOSAL_READY',
      'Revised proposal requires renewed CEO approval.',
    )
    return
  }
  if (command.type === 'decideRecruitment') {
    authorized(tx, command.actorId, 'ceoIds')
    ensure(
      session.state === 'pending_ceo_approval' &&
        command.version === currentProposal(session).version,
      'APPROVAL_VERSION_MISMATCH',
      'Review the current pending proposal version.',
    )
    ensure(
      ['approve', 'reject', 'changes'].includes(command.decision) &&
        command.reason.trim().length > 0 &&
        command.reason.length <= 2000,
      'INVALID_RECRUITMENT',
      'A valid decision and bounded reason are required.',
    )
    const next = patch(tx, session, {
      state:
        command.decision === 'approve'
          ? 'approved'
          : command.decision === 'reject'
            ? 'rejected'
            : 'changes_requested',
      approvedVersion: command.decision === 'approve' ? command.version : null,
      approvals: [
        ...session.approvals,
        {
          version: command.version,
          decision: command.decision,
          actorId: command.actorId,
          reason: command.reason,
          occurredAt: tx.time,
        },
      ],
    })
    event(
      tx,
      next,
      command.decision === 'approve'
        ? 'RECRUITMENT_APPROVED'
        : command.decision === 'reject'
          ? 'RECRUITMENT_REJECTED'
          : 'RECRUITMENT_CHANGES_REQUESTED',
      command.decision === 'approve'
        ? 'CEO approved the exact employee proposal.'
        : command.decision === 'reject'
          ? 'CEO rejected the employee proposal.'
          : 'CEO requested proposal changes.',
    )
    return
  }
  if (command.type === 'cancelRecruitment') {
    authorized(tx, command.actorId, 'ceoIds')
    if (session.state === 'cancelled') return
    ensure(
      !terminal.has(session.state),
      'INVALID_RECRUITMENT_TRANSITION',
      'Terminal recruitment cannot be cancelled.',
    )
    ensure(
      command.reason.trim().length > 0 && command.reason.length <= 2000,
      'INVALID_RECRUITMENT',
      'A bounded cancellation reason is required.',
    )
    const next = patch(tx, session, { state: 'cancelled' })
    event(tx, next, 'RECRUITMENT_CANCELLED', 'CEO cancelled recruitment.')
    return
  }
  if (command.type === 'retryRecruitment') {
    authorized(tx, command.actorId, 'ceoIds')
    requireApproved(session, session.approvedVersion ?? 0)
    ensure(
      session.state === 'technical_failure' &&
        session.failures.at(-1)?.retryable &&
        session.attempt < session.maxAttempts,
      'RECRUITMENT_RETRY_DENIED',
      'Only a retryable technical failure within the attempt limit may resume.',
    )
    const next = patch(tx, session, {
      state: 'pending_retry',
      attempt: session.attempt + 1,
    })
    event(
      tx,
      next,
      'RECRUITMENT_RETRY_SCHEDULED',
      'CEO authorized another recruitment attempt.',
    )
    return
  }
  authorized(tx, command.actorId, 'serviceIds')
  if (command.type === 'setRecruitmentScene') {
    validateRecruitmentScene(command.scene)
    const phase = command.scene.phase
    ensure(
      (['welcome', 'workstation'].includes(phase) &&
        session.state === 'hired') ||
        (['exit', 'departed'].includes(phase) &&
          ['rejected', 'cancelled'].includes(session.state)) ||
        (['arrival', 'interview', 'waiting'].includes(phase) &&
          !terminal.has(session.state) &&
          session.approvedVersion !== null),
      'INVALID_SCENE',
      'Candidate presentation must follow accepted recruitment state.',
    )
    if (session.scene?.intentId === command.scene.intentId) {
      ensure(
        JSON.stringify(session.scene) === JSON.stringify(command.scene),
        'SCENE_ID_CONFLICT',
        'Scene intent identity cannot be replaced.',
      )
      return
    }
    ensure(
      !tx.state.events.some(
        (item) => item.payload.intentId === command.scene.intentId,
      ),
      'SCENE_ID_CONFLICT',
      'Scene intent identity has already been used.',
    )
    const next = patch(tx, session, { scene: structuredClone(command.scene) })
    tx.emit(
      'RECRUITMENT_SCENE_CHANGED',
      'Candidate presentation follows the accepted recruitment stage.',
      null,
      null,
      {
        recruitmentId: session.recruitmentId,
        candidateId: session.candidateId,
        intentId: command.scene.intentId,
        phase,
        state: next.state,
      },
    )
    return
  }
  if (command.type === 'arriveRecruitmentScene') {
    memoryId(command.intentId)
    ensure(
      session.scene?.intentId === command.intentId,
      'STALE_RECRUITMENT_SCENE',
      'Candidate feedback must identify the current scene intent.',
    )
    if (session.scene.arrived) return
    const next = patch(tx, session, {
      scene: { ...session.scene, arrived: true },
    })
    event(
      tx,
      next,
      'RECRUITMENT_SCENE_ARRIVED',
      'Candidate reached its authorized presentation destination.',
    )
    return
  }
  requireApproved(session, command.approvedVersion)
  if (command.type === 'activateRecruitment') {
    if (session.state === 'hired') return
    ensure(
      session.state === 'employee_activating' &&
        recruitmentAssessmentStatus(session) === 'passed',
      'ACTIVATION_DENIED',
      'Activation requires approved configuration and completed mandatory checks.',
    )
    const spec = currentProposal(session).spec
    validateRecruitmentReferences(tx.state, spec)
    const workstation = tx.state.workstations[command.workstationId]
    ensure(
      workstation &&
        (workstation.departmentId === null ||
          workstation.departmentId === spec.departmentId),
      'WORKSTATION_UNAVAILABLE',
      'A compatible available workstation is required.',
    )
    tx.registerRecruitedAgent({
      id: session.candidateId,
      name: spec.name,
      role: spec.role,
      departmentId: spec.departmentId,
      kind: 'standard-worker',
      capabilities: [
        ...new Set([
          ...spec.skills.map((skill) => skill.id),
          ...(spec.toolIds.includes('provider.invoke') ? ['structured'] : []),
        ]),
      ],
      workstationId: command.workstationId,
      managerId: spec.managerId,
      position: command.position,
      headingRadians: command.headingRadians,
      status: 'waiting',
    })
    tx.state = {
      ...tx.state,
      employees: {
        ...tx.state.employees,
        [session.candidateId]: {
          employeeId: session.candidateId,
          agentId: session.candidateId,
          recruitmentId: session.recruitmentId,
          status: 'active',
          mode: spec.adapterMode === 'openai' ? 'live' : 'simulation',
          currentVersion: command.approvedVersion,
          versions: session.proposals,
          activatedAt: tx.time,
          terminatedAt: null,
          terminationReason: null,
        },
      },
    }
    memorySafeJson(tx.state.employees[session.candidateId], 60000)
    const next = patch(tx, session, {
      state: 'hired',
      workstationId: command.workstationId,
    })
    event(
      tx,
      next,
      'RECRUITMENT_COMMITTED',
      'Approved employee configuration and exclusive workstation committed.',
    )
    event(
      tx,
      next,
      'EMPLOYEE_ACTIVATED',
      spec.adapterMode === 'openai'
        ? 'Validated employee activated.'
        : 'Simulation employee activated; no production AI employee was created.',
    )
    return
  }
  ensure(
    !terminal.has(session.state),
    'INVALID_RECRUITMENT_TRANSITION',
    'Terminal recruitment cannot resume execution.',
  )
  if (command.type === 'failRecruitment') {
    memoryId(command.code)
    ensure(
      command.stage === session.state &&
        typeof command.retryable === 'boolean' &&
        ![
          'pending_ceo_approval',
          'changes_requested',
          'technical_failure',
        ].includes(session.state),
      'INVALID_RECRUITMENT_TRANSITION',
      'Technical failure must refer to the current execution stage.',
    )
    const next = patch(tx, session, {
      state: 'technical_failure',
      failures: [
        ...session.failures,
        {
          code: command.code,
          stage: command.stage,
          retryable: command.retryable,
          attempt: session.attempt,
          occurredAt: tx.time,
        },
      ],
    })
    event(
      tx,
      next,
      'RECRUITMENT_TECHNICAL_FAILURE',
      'Recruitment paused for a technical issue; no skills rejection was inferred.',
    )
    return
  }
  if (command.type === 'recordRecruitmentAssessment') {
    ensure(
      session.state === 'capability_checks_running',
      'INVALID_RECRUITMENT_TRANSITION',
      'Assessments require the active approved assessment stage.',
    )
    validateRecruitmentAssessment(session, command.assessment)
    const previous = session.assessments.find(
      (item) =>
        item.attempt === session.attempt &&
        item.version === command.approvedVersion &&
        item.testId === command.assessment.testId,
    )
    if (previous) {
      ensure(
        previous.status === command.assessment.status &&
          previous.mode === command.assessment.mode &&
          JSON.stringify(previous.evidence) ===
            JSON.stringify(command.assessment.evidence),
        'ASSESSMENT_ID_CONFLICT',
        'Recorded assessment evidence cannot be replaced.',
      )
      return
    }
    const next = patch(tx, session, {
      assessments: [
        ...session.assessments,
        {
          ...structuredClone(command.assessment),
          assessmentId: tx.id('assessment'),
          attempt: session.attempt,
          version: command.approvedVersion,
          occurredAt: tx.time,
        },
      ],
    })
    event(
      tx,
      next,
      'RECRUITMENT_ASSESSED',
      'Recorded an explicit capability assessment and its evidence.',
    )
    return
  }
  ensure(
    nextState[session.state]?.includes(command.state),
    'INVALID_RECRUITMENT_TRANSITION',
    'Recruitment stages cannot be skipped or reversed.',
  )
  if (
    command.state === 'capability_checks_passed' ||
    command.state === 'capability_checks_failed'
  )
    ensure(
      recruitmentAssessmentStatus(session) ===
        (command.state === 'capability_checks_passed' ? 'passed' : 'failed'),
      'ASSESSMENT_REQUIRED',
      'Mandatory check evidence does not support this decision.',
    )
  const next = patch(tx, session, { state: command.state })
  event(
    tx,
    next,
    command.state === 'rejected'
      ? 'RECRUITMENT_REJECTED'
      : 'RECRUITMENT_STAGE_CHANGED',
    command.state === 'rejected'
      ? 'Candidate rejected because a mandatory capability check failed.'
      : 'Recruitment execution advanced to its next accepted stage.',
  )
}
