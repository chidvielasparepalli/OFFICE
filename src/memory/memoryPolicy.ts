import type { RuntimeJson, RuntimeState } from '../runtime/runtimeTypes'
import {
  publicToolJson,
  redactToolText,
  toolId,
  toolObject,
} from '../tools/toolValidation'
import {
  MemoryFault,
  type MemoryGrant,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryScope,
  type MemoryTrust,
  type MemoryUpdate,
  type MemoryWriteInput,
} from './memoryTypes'

export function memoryAssert(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new MemoryFault(code, message)
}
export const memoryObject = toolObject
export function memoryId(value: unknown) {
  const id = toolId(value)
  memoryAssert(
    !['constructor', 'prototype', '__proto__'].includes(id),
    'INVALID_MEMORY',
    'Reserved memory identifier.',
  )
  return id
}
const types = ['working', 'episodic', 'semantic', 'project', 'preference']
export const importanceOrder = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
} as const
const trusts = ['verified', 'observed', 'inferred', 'unverified']
const reasons = [
  'decision',
  'constraint',
  'approach',
  'lesson',
  'preference',
  'fact',
  'outcome',
]

/** Reuse bounded public JSON validation, but reject rather than retain redacted secrets. */
export function memorySafeJson(value: unknown): RuntimeJson {
  let safe: RuntimeJson
  try {
    safe = publicToolJson(value, 8192)
  } catch {
    throw new MemoryFault(
      'INVALID_MEMORY',
      'Memory must be bounded, finite JSON.',
    )
  }
  const original = JSON.stringify(value)
  memoryAssert(
    JSON.stringify(safe) === original,
    'SECRET_REJECTED',
    'Credential-like content cannot be stored in ordinary memory.',
  )
  memoryAssert(
    !/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/u.test(
      original,
    ),
    'SECRET_REJECTED',
    'Credential-like content cannot be stored in ordinary memory.',
  )
  return safe
}
export function memoryText(value: unknown, max = 4000): string {
  memoryAssert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    'INVALID_MEMORY',
    'Memory text must be nonempty and bounded.',
  )
  memoryAssert(
    ![...value].some(
      (c) => c.charCodeAt(0) < 32 && !['\n', '\t', '\r'].includes(c),
    ),
    'INVALID_MEMORY',
    'Invalid control character.',
  )
  memoryAssert(
    redactToolText(value) === value,
    'SECRET_REJECTED',
    'Credential-like content cannot be stored in ordinary memory.',
  )
  memoryAssert(
    !/["']?(?:password|api[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?[^\s"',;}]+/iu.test(
      value,
    ) && !/https?:\/\/[^\s/:]+:[^\s/@]+@/iu.test(value),
    'SECRET_REJECTED',
    'Credential-like content cannot be stored in ordinary memory.',
  )
  memorySafeJson(value)
  return value.trim()
}
export function memoryScope(value: unknown): MemoryScope {
  const scope = memoryObject(value, ['kind', 'id'])
  memoryAssert(
    ['agent', 'task', 'project', 'organization'].includes(scope.kind as string),
    'INVALID_SCOPE',
    'Unsupported memory scope.',
  )
  return { kind: scope.kind as MemoryScope['kind'], id: memoryId(scope.id) }
}
export function copyMemoryPolicy(input: MemoryPolicy): MemoryPolicy {
  memoryObject(input, ['grants'])
  memoryAssert(
    Array.isArray(input.grants) && input.grants.length <= 1000,
    'INVALID_POLICY',
    'Memory grants must be a bounded list.',
  )
  return Object.freeze({
    grants: Object.freeze(
      input.grants.map((value) => {
        const grant = memoryObject(value, [
          'agentId',
          'scope',
          'permissions',
          'allowSourceAttribution',
        ])
        memoryAssert(
          Array.isArray(grant.permissions) &&
            grant.permissions.length > 0 &&
            grant.permissions.every((p) =>
              ['read', 'write', 'verify'].includes(p),
            ),
          'INVALID_POLICY',
          'Unsupported memory permission.',
        )
        memoryAssert(
          grant.allowSourceAttribution === undefined ||
            typeof grant.allowSourceAttribution === 'boolean',
          'INVALID_POLICY',
          'Source attribution must be explicit.',
        )
        return Object.freeze({
          agentId: memoryId(grant.agentId),
          scope: Object.freeze(memoryScope(grant.scope)),
          permissions: Object.freeze([
            ...new Set(grant.permissions),
          ]) as MemoryGrant['permissions'],
          allowSourceAttribution: grant.allowSourceAttribution === true,
        })
      }),
    ),
  })
}
function matchingGrants(
  policy: MemoryPolicy,
  actorId: string,
  scope: MemoryScope,
) {
  return policy.grants.filter(
    (g) =>
      g.agentId === actorId &&
      g.scope.kind === scope.kind &&
      g.scope.id === scope.id,
  )
}
export function requireMemoryAccess(
  state: RuntimeState,
  policy: MemoryPolicy,
  actorId: string,
  input: MemoryScope,
  permission: 'read' | 'write' | 'verify',
) {
  memoryId(actorId)
  const scope = memoryScope(input)
  memoryAssert(
    Object.hasOwn(state.agents, actorId),
    'MEMORY_ACCESS_DENIED',
    'Memory access is not authorized.',
  )
  const intrinsic =
    permission !== 'verify' &&
    ((scope.kind === 'agent' && scope.id === actorId) ||
      (scope.kind === 'task' &&
        Object.hasOwn(state.tasks, scope.id) &&
        state.tasks[scope.id].assignedAgentId === actorId))
  memoryAssert(
    intrinsic ||
      matchingGrants(policy, actorId, scope).some((g) =>
        g.permissions.includes(permission),
      ),
    'MEMORY_ACCESS_DENIED',
    'Memory access is not authorized.',
  )
  if (scope.kind === 'agent')
    memoryAssert(
      Object.hasOwn(state.agents, scope.id),
      'INVALID_SCOPE',
      'Unknown agent scope.',
    )
  if (scope.kind === 'task')
    memoryAssert(
      Object.hasOwn(state.tasks, scope.id),
      'INVALID_SCOPE',
      'Unknown task scope.',
    )
}
export function taskProject(
  state: RuntimeState,
  taskId: string,
): string | null {
  const value = state.tasks[taskId]?.metadata.projectId
  return value === undefined || value === null ? null : memoryId(value)
}
export function requireRecordAccess(
  state: RuntimeState,
  policy: MemoryPolicy,
  actorId: string,
  record: MemoryRecord,
  permission: 'read' | 'write',
) {
  requireMemoryAccess(state, policy, actorId, record.scope, permission)
  if (record.projectId && record.scope.kind !== 'project')
    requireMemoryAccess(
      state,
      policy,
      actorId,
      { kind: 'project', id: record.projectId },
      'read',
    )
}
export function isActiveMemory(record: MemoryRecord, now: string) {
  return (
    record.status === 'active' &&
    (record.retention.expiresAt === null ||
      Date.parse(record.retention.expiresAt) > Date.parse(now))
  )
}
function verification(
  state: RuntimeState,
  policy: MemoryPolicy,
  actorId: string,
  scope: MemoryScope,
  trust: MemoryTrust,
  evidence: unknown,
  now: string,
) {
  memoryAssert(
    trusts.includes(trust),
    'INVALID_TRUST',
    'Unsupported memory trust.',
  )
  if (trust !== 'verified') {
    memoryAssert(
      evidence === undefined,
      'INVALID_TRUST',
      'Verification evidence requires an explicit verified assertion.',
    )
    return null
  }
  requireMemoryAccess(state, policy, actorId, scope, 'verify')
  return { agentId: actorId, evidence: memoryText(evidence, 1000), at: now }
}
export function createMemoryRecord(
  state: RuntimeState,
  policy: MemoryPolicy,
  actorId: string,
  input: MemoryWriteInput,
  id: string,
  now: string,
  supersedesId: string | null = null,
): MemoryRecord {
  memoryObject(input, [
    'id',
    'scope',
    'projectId',
    'type',
    'content',
    'metadata',
    'importance',
    'trust',
    'source',
    'reason',
    'rationale',
    'verificationEvidence',
  ])
  memorySafeJson(input)
  const scope = memoryScope(input.scope)
  requireMemoryAccess(state, policy, actorId, scope, 'write')
  memoryAssert(
    types.includes(input.type),
    'INVALID_TYPE',
    'Unsupported memory type.',
  )
  memoryAssert(
    reasons.includes(input.reason),
    'INVALID_REASON',
    'Memory requires an explicit useful write reason.',
  )
  const importance = input.importance ?? 'normal'
  memoryAssert(
    Object.hasOwn(importanceOrder, importance),
    'INVALID_IMPORTANCE',
    'Unsupported importance.',
  )
  const projectId =
    scope.kind === 'project'
      ? scope.id
      : scope.kind === 'task'
        ? taskProject(state, scope.id)
        : (input.projectId ?? null)
  if (input.projectId !== undefined)
    memoryAssert(
      input.projectId === projectId,
      'PROJECT_MISMATCH',
      'Memory project must match its scope.',
    )
  if (projectId) {
    memoryId(projectId)
    requireMemoryAccess(
      state,
      policy,
      actorId,
      { kind: 'project', id: projectId },
      'read',
    )
  }
  const sourceInput = memoryObject(input.source, ['kind', 'id'])
  const source = {
    kind: sourceInput.kind as MemoryRecord['source']['kind'],
    id: memoryId(sourceInput.id),
  }
  memoryAssert(
    ['user', 'task', 'agent', 'tool', 'manager', 'system'].includes(
      source.kind,
    ),
    'INVALID_SOURCE',
    'Unsupported memory source.',
  )
  if (source.kind === 'agent' || source.kind === 'manager') {
    memoryAssert(
      source.id === actorId &&
        (source.kind !== 'manager' || state.agents[actorId].kind === 'manager'),
      'INVALID_SOURCE',
      'An agent cannot impersonate another source.',
    )
  } else if (source.kind === 'task') {
    requireMemoryAccess(
      state,
      policy,
      actorId,
      { kind: 'task', id: source.id },
      'read',
    )
    memoryAssert(
      ['completed', 'failed', 'cancelled'].includes(
        state.tasks[source.id].status,
      ),
      'TASK_NOT_COMPLETED',
      'Task outcome memory requires a recorded terminal task outcome.',
    )
    memoryAssert(
      taskProject(state, source.id) === projectId,
      'PROJECT_MISMATCH',
      'Task evidence must belong to the same project.',
    )
  } else if (source.kind === 'tool') {
    const execution = Object.hasOwn(state.toolExecutions, source.id)
      ? state.toolExecutions[source.id]
      : null
    memoryAssert(
      execution?.status === 'completed' && execution.agentId === actorId,
      'INVALID_SOURCE',
      'Tool evidence must reference this agent’s completed execution.',
    )
    memoryAssert(
      taskProject(state, execution.taskId) === projectId,
      'PROJECT_MISMATCH',
      'Tool evidence must belong to the same project.',
    )
    memoryAssert(
      input.trust === 'unverified',
      'INVALID_TRUST',
      'Tool-derived memory starts unverified; verification is a separate authorized operation.',
    )
  } else {
    memoryAssert(
      matchingGrants(policy, actorId, scope).some(
        (g) => g.allowSourceAttribution && g.permissions.includes('write'),
      ),
      'INVALID_SOURCE',
      'User/system attribution requires an explicit host grant.',
    )
  }
  const verified = verification(
    state,
    policy,
    actorId,
    scope,
    input.trust,
    input.verificationEvidence,
    now,
  )
  const content = memoryText(input.content)
  const rationale = memoryText(input.rationale, 500)
  const metadata = memorySafeJson(input.metadata ?? {}) as Readonly<
    Record<string, RuntimeJson>
  >
  memoryObject(metadata, Object.keys(metadata))
  const hours = { low: 1, normal: 8, high: 24, critical: 72 }[importance]
  const retention: MemoryRecord['retention'] =
    input.type === 'working'
      ? {
          kind: 'working',
          expiresAt: new Date(Date.parse(now) + hours * 3600000).toISOString(),
        }
      : input.type === 'episodic' || scope.kind === 'task'
        ? { kind: 'history', expiresAt: null }
        : { kind: 'persistent', expiresAt: null }
  return {
    id,
    agentId: actorId,
    scope,
    projectId,
    type: input.type,
    content,
    metadata,
    importance,
    trust: input.trust,
    source,
    reason: input.reason,
    rationale,
    verification: verified,
    retention,
    status: 'active',
    supersedesId,
    supersededById: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }
}
export function updateMemoryRecord(
  state: RuntimeState,
  policy: MemoryPolicy,
  actorId: string,
  prior: MemoryRecord,
  patch: MemoryUpdate,
  now: string,
): MemoryRecord {
  memoryObject(patch, [
    'importance',
    'metadata',
    'trust',
    'verificationEvidence',
  ])
  memorySafeJson(patch)
  requireRecordAccess(state, policy, actorId, prior, 'write')
  memoryAssert(
    Object.keys(patch).length > 0,
    'INVALID_MEMORY',
    'An update must change an allowed field.',
  )
  const importance = patch.importance ?? prior.importance
  memoryAssert(
    Object.hasOwn(importanceOrder, importance),
    'INVALID_IMPORTANCE',
    'Unsupported importance.',
  )
  const trust = patch.trust ?? prior.trust
  memoryAssert(
    !(
      prior.trust === 'verified' &&
      patch.metadata !== undefined &&
      patch.trust === undefined
    ),
    'INVALID_TRUST',
    'Changing verified metadata requires explicit trust and verification evidence.',
  )
  const verified =
    patch.trust !== undefined || patch.verificationEvidence !== undefined
      ? verification(
          state,
          policy,
          actorId,
          prior.scope,
          trust,
          patch.verificationEvidence,
          now,
        )
      : prior.verification
  memoryAssert(
    prior.source.kind !== 'tool' ||
      trust === 'unverified' ||
      trust === 'verified',
    'INVALID_TRUST',
    'Tool evidence requires explicit verification before promotion.',
  )
  const metadata =
    patch.metadata === undefined
      ? prior.metadata
      : (memorySafeJson(patch.metadata) as MemoryRecord['metadata'])
  memoryObject(metadata, Object.keys(metadata))
  // Updating importance cannot prolong expired working context; create a new explicit record.
  return {
    ...prior,
    importance,
    trust,
    verification: verified,
    metadata,
    updatedAt: now,
    revision: prior.revision + 1,
  }
}
