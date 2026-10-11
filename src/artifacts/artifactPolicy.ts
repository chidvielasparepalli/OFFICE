import {
  memoryId,
  memoryObject,
  memorySafeJson,
  memoryText,
} from '../memory/memoryPolicy'
import type { RuntimeState, RuntimeTask } from '../runtime/runtimeTypes'
import {
  artifactTypes,
  ArtifactFault,
  type Artifact,
  type ArtifactContentReference,
  type ArtifactExpectation,
  type ArtifactPolicy,
  type ArtifactScope,
  type ArtifactCreateInput,
  type ArtifactVersionInput,
  type ArtifactGrant,
} from './artifactTypes'

export function artifactAssert(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new ArtifactFault(code, message)
}
export function artifactScope(input: unknown): ArtifactScope {
  const scope = memoryObject(input, ['kind', 'id'])
  artifactAssert(
    ['agent', 'task', 'project'].includes(scope.kind as string),
    'INVALID_ARTIFACT_SCOPE',
    'Artifact scope is unsupported.',
  )
  return { kind: scope.kind as ArtifactScope['kind'], id: memoryId(scope.id) }
}
export function validateArtifactExpectations(
  input: unknown,
): readonly ArtifactExpectation[] {
  if (input === undefined) return []
  memorySafeJson(input)
  artifactAssert(
    Array.isArray(input) && input.length <= 16,
    'INVALID_OUTPUTS',
    'Expected outputs must be a bounded list.',
  )
  const roles = new Set<string>()
  return Array.from(input, (entry) => {
    const item = memoryObject(entry, ['role', 'type', 'count'])
    const role = memoryId(item.role)
    artifactAssert(
      !roles.has(role) &&
        artifactTypes.includes(item.type as Artifact['type']) &&
        Number.isInteger(item.count) &&
        (item.count as number) >= 1 &&
        (item.count as number) <= 16,
      'INVALID_OUTPUTS',
      'Output roles must be unique with supported types and counts from one to sixteen.',
    )
    roles.add(role)
    return {
      role,
      type: item.type as Artifact['type'],
      count: item.count as number,
    }
  })
}
export function copyArtifactPolicy(input: ArtifactPolicy): ArtifactPolicy {
  memoryObject(input, ['grants'])
  artifactAssert(
    Array.isArray(input.grants) && input.grants.length <= 1000,
    'INVALID_ARTIFACT_POLICY',
    'Artifact grants must be bounded.',
  )
  return Object.freeze({
    grants: Object.freeze(
      input.grants.map((grant) => {
        memoryObject(grant, ['agentId', 'scope', 'permissions'])
        artifactAssert(
          Array.isArray(grant.permissions) &&
            grant.permissions.length > 0 &&
            grant.permissions.every((p: unknown) =>
              ['read', 'modify', 'archive', 'import'].includes(p as string),
            ),
          'INVALID_ARTIFACT_POLICY',
          'Unsupported artifact permission.',
        )
        return Object.freeze({
          agentId: memoryId(grant.agentId),
          scope: Object.freeze(artifactScope(grant.scope)),
          permissions: Object.freeze([
            ...new Set(grant.permissions),
          ]) as ArtifactGrant['permissions'],
        })
      }),
    ),
  })
}
export function taskProject(task: RuntimeTask | undefined): string | null {
  return typeof task?.metadata.projectId === 'string'
    ? task.metadata.projectId
    : null
}
export function controlsTask(
  state: RuntimeState,
  agentId: string,
  taskId: string,
): boolean {
  const task = state.tasks[taskId]
  if (!task) return false
  return (
    task.assignedAgentId === agentId ||
    (task.assignedAgentId !== null &&
      state.agents[task.assignedAgentId]?.managerId === agentId) ||
    Object.values(state.plans).some(
      (plan) =>
        plan.taskIds.includes(taskId) &&
        state.requests[plan.requestId]?.managerId === agentId,
    )
  )
}
export function hasArtifactScopeAccess(
  state: RuntimeState,
  policy: ArtifactPolicy,
  agentId: string,
  scope: ArtifactScope,
  permission: 'read' | 'modify' | 'archive' | 'import',
): boolean {
  if (state.connection !== 'local' || !Object.hasOwn(state.agents, agentId))
    return false
  if (
    permission !== 'import' &&
    ((scope.kind === 'agent' && scope.id === agentId) ||
      (scope.kind === 'task' && controlsTask(state, agentId, scope.id)))
  )
    return true
  return policy.grants.some(
    (g) =>
      g.agentId === agentId &&
      g.scope.kind === scope.kind &&
      g.scope.id === scope.id &&
      g.permissions.includes(permission),
  )
}
export function canAccessArtifact(
  state: RuntimeState,
  policy: ArtifactPolicy,
  agentId: string,
  artifact: Artifact,
  permission: 'read' | 'modify' | 'archive',
): boolean {
  if (
    hasArtifactScopeAccess(state, policy, agentId, artifact.scope, permission)
  )
    return true
  if (
    permission === 'read' &&
    state.connection === 'local' &&
    Object.hasOwn(state.agents, agentId) &&
    artifact.agentId === agentId
  )
    return true
  if (
    permission !== 'archive' &&
    state.connection === 'local' &&
    Object.values(state.repairRequests).some(
      (repair) =>
        repair.responsibleAgentId === agentId &&
        ['assigned', 'in_progress', 'completed'].includes(repair.status) &&
        state.qaRequests[repair.sourceQaId]?.artifactId === artifact.artifactId,
    )
  )
    return true
  if (
    permission !== 'read' ||
    state.connection !== 'local' ||
    !Object.hasOwn(state.agents, agentId)
  )
    return false
  // Explicit input handoff and active inspection grant only the exact version to the assignee.
  return (
    Object.values(state.tasks).some(
      (task) =>
        task.assignedAgentId === agentId &&
        task.inputArtifactIds?.includes(artifact.artifactId),
    ) ||
    Object.values(state.qaRequests).some(
      (qa) =>
        qa.artifactId === artifact.artifactId &&
        qa.status === 'running' &&
        qa.verifierAgentId === agentId &&
        qa.inspectionTaskId !== null &&
        state.tasks[qa.inspectionTaskId]?.status === 'in_progress',
    )
  )
}
export function validateContentReference(
  input: unknown,
): ArtifactContentReference {
  const value = memoryObject(input, [
    'storageId',
    'contentId',
    'byteLength',
    'mediaType',
    'sha256',
  ])
  memorySafeJson(value)
  artifactAssert(
    typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(value.sha256) &&
      Number.isSafeInteger(value.byteLength) &&
      (value.byteLength as number) >= 0 &&
      typeof value.mediaType === 'string' &&
      /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(value.mediaType),
    'INVALID_CONTENT',
    'Content integrity metadata is invalid.',
  )
  return {
    storageId: memoryId(value.storageId),
    contentId: memoryId(value.contentId),
    byteLength: value.byteLength as number,
    mediaType: value.mediaType,
    sha256: value.sha256,
  }
}
export function validateArtifactInput(
  input: ArtifactCreateInput,
): ArtifactCreateInput {
  const safe = memorySafeJson(input, 16384) as unknown as ArtifactCreateInput
  memoryObject(safe, [
    'artifactId',
    'name',
    'description',
    'type',
    'role',
    'outputRole',
    'taskId',
    'projectId',
    'scope',
    'status',
    'source',
    'content',
    'metadata',
    'derivedFromArtifactIds',
  ])
  if (safe.artifactId !== undefined) memoryId(safe.artifactId)
  memoryText(safe.name, 160)
  memoryText(safe.description, 2000)
  artifactAssert(
    artifactTypes.includes(safe.type) &&
      ['input', 'output'].includes(safe.role),
    'INVALID_ARTIFACT',
    'Unsupported artifact type or role.',
  )
  artifactAssert(
    safe.status === undefined ||
      ['created', 'in_progress', 'completed', 'failed'].includes(safe.status),
    'INVALID_ARTIFACT',
    'Artifact creation cannot assert verification.',
  )
  if (safe.taskId !== undefined) memoryId(safe.taskId)
  if (safe.projectId !== undefined) memoryId(safe.projectId)
  artifactAssert(
    safe.role === 'input'
      ? safe.outputRole === undefined && safe.taskId === undefined
      : typeof safe.outputRole === 'string' && !!safe.taskId,
    'INVALID_ARTIFACT',
    'Outputs require an owning task and role; inputs are associated only through explicit input handoff.',
  )
  if (safe.outputRole !== undefined) memoryId(safe.outputRole)
  artifactScope(safe.scope)
  validateContentReference(safe.content)
  if (safe.metadata !== undefined)
    memoryObject(safe.metadata, Object.keys(safe.metadata))
  artifactAssert(
    safe.derivedFromArtifactIds === undefined ||
      (Array.isArray(safe.derivedFromArtifactIds) &&
        safe.derivedFromArtifactIds.length <= 16),
    'INVALID_ARTIFACT',
    'Artifact derivations must be bounded.',
  )
  safe.derivedFromArtifactIds?.forEach(memoryId)
  return safe
}
export function validateVersionInput(
  input: ArtifactVersionInput,
): ArtifactVersionInput {
  const safe = memorySafeJson(input, 16384) as unknown as ArtifactVersionInput
  memoryObject(safe, [
    'artifactId',
    'name',
    'description',
    'source',
    'content',
    'metadata',
    'status',
  ])
  return safe
}
