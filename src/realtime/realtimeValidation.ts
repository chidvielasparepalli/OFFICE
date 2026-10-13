import {
  memoryId,
  memorySafeJson,
  validateStoredMemory,
} from '../memory/memoryPolicy'
import { artifactTypes } from '../artifacts/artifactTypes'
import {
  providerCostSummary,
  providerErrorCodes,
} from '../providers/costPolicy'
import type { RuntimeEventType } from '../runtime/runtimeTypes'
import {
  validateRecruitmentSpec,
  validateRecruitmentScene,
} from '../recruitment/recruitmentPolicy'
import type { RecruitmentScene } from '../recruitment/recruitmentTypes'
import {
  REALTIME_MAPS,
  type RealtimeMap,
  type RealtimeView,
} from './realtimeTypes'

type Check = (value: unknown) => void
type Shape = Readonly<Record<string, Check>>
const fail = (): never => {
  throw new Error('Invalid public office data.')
}
const ensure = (valid: unknown) => {
  if (!valid) fail()
}
const plain = (v: unknown): Record<string, unknown> => {
  ensure(
    v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(v)),
  )
  return v as Record<string, unknown>
}
function object(required: Shape, optional: Shape = {}): Check {
  return (value) => {
    const item = plain(value)
    ensure(Object.keys(required).every((key) => Object.hasOwn(item, key)))
    for (const [key, entry] of Object.entries(item)) {
      const check = Object.hasOwn(required, key)
        ? required[key]
        : Object.hasOwn(optional, key)
          ? optional[key]
          : null
      if (!check) return fail()
      check(entry)
    }
  }
}
const text: Check = (value) => {
  ensure(typeof value === 'string' && value.length <= 4000)
}
const id: Check = (value) => {
  memoryId(value)
}
const integer: Check = (value) => {
  ensure(Number.isSafeInteger(value) && (value as number) >= 0)
}
const positive: Check = (value) => {
  integer(value)
  ensure((value as number) > 0)
}
const number: Check = (value) => {
  ensure(typeof value === 'number' && Number.isFinite(value))
}
const boolean: Check = (value) => {
  ensure(typeof value === 'boolean')
}
const nil: Check = (value) => {
  ensure(value === null)
}
const empty: Check = (value) => {
  ensure(Object.keys(plain(value)).length === 0)
}
const emptyList: Check = (value) => {
  ensure(Array.isArray(value) && value.length === 0)
}
const nullable =
  (check: Check): Check =>
  (value) => {
    if (value !== null) check(value)
  }
const list =
  (check: Check, max = 100): Check =>
  (value) => {
    ensure(Array.isArray(value) && value.length <= max)
    ;(value as unknown[]).forEach(check)
  }
const one =
  (...values: readonly unknown[]): Check =>
  (value) => {
    ensure(values.includes(value))
  }
const choices = (values: string): Check => one(...values.split(' '))
const date: Check = (value) => {
  text(value)
  ensure(Number.isFinite(Date.parse(value as string)))
}
const hash: Check = (value) => {
  ensure(typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))
}
const ids = list(id, 1000),
  optionalId = nullable(id),
  optionalDate = nullable(date)
const dictionary =
  (check: Check, max = 1000): Check =>
  (value) => {
    const entries = Object.entries(plain(value))
    ensure(entries.length <= max)
    for (const [key, entry] of entries) {
      id(key)
      check(entry)
    }
  }
