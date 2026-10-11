import { memorySafeJson } from '../memory/memoryPolicy'
import { MemoryFault } from '../memory/memoryTypes'
import { ToolFault, type ToolRequest } from '../tools/toolTypes'
import type { RuntimeJson, RuntimeState } from '../runtime/runtimeTypes'
import {
  publicToolJson,
  toolId,
  toolObject,
  toolText,
} from '../tools/toolValidation'
import {
  QAFault,
  type QAAssertion,
  type QACheck,
  type QACheckResult,
  type QAEvidence,
  type QAFinding,
  type QARequest,
  type QARequestInput,
  type QAResult,
  type QASeverity,
} from './qaTypes'

function requireQA(value: unknown, message: string): asserts value {
  if (!value) throw new QAFault('INVALID_QA', message)
}

const severities: readonly QASeverity[] = [
  'info',
  'warning',
  'error',
  'critical',
]
const checkTypes = [
  'functional',
  'correctness',
  'structure',
  'requirement-compliance',
  'formatting',
  'security',
  'performance',
  'accessibility',
]
const reserved = ['__proto__', 'prototype', 'constructor']
const id = (value: unknown) => {
  const result = toolId(value)
  requireQA(!reserved.includes(result), 'Reserved QA identifier.')
  return result
}

/** Request data selects bounded assertions, never executable check implementations. */
export function validateQARequest(input: QARequestInput): QARequestInput {
  input = memorySafeJson(input, 32768) as unknown as QARequestInput
  toolObject(input, [
    'qaId',
    'taskId',
    'requestedBy',
    'scope',
    'artifactId',
    'checks',
    'priority',
    'repairCapabilities',
    'maxRepairAttempts',
  ])
  id(input.taskId)
  id(input.requestedBy)
  if (input.qaId !== undefined) id(input.qaId)
  if (input.artifactId !== undefined && input.artifactId !== null)
    id(input.artifactId)
  toolText(input.scope, 'QA scope', 1000)
  const priority = input.priority ?? 'normal'
  requireQA(
    ['low', 'normal', 'high', 'urgent'].includes(priority),
    'Invalid QA priority.',
  )
  const maxRepairAttempts = input.maxRepairAttempts ?? 2
  requireQA(
    Number.isInteger(maxRepairAttempts) &&
      maxRepairAttempts >= 0 &&
      maxRepairAttempts <= 5,
    'Repair attempts must be an integer between zero and five.',
  )
  requireQA(
    Array.isArray(input.repairCapabilities) &&
      input.repairCapabilities.length > 0 &&
      input.repairCapabilities.length <= 16,
    'QA requires bounded repair capabilities.',
  )
  input.repairCapabilities.forEach(id)
  requireQA(
    new Set(input.repairCapabilities).size === input.repairCapabilities.length,
    'Duplicate repair capability.',
  )
  requireQA(
    Array.isArray(input.checks) &&
      input.checks.length > 0 &&
      input.checks.length <= 16,
    'QA requires between one and sixteen explicit checks.',
  )
  const checkIds = new Set<string>()
  for (const check of input.checks) {
    toolObject(check, [
      'checkId',
      'title',
      'type',
      'required',
      'severity',
      'toolId',
      'input',
      'assertion',
    ])
    id(check.checkId)
    requireQA(!checkIds.has(check.checkId), 'Duplicate QA check.')
    checkIds.add(check.checkId)
    toolText(check.title, 'Check title', 200)
    requireQA(checkTypes.includes(check.type), 'Unsupported QA check type.')
    requireQA(
      typeof check.required === 'boolean',
      'Check requirement must be explicit.',
    )
    requireQA(severities.includes(check.severity), 'Invalid check severity.')
    id(check.toolId)
    memorySafeJson(check.input, 4096)
    const assertion = toolObject(check.assertion, ['kind', 'path', 'value'])
    requireQA(
      ['exists', 'equals', 'includes', 'maximum', 'no-credentials'].includes(
        assertion.kind as string,
      ),
      'Unsupported QA assertion.',
    )
    requireQA(
      Array.isArray(assertion.path) && assertion.path.length <= 12,
      'Invalid assertion path.',
    )
    for (const part of assertion.path) {
      toolText(part, 'Path segment', 120)
      requireQA(!reserved.includes(part), 'Unsafe assertion path.')
    }
    if (assertion.kind === 'equals') memorySafeJson(assertion.value, 4096)
    else if (assertion.kind === 'includes')
      toolText(assertion.value, 'Expected text', 1000)
    else if (assertion.kind === 'maximum')
      requireQA(
        typeof assertion.value === 'number' && Number.isFinite(assertion.value),
        'Maximum requires a finite number.',
      )
    else
      requireQA(
        !Object.hasOwn(assertion, 'value'),
        'Assertion does not accept an expected value.',
      )
  }
  requireQA(
    input.checks.some((check) => check.required),
    'QA requires at least one required check.',
  )
  return { ...structuredClone(input), priority, maxRepairAttempts }
}

function equalJson(left: RuntimeJson, right: RuntimeJson): boolean {
  if (left === right) return true
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  )
    return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    )
  const a = left as Record<string, RuntimeJson>
  const b = right as Record<string, RuntimeJson>
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]),
    )
  )
}