const position: Check = (value) => {
  ensure(Array.isArray(value) && value.length === 3)
  ;(value as unknown[]).forEach(number)
}
const priority = choices('low normal high urgent')
const capability = choices('text structured research image video')
const taskStatus = choices(
  'queued assigned in_progress waiting blocked completed failed cancelled',
)
const agentStatus = choices(
  'sleeping queued working walking collaborating waiting completed blocked repair',
)
const qaStatus = choices('queued running passed failed blocked cancelled')
const severity = choices('info warning error critical')
const checkType = choices(
  'functional correctness structure requirement-compliance formatting security performance accessibility',
)
const providerStatus = choices('reserved succeeded failed cancelled denied')
const source = object({
  kind: choices('user task agent tool manager system'),
  id,
})
const scope = object({ kind: choices('agent task project organization'), id })
const artifactScope = object({ kind: choices('agent task project'), id })
const expected = object({
  role: id,
  type: one(...artifactTypes),
  count: positive,
})
const verification = object({
  qaId: id,
  status: choices('pending running verified failed blocked cancelled'),
  repairAttempts: integer,
  maxRepairAttempts: integer,
  needsAttention: boolean,
})
const binding = object({ artifactId: id, version: positive, sha256: hash })
const evidence = object({
  executionId: id,
  toolId: id,
  path: list(text, 16),
  matched: nullable(boolean),
  errorCode: nullable(id),
})
const finding = object({
  findingId: id,
  checkId: id,
  title: text,
  description: text,
  severity,
  evidence: list(evidence, 64),
  affectedTaskId: id,
  affectedArtifactId: optionalId,
  suggestedRepairType: nullable(checkType),
})
const assertion: Check = (value) => {
  const item = plain(value)
  if (item.kind === 'equals')
    object({ kind: one('equals'), path: emptyList, value: nil })(value)
  else if (item.kind === 'includes')
    object({
      kind: one('includes'),
      path: emptyList,
      value: one('Comparison withheld.'),
    })(value)
  else if (item.kind === 'maximum')
    object({ kind: one('maximum'), path: emptyList, value: number })(value)
  else
    object({ kind: choices('exists no-credentials'), path: emptyList })(value)
}
const qaCheck = object({
  checkId: id,
  title: text,
  type: checkType,
  required: boolean,
  severity,
  toolId: id,
  input: nil,
  assertion,
})
const qaResult = object(
  {
    qaId: id,
    status: choices('passed failed blocked cancelled'),
    checks: list(
      object({
        checkId: id,
        status: choices('passed failed blocked'),
        evidence: list(evidence, 64),
      }),
      32,
    ),
    passedChecks: ids,
    failedChecks: ids,
    findings: list(finding, 64),
    evidence: list(evidence, 128),
    severity,
    verifier: nullable(object({ agentId: id, taskId: id })),
    startedAt: optionalDate,
    completedAt: date,
  },
  { artifactBinding: binding },
)
const issue = object({
  code: id,
  message: text,
  taskId: optionalId,
  agentId: optionalId,
})
const pricing = object({
  inputMicrosPerUnit: integer,
  outputMicrosPerUnit: integer,
})
const usage = object({ inputUnits: integer, outputUnits: integer })
const content = object({
  storageId: id,
  contentId: id,
  byteLength: integer,
  mediaType: (v) => {
    text(v)
    ensure(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(v as string))
  },
  sha256: hash,
})
const times = { createdAt: date, updatedAt: date }
const recruitmentSpec: Check = (value) => {
  validateRecruitmentSpec(value)
}
const proposal = object({
  version: positive,
  spec: recruitmentSpec,
  createdAt: date,
  createdBy: id,
})
const recruitmentState = choices(
  'requested pending_ceo_approval changes_requested approved candidate_arriving interview_in_progress agent_configuration_created runtime_initializing capability_checks_running capability_checks_passed capability_checks_failed recruitment_committing employee_activating hired rejected technical_failure pending_retry cancelled',
)
const shapes: Record<
  RealtimeMap,
  { required: Shape; optional?: Shape; identity: string }
> = {
  agents: {
    identity: 'id',
    required: {
      id,
      name: text,
      role: text,
      departmentId: id,
      kind: choices('standard-worker manager'),
      capabilities: ids,
      status: agentStatus,
      workstationId: optionalId,
      managerId: optionalId,
      currentTaskId: optionalId,
      destination: nullable(
        object({
          id,
          destinationType: choices('workstation hub agent waypoint'),
          destinationId: id,
          movementReason: text,
          arrivalStatus: choices('working waiting collaborating'),
          collaboratorIds: ids,
        }),
      ),
      collaboratorIds: ids,
      blockers: list(text),
      position,
      headingRadians: number,
      ...times,
    },
  },
  tasks: {
    identity: 'id',
    required: {
      id,
      title: text,
      description: text,
      status: taskStatus,
      priority,
      progressPercent: (v) => {
        number(v)
        ensure((v as number) >= 0 && (v as number) <= 100)
      },
      assignedAgentId: optionalId,
      dependencyIds: ids,
      parentTaskId: optionalId,
      statusReason: nullable(text),
      waitingForDependencies: boolean,
      metadata: empty,
      ...times,
      startedAt: optionalDate,
      completedAt: optionalDate,
      failedAt: optionalDate,
      cancelledAt: optionalDate,
    },
    optional: {
      verification,
      expectedOutputs: list(expected, 16),
      inputArtifactIds: ids,
      outputArtifactIds: ids,
      workLocation: choices('workstation current-position'),
    },
  },
  workstations: {
    identity: 'id',
    required: {
      id,
      departmentId: optionalId,
      position,
      headingRadians: number,
    },
  },
  departments: {
    identity: 'id',
    required: { id, name: text, description: nullable(text) },
  },
  requests: {
    identity: 'requestId',
    required: {
      requestId: id,
      title: text,
      description: text,
      requestedBy: text,
      priority,
      constraints: list(text),
      managerId: id,
      status: choices(
        'received planning planned executing blocked completed failed cancelled',
      ),
      planId: optionalId,
      planningAttemptId: optionalId,
      coordinationTaskId: optionalId,
      issues: list(issue),
      ...times,
    },
  },
  plans: {
    identity: 'planId',
    required: {
      planId: id,
      requestId: id,
      managerId: id,
      objective: text,
      taskIds: ids,
      requirements: dictionary(
        object({ capabilities: ids, preferredAgentId: optionalId }),
      ),
      constraints: list(text),
      expectedOutputs: list(text),
      status: choices(
        'planned executing needs_attention completed failed cancelled',
      ),
      issues: list(issue),
      ...times,
    },
  },
  toolExecutions: {
    identity: 'executionId',
    required: {
      executionId: id,
      agentId: id,
      taskId: id,
      toolId: id,
      status: choices('queued running completed failed cancelled'),
      requestedAt: date,
      startedAt: optionalDate,
      completedAt: optionalDate,
      inputSummary: nil,
      permission: object({
        allowed: boolean,
        code: choices('ALLOWED DENIED'),
        reason: one('Host authorization evaluated.'),
        requiredPermissions: emptyList,
      }),
      output: nil,
      error: nullable(
        object({
          code: one('TOOL_FAILED'),
          message: one('Execution did not complete successfully.'),
        }),
      ),
      metadata: empty,
    },
  },
  memories: {
    identity: 'id',
    required: {
      id,
      agentId: id,
      scope,
      projectId: optionalId,
      type: choices('working episodic semantic project preference'),
      content: text,
      metadata: empty,
      importance: choices('low normal high critical'),
      trust: choices('verified observed inferred unverified'),
      source,
      reason: choices(
        'decision constraint approach lesson preference fact outcome',
      ),
      rationale: text,
      verification: nullable(object({ agentId: id, evidence: text, at: date })),
      retention: object({
        kind: choices('working history persistent'),
        expiresAt: optionalDate,
      }),
      status: one('active'),
      supersedesId: optionalId,
      supersededById: optionalId,
      archivedAt: optionalDate,
      ...times,
      revision: positive,
    },
  },
  artifacts: {
    identity: 'artifactId',
    required: {
      artifactId: id,
      lineageId: id,
      name: text,
      description: text,
      type: one(...artifactTypes),
      role: choices('input output'),
      outputRole: optionalId,
      taskId: optionalId,
      agentId: optionalId,
      projectId: optionalId,
      scope: artifactScope,
      status: choices(
        'created in_progress completed failed verified superseded archived',
      ),
      version: positive,
      revision: positive,
      ...times,
      source: object({
        kind: choices('tool task manager user'),
        taskId: optionalId,
        agentId: optionalId,
        executionId: optionalId,
        toolId: optionalId,
        requestId: optionalId,
        userReference: nil,
        recordedByAgentId: id,
      }),
      content,
      metadata: empty,
      derivedFromArtifactIds: ids,
      supersedesArtifactId: optionalId,
      supersededByArtifactId: optionalId,
      verifiedByQA: optionalId,
    },
  },
  qaRequests: {
    identity: 'qaId',
    required: {
      qaId: id,
      taskId: id,
      agentId: optionalId,
      requestedBy: id,
      scope: text,
      artifactId: optionalId,
      checks: list(qaCheck, 32),
      priority,
      status: qaStatus,
      repairCapabilities: ids,
      maxRepairAttempts: integer,
      rootQaId: id,
      previousQaId: optionalId,
      repairId: optionalId,
      attempt: integer,
      verifierAgentId: optionalId,
      inspectionTaskId: optionalId,
      executionIds: dictionary(id),
      result: nullable(qaResult),
      createdAt: date,
      startedAt: optionalDate,
      completedAt: optionalDate,
    },
    optional: { artifactBinding: binding },
  },
  repairRequests: {
    identity: 'repairId',
    required: {
      repairId: id,
      sourceQaId: id,
      sourceTaskId: id,
      taskId: id,
      responsibleAgentId: optionalId,
      findings: ids,
      requiredChanges: list(text, 64),
      capabilities: ids,
      priority,
      status: choices(
        'queued assigned in_progress waiting completed failed cancelled',
      ),
      attempt: integer,
      createdAt: date,
      startedAt: optionalDate,
      completedAt: optionalDate,
    },
  },
  providerRequests: {
    identity: 'requestId',
    required: {
      requestId: id,
      agentId: id,
      taskId: id,
      requestedProviderId: id,
      requestedModelId: id,
      selectedProviderId: id,
      selectedModelId: id,
      capability,
      requestFingerprint: hash,
      pricing,
      inputUnits: integer,
      maxOutputUnits: integer,
      maxCostMicros: integer,
      fallbackReasons: list(one(...providerErrorCodes), 8),
      unit: one('credit-micros'),
      estimateMicros: integer,
      actualMicros: nullable(integer),
      usage: nullable(usage),
      status: providerStatus,
      disposition: choices('reserved charged released unknown denied'),
      errorCode: nullable(one(...providerErrorCodes)),
      retryable: boolean,
      createdAt: date,
      settledAt: optionalDate,
      reconciliationId: optionalId,
      reconciliationEvidence: nil,
    },
  },
  recruitments: {
    identity: 'recruitmentId',
    required: {
      recruitmentId: id,
      candidateId: id,
      requestedBy: id,
      state: recruitmentState,
      proposals: list(proposal, 32),
      approvedVersion: nullable(positive),
      approvals: list(
        object({
          version: positive,
          decision: choices('approve reject changes'),
          actorId: id,
          reason: text,
          occurredAt: date,
        }),
        100,
      ),
      assessments: list(
        object({
          assessmentId: id,
          attempt: positive,
          version: positive,
          occurredAt: date,
          testId: id,
          status: choices('passed failed blocked'),
          mode: choices('live simulation'),
          evidence: list(text, 12),
        }),
        100,
      ),
      failures: list(
        object({
          code: id,
          stage: recruitmentState,
          retryable: boolean,
          attempt: positive,
          occurredAt: date,
        }),
        20,
      ),
      attempt: positive,
      maxAttempts: positive,
      scene: nullable((v) => validateRecruitmentScene(v as RecruitmentScene)),
      workstationId: optionalId,
      createdAt: date,
      updatedAt: date,
    },
  },
  employees: {
    identity: 'employeeId',
    required: {
      employeeId: id,
      agentId: id,
      recruitmentId: id,
      status: choices('active terminated'),
      mode: choices('live simulation'),
      currentVersion: positive,
      versions: list(proposal, 32),
      activatedAt: date,
      terminatedAt: optionalDate,
      terminationReason: nullable(text),
    },
  },
}