/** Reserved QA execution IDs cannot inspect different input under the same identity. */
export function validateQAExecution(state: RuntimeState, request: ToolRequest) {
  const qa = Object.values(state.qaRequests).find((value) =>
    Object.values(value.executionIds).includes(request.executionId),
  )
  if (!qa) return
  const check = qa.checks.find(
    (value) => qa.executionIds[value.checkId] === request.executionId,
  )!
  const previous = state.toolExecutions[request.executionId]
  const retainedResult =
    previous && ['completed', 'failed', 'cancelled'].includes(previous.status)
  if (
    (qa.status !== 'running' && !retainedResult) ||
    qa.verifierAgentId !== request.agentId ||
    qa.inspectionTaskId !== request.taskId ||
    check.toolId !== request.toolId ||
    !equalJson(check.input, memorySafeJson(request.input, 4096))
  )
    throw new ToolFault(
      'QA_EXECUTION_CONFLICT',
      'QA evidence must use the configured verifier, tool and exact input.',
    )
}

function inspect(output: RuntimeJson, assertion: QAAssertion): boolean {
  let value: RuntimeJson | undefined = output
  for (const part of assertion.path) {
    if (
      value === null ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, part)
    )
      return false
    value = (value as Record<string, RuntimeJson>)[part]
  }
  if (value === undefined) return false
  switch (assertion.kind) {
    case 'exists':
      return value !== null
    case 'equals':
      return equalJson(value, assertion.value)
    case 'includes':
      return typeof value === 'string' && value.includes(assertion.value)
    case 'maximum':
      return typeof value === 'number' && value <= assertion.value
    case 'no-credentials': {
      // Redacted tool evidence cannot establish that the original value was clean.
      if (/\[REDACTED(?: PRIVATE KEY)?\]/u.test(JSON.stringify(value)))
        return false
      try {
        memorySafeJson(value, 65536)
        return true
      } catch (error) {
        if (error instanceof MemoryFault && error.code === 'SECRET_REJECTED')
          return false
        throw error
      }
    }
  }
}

function evaluateCheck(
  request: QARequest,
  check: QACheck,
  executions: RuntimeState['toolExecutions'],
): QACheckResult {
  const executionId = request.executionIds[check.checkId]
  const execution = executionId ? executions[executionId] : undefined
  const evidence = (
    matched: boolean | null,
    errorCode: string | null,
  ): readonly QAEvidence[] =>
    execution
      ? [
          {
            executionId: execution.executionId,
            toolId: execution.toolId,
            path: check.assertion.path,
            matched,
            errorCode,
          },
        ]
      : []
  const blocked = (code: string): QACheckResult => ({
    checkId: check.checkId,
    status: 'blocked',
    evidence: evidence(null, code),
  })
  if (!execution) return blocked('EXECUTION_UNAVAILABLE')
  if (
    execution.executionId !== executionId ||
    execution.toolId !== check.toolId ||
    execution.agentId !== request.verifierAgentId ||
    execution.taskId !== request.inspectionTaskId
  )
    return blocked('EVIDENCE_IDENTITY_MISMATCH')
  if (!execution.permission.allowed) return blocked('PERMISSION_DENIED')
  if (
    execution.status !== 'completed' ||
    !execution.startedAt ||
    !execution.completedAt
  )
    return blocked('EXECUTION_NOT_COMPLETED')
  try {
    publicToolJson(execution.output)
    const matched = inspect(execution.output, check.assertion)
    return {
      checkId: check.checkId,
      status: matched ? 'passed' : 'failed',
      evidence: evidence(matched, null),
    }
  } catch {
    return blocked('INVALID_EVIDENCE')
  }
}

/** Only committed tool evidence determines quality; callers cannot supply a pass claim. */
export function evaluateQA(
  request: QARequest,
  executions: RuntimeState['toolExecutions'],
  now: string,
): QAResult {
  requireQA(
    request.checks.length > 0 && request.checks.some((check) => check.required),
    'QA requires explicit required checks before evaluation.',
  )
  const checks = request.checks.map((check) =>
    evaluateCheck(request, check, executions),
  )
  const findings: QAFinding[] = checks.flatMap((result, index) => {
    if (result.status === 'passed') return []
    const check = request.checks[index]
    return [
      {
        findingId: `${request.qaId}:finding:${index + 1}`,
        checkId: check.checkId,
        title: check.title,
        description:
          result.status === 'blocked'
            ? 'Verification could not use completed, authorized tool evidence.'
            : 'The declared assertion did not match the completed tool evidence.',
        severity: check.severity,
        evidence: result.evidence,
        affectedTaskId: request.taskId,
        affectedArtifactId: request.artifactId,
        suggestedRepairType: result.status === 'failed' ? check.type : null,
      },
    ]
  })
  const status = checks.some(
    (result, index) =>
      result.status === 'blocked' && request.checks[index].required,
  )
    ? 'blocked'
    : checks.some(
          (result, index) =>
            result.status === 'failed' &&
            (request.checks[index].required ||
              ['error', 'critical'].includes(request.checks[index].severity)),
        )
      ? 'failed'
      : 'passed'
  return {
    qaId: request.qaId,
    status,
    checks,
    passedChecks: checks
      .filter((check) => check.status === 'passed')
      .map((check) => check.checkId),
    failedChecks: checks
      .filter((check) => check.status === 'failed')
      .map((check) => check.checkId),
    findings,
    evidence: checks.flatMap((check) => check.evidence),
    severity:
      severities[
        Math.max(
          0,
          ...findings.map((finding) => severities.indexOf(finding.severity)),
        )
      ],
    verifier:
      request.verifierAgentId && request.inspectionTaskId
        ? { agentId: request.verifierAgentId, taskId: request.inspectionTaskId }
        : null,
    startedAt: request.startedAt,
    completedAt: now,
  }
}