/** One explicit field allowlist shared by host reconstruction and strict browser validation. */
export const REALTIME_RECORD_FIELDS = Object.freeze(
  Object.fromEntries(
    REALTIME_MAPS.map((key) => [
      key,
      Object.freeze([
        ...Object.keys(shapes[key].required),
        ...Object.keys(shapes[key].optional ?? {}),
      ]),
    ]),
  ) as Record<RealtimeMap, readonly string[]>,
)
export const REALTIME_EVENT_TYPES: readonly RuntimeEventType[] = [
  'RECRUITMENT_REQUESTED',
  'RECRUITMENT_PROPOSAL_READY',
  'RECRUITMENT_APPROVED',
  'RECRUITMENT_REJECTED',
  'RECRUITMENT_CHANGES_REQUESTED',
  'RECRUITMENT_CANCELLED',
  'RECRUITMENT_RETRY_SCHEDULED',
  'RECRUITMENT_SCENE_CHANGED',
  'RECRUITMENT_SCENE_ARRIVED',
  'RECRUITMENT_COMMITTED',
  'RECRUITMENT_TECHNICAL_FAILURE',
  'RECRUITMENT_ASSESSED',
  'RECRUITMENT_STAGE_CHANGED',
  'EMPLOYEE_ACTIVATED',
  'EMPLOYEE_TERMINATED',
  'PROVIDER_REQUEST_RESERVED',
  'PROVIDER_FALLBACK_SELECTED',
  'PROVIDER_REQUEST_COMPLETED',
  'PROVIDER_REQUEST_FAILED',
  'PROVIDER_BUDGET_EXCEEDED',
  'PROVIDER_UNAVAILABLE',
  'USAGE_RECORDED',
  'PROVIDER_REQUEST_DENIED',
  'PROVIDER_REQUEST_SETTLED',
  'PROVIDER_CHARGE_UNRESOLVED',
  'PROVIDER_CHARGE_RECONCILED',
  'RUNTIME_CONNECTED',
  'RUNTIME_DISCONNECTED',
  'DEPARTMENT_REGISTERED',
  'WORKSTATION_REGISTERED',
  'AGENT_REGISTERED',
  'TASK_CREATED',
  'TASK_ASSIGNED',
  'TASK_DEPENDENCIES_CHANGED',
  'TASK_PROGRESS_UPDATED',
  'TASK_READY',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'TASK_CANCELLED',
  'AGENT_STARTED',
  'AGENT_WAITING',
  'AGENT_WALKING',
  'AGENT_ARRIVED',
  'AGENT_COLLABORATING',
  'AGENT_BLOCKED',
  'AGENT_REPAIR_STARTED',
  'AGENT_REPAIRED',
  'REQUEST_RECEIVED',
  'PLANNING_STARTED',
  'PLAN_ACCEPTED',
  'PLAN_REJECTED',
  'PLAN_DISPATCHED',
  'PLAN_STATUS_CHANGED',
  'REQUEST_CANCELLED',
  'TOOL_REQUESTED',
  'TOOL_STARTED',
  'TOOL_COMPLETED',
  'TOOL_FAILED',
  'TOOL_CANCELLED',
  'MEMORY_CREATED',
  'MEMORY_RETRIEVED',
  'MEMORY_UPDATED',
  'MEMORY_ARCHIVED',
  'MEMORY_SUPERSEDED',
  'QA_REQUESTED',
  'QA_STARTED',
  'QA_PASSED',
  'QA_FAILED',
  'QA_BLOCKED',
  'QA_CANCELLED',
  'REPAIR_REQUESTED',
  'REPAIR_ASSIGNED',
  'REPAIR_STARTED',
  'REPAIR_COMPLETED',
  'REPAIR_FAILED',
  'REPAIR_WAITING',
  'REPAIR_CANCELLED',
  'REPAIR_EXHAUSTED',
  'ARTIFACT_CREATED',
  'ARTIFACT_UPDATED',
  'ARTIFACT_VERSION_CREATED',
  'ARTIFACT_SUPERSEDED',
  'ARTIFACT_VERIFIED',
  'ARTIFACT_ARCHIVED',
  'ARTIFACT_INPUT_LINKED',
]
export const realtimeEventLabel = (type: RuntimeEventType) =>
  type.toLowerCase().replaceAll('_', ' ')
export const realtimeEventSeverity = (type: RuntimeEventType) =>
  /FAILED|EXHAUSTED/u.test(type)
    ? ('error' as const)
    : /BLOCKED|DENIED|UNRESOLVED|UNAVAILABLE/u.test(type)
      ? ('warning' as const)
      : ('info' as const)
const eventCheck = object({
  id,
  type: one(...REALTIME_EVENT_TYPES),
  occurredAt: date,
  agentId: optionalId,
  taskId: optionalId,
  payload: empty,
  changes: empty,
  transactionRevision: integer,
  transactionEventIndex: integer,
  transactionEventCount: positive,
})
const activityCheck = object({
  id,
  eventId: id,
  occurredAt: date,
  agentId: optionalId,
  taskId: optionalId,
  summary: text,
})
const ledgerCheck = object({
  ledgerId: id,
  requestId: id,
  agentId: id,
  taskId: id,
  providerId: id,
  modelId: id,
  kind: choices('reserved settled unresolved reconciled denied'),
  unit: one('credit-micros'),
  capability,
  estimateMicros: integer,
  actualMicros: nullable(integer),
  status: providerStatus,
  reservedMicros: integer,
  chargedMicros: integer,
  occurredAt: date,
  reconciliationId: optionalId,
})
const notificationCheck = object({
  id,
  eventId: id,
  severity: choices('info warning error'),
  text,
  agentId: optionalId,
  taskId: optionalId,
  occurredAt: date,
})
const handoffCheck = object({
  id: text,
  artifactId: id,
  fromTaskId: optionalId,
  toTaskId: id,
  toAgentId: optionalId,
})
const costsCheck = object({
  unit: one('credit-micros'),
  chargedMicros: (v) => {
    ensure(typeof v === 'string' && /^\d{1,32}$/u.test(v))
  },
  reservedMicros: (v) => {
    ensure(typeof v === 'string' && /^\d{1,32}$/u.test(v))
  },
  unresolvedRequests: integer,
  requestCount: integer,
})

/** Publication additionally excludes host paths; memory's credential policy remains authoritative. */
export function validateRealtimePublicData(
  value: unknown,
  maxBytes = 65536,
): void {
  memorySafeJson(value, maxBytes)
  const visit = (v: unknown): void => {
    if (typeof v === 'string')
      ensure(
        !/(?:\b[a-z]:[\\/]|\\\\|(?:^|[\s"'(=])(?:\/(?!\/)|\\)[^\s]|\bfile:\/\/)/iu.test(
          v,
        ),
      )
    else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object')
      Object.entries(v).forEach(([key, item]) => {
        visit(key)
        visit(item)
      })
  }
  visit(value)
}

/** Validates without changing data. Callers own cloning/freezing and recipient authorization. */
export function validateRealtimeView(value: unknown): RealtimeView {
  try {
    object({
      state: () => {},
      notifications: list(notificationCheck, 100),
      handoffs: list(handoffCheck, 1000),
      costs: costsCheck,
    })(value)
    const view = value as RealtimeView
    const stateChecks: Shape = Object.fromEntries(
      REALTIME_MAPS.map((key) => [
        key,
        dictionary(object(shapes[key].required, shapes[key].optional)),
      ]),
    )
    object({
      ...stateChecks,
      connection: choices('disconnected local'),
      revision: integer,
      creditLedger: list(ledgerCheck, 1000),
      events: list(eventCheck, 100),
      activities: list(activityCheck, 100),
      selectedAgentId: optionalId,
      selectedTaskId: optionalId,
    })(view.state)
    ensure(
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 4_000_000,
    )
    for (const key of REALTIME_MAPS) {
      for (const [recordId, record] of Object.entries(view.state[key])) {
        ensure(
          (record as unknown as Record<string, unknown>)[
            shapes[key].identity
          ] === recordId,
        )
        validateRealtimePublicData(record)
      }
    }
    for (const memory of Object.values(view.state.memories))
      validateStoredMemory(memory)
    for (const array of [
      view.state.events,
      view.state.activities,
      view.state.creditLedger,
      view.notifications,
      view.handoffs,
    ])
      array.forEach((item) => validateRealtimePublicData(item))
    validateRealtimePublicData(view.costs)
    const present = (map: object, key: string | null) =>
      key === null || Object.hasOwn(map, key)
    ensure(
      present(view.state.agents, view.state.selectedAgentId) &&
        present(view.state.tasks, view.state.selectedTaskId),
    )
    for (const task of Object.values(view.state.tasks)) {
      for (const key of [
        ...(task.inputArtifactIds ?? []),
        ...(task.outputArtifactIds ?? []),
      ])
        ensure(present(view.state.artifacts, key))
      if (task.verification)
        ensure(present(view.state.qaRequests, task.verification.qaId))
    }
    for (const memory of Object.values(view.state.memories))
      ensure(
        present(view.state.memories, memory.supersedesId) &&
          present(view.state.memories, memory.supersededById),
      )
    for (const artifact of Object.values(view.state.artifacts)) {
      ensure(
        present(view.state.artifacts, artifact.supersedesArtifactId) &&
          present(view.state.artifacts, artifact.supersededByArtifactId) &&
          present(view.state.qaRequests, artifact.verifiedByQA),
      )
      artifact.derivedFromArtifactIds.forEach((key) =>
        ensure(present(view.state.artifacts, key)),
      )
    }
    for (const qa of Object.values(view.state.qaRequests)) {
      ensure(present(view.state.artifacts, qa.artifactId))
      if (qa.artifactBinding)
        ensure(qa.artifactBinding.artifactId === qa.artifactId)
    }
    const events = new Map(view.state.events.map((event) => [event.id, event]))
    ensure(events.size === view.state.events.length)
    for (const item of view.state.activities) {
      const event = events.get(item.eventId)
      ensure(
        event &&
          item.summary === realtimeEventLabel(event.type) &&
          item.agentId === event.agentId &&
          item.taskId === event.taskId &&
          item.occurredAt === event.occurredAt,
      )
    }
    ensure(
      new Set(view.notifications.map((item) => item.id)).size ===
        view.notifications.length,
    )
    for (const item of view.notifications) {
      const event = events.get(item.eventId)
      ensure(
        event &&
          item.id === event.id &&
          item.text === realtimeEventLabel(event.type) &&
          item.severity === realtimeEventSeverity(event.type) &&
          item.agentId === event.agentId &&
          item.taskId === event.taskId &&
          item.occurredAt === event.occurredAt,
      )
    }
    ensure(
      new Set(view.handoffs.map((item) => item.id)).size ===
        view.handoffs.length,
    )
    for (const handoff of view.handoffs)
      ensure(
        handoff.id === `${handoff.toTaskId}::${handoff.artifactId}` &&
          present(view.state.artifacts, handoff.artifactId) &&
          view.state.tasks[handoff.toTaskId]?.inputArtifactIds?.includes(
            handoff.artifactId,
          ) &&
          handoff.fromTaskId ===
            view.state.artifacts[handoff.artifactId]?.taskId &&
          handoff.toAgentId ===
            view.state.tasks[handoff.toTaskId]?.assignedAgentId,
      )
    ensure(
      Object.entries(providerCostSummary(view.state.providerRequests)).every(
        ([key, entry]) =>
          view.costs[key as keyof RealtimeView['costs']] === entry,
      ),
    )
    return view
  } catch {
    return fail()
  }
}
