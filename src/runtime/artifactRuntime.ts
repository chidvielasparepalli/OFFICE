import {
  artifactAssert as ensure,
  artifactScope,
  canAccessArtifact,
  controlsTask,
  hasArtifactScopeAccess,
  taskProject,
  validateArtifactInput,
  validateContentReference,
  validateVersionInput,
} from '../artifacts/artifactPolicy'
import {
  type Artifact,
  type ArtifactCreateInput,
  type ArtifactPolicy,
  type ArtifactRuntimeCommand,
  type ArtifactSource,
  type ArtifactSourceInput,
  type ArtifactStorage,
} from '../artifacts/artifactTypes'
import {
  memoryId,
  memoryObject,
  memorySafeJson,
  memoryText,
} from '../memory/memoryPolicy'
import type { QARequest } from '../qa/qaTypes'
import { taskVerification } from '../qa/qaSelectors'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type {
  RuntimeAgent,
  RuntimeCommand,
  RuntimeState,
  RuntimeTask,
} from './runtimeTypes'

interface ArtifactTransaction extends OrchestrationTransaction {
  readonly artifactPolicy: ArtifactPolicy
  readonly artifactStorage: ArtifactStorage | undefined
  taskPatch(id: string, patch: Partial<RuntimeTask>): void
  agentPatch(id: string, patch: Partial<RuntimeAgent>): void
  reconcileDependencies(): void
}
const commands = new Set([
  'createArtifact',
  'versionArtifact',
  'updateArtifact',
  'archiveArtifact',
  'linkInputArtifact',
])
export function isArtifactRuntimeCommand(
  command: RuntimeCommand,
): command is ArtifactRuntimeCommand {
  return commands.has(command.type)
}
function get(tx: Pick<ArtifactTransaction, 'state'>, id: string): Artifact {
  memoryId(id)
  ensure(
    Object.hasOwn(tx.state.artifacts, id),
    'ARTIFACT_NOT_FOUND',
    'Artifact version is unavailable.',
  )
  return tx.state.artifacts[id]
}
function put(tx: OrchestrationTransaction, artifact: Artifact) {
  tx.state = {
    ...tx.state,
    artifacts: { ...tx.state.artifacts, [artifact.artifactId]: artifact },
  }
}
function access(
  tx: ArtifactTransaction,
  actorId: string,
  artifact: Artifact,
  permission: 'read' | 'modify' | 'archive',
) {
  ensure(
    canAccessArtifact(
      tx.state,
      tx.artifactPolicy,
      actorId,
      artifact,
      permission,
    ),
    'ARTIFACT_ACCESS_DENIED',
    'Artifact access is not authorized.',
  )
}
function openOutput(tx: ArtifactTransaction, taskId: string | null) {
  if (taskId === null) return
  const plan = Object.values(tx.state.plans).find((p) =>
    p.taskIds.includes(taskId),
  )
  ensure(
    !plan || !['completed', 'failed', 'cancelled'].includes(plan.status),
    'ARTIFACT_WORKFLOW_CLOSED',
    'Output mutation cannot reopen a closed workflow.',
  )
  ensure(
    !Object.values(tx.state.tasks).some(
      (t) =>
        t.dependencyIds.includes(taskId) &&
        t.startedAt !== null &&
        t.status !== 'cancelled',
    ),
    'ARTIFACT_ALREADY_CONSUMED',
    'Output mutation cannot silently replace an already consumed dependency.',
  )
}
function noActiveQA(tx: ArtifactTransaction, artifact: Artifact) {
  ensure(
    !Object.values(tx.state.qaRequests).some(
      (qa) =>
        qa.artifactId === artifact.artifactId &&
        ['queued', 'running'].includes(qa.status),
    ),
    'ARTIFACT_QA_ACTIVE',
    'Finish or cancel inspection before changing this version lifecycle.',
  )
}
function source(
  tx: ArtifactTransaction,
  agentId: string,
  input: ArtifactSourceInput,
  content: Artifact['content'],
): ArtifactSource {
  const base: ArtifactSource = {
    kind: input.kind,
    taskId: null,
    agentId: null,
    executionId: null,
    toolId: null,
    requestId: null,
    userReference: null,
    recordedByAgentId: agentId,
  }
  if (input.kind === 'user') {
    memoryObject(input, ['kind', 'reference'])
    return { ...base, userReference: memoryId(input.reference) }
  }
  if (input.kind === 'tool') {
    memoryObject(input, ['kind', 'executionId'])
    memoryId(input.executionId)
    const execution = tx.state.toolExecutions[input.executionId]
    ensure(
      execution?.status === 'completed' &&
        execution.permission.allowed &&
        execution.agentId === agentId &&
        execution.startedAt !== null &&
        execution.completedAt !== null,
      'INVALID_ARTIFACT_SOURCE',
      'Tool provenance requires an actual successful execution by the producing agent.',
    )
    const output = execution.output
    ensure(
      output !== null &&
        typeof output === 'object' &&
        !Array.isArray(output) &&
        'content' in output,
      'INVALID_ARTIFACT_SOURCE',
      'The tool result must reference the produced immutable content.',
    )
    const recorded = validateContentReference(
      (output as Record<string, unknown>).content,
    )
    ensure(
      Object.keys(recorded).every(
        (key) =>
          recorded[key as keyof typeof recorded] ===
          content[key as keyof typeof recorded],
      ),
      'INVALID_ARTIFACT_SOURCE',
      'Tool output content does not match this artifact.',
    )
    return {
      ...base,
      taskId: execution.taskId,
      agentId,
      executionId: execution.executionId,
      toolId: execution.toolId,
    }
  }
  ensure(
    input.kind === 'task' || input.kind === 'manager',
    'INVALID_ARTIFACT_SOURCE',
    'Artifact provenance is required.',
  )
  memoryObject(
    input,
    input.kind === 'task'
      ? ['kind', 'taskId']
      : ['kind', 'taskId', 'requestId'],
  )
  const task = tx.task(memoryId(input.taskId))
  ensure(
    task.assignedAgentId === agentId &&
      ['in_progress', 'completed'].includes(task.status),
    'INVALID_ARTIFACT_SOURCE',
    'Task provenance requires the producing agent and a started task.',
  )
  if (input.kind === 'manager') {
    const request = tx.state.requests[memoryId(input.requestId)]
    ensure(
      tx.agent(agentId).kind === 'manager' &&
        request?.managerId === agentId &&
        request.coordinationTaskId === task.id,
      'INVALID_ARTIFACT_SOURCE',
      'Manager provenance must reference the owned request and coordination task.',
    )
    return { ...base, taskId: task.id, agentId, requestId: request.requestId }
  }
  return { ...base, taskId: task.id, agentId }
}
function build(
  tx: ArtifactTransaction,
  agentId: string,
  raw: ArtifactCreateInput,
  prior?: Artifact,
): Artifact {
  const input = validateArtifactInput(raw)
  tx.agent(memoryId(agentId))
  const scope = artifactScope(input.scope)
  ensure(
    prior
      ? canAccessArtifact(tx.state, tx.artifactPolicy, agentId, prior, 'modify')
      : hasArtifactScopeAccess(
          tx.state,
          tx.artifactPolicy,
          agentId,
          scope,
          'modify',
        ),
    'ARTIFACT_ACCESS_DENIED',
    'Artifact creation is not authorized for this scope.',
  )
  const reference = validateContentReference(input.content)
  const content = tx.artifactStorage?.inspect(reference)
  ensure(
    content,
    'CONTENT_NOT_FOUND',
    'Artifact content must exist in the configured immutable storage.',
  )
  const provenance = source(tx, agentId, input.source, content)
  const taskId = input.taskId ?? null
  const projectId = input.projectId ?? null
  if (scope.kind === 'task') {
    tx.task(scope.id)
    ensure(
      taskId === null || scope.id === taskId,
      'INVALID_ARTIFACT_SCOPE',
      'Task-scoped outputs must use their owning task.',
    )
  }
  if (scope.kind === 'agent') tx.agent(scope.id)
  if (scope.kind === 'project')
    ensure(
      projectId === scope.id,
      'INVALID_ARTIFACT_SCOPE',
      'Project scope must match the artifact project.',
    )
  if (taskId !== null) {
    const task = tx.task(taskId)
    ensure(
      projectId === taskProject(task),
      'INVALID_ARTIFACT_PROJECT',
      'Artifact project must match its owning task.',
    )
  }
  if (provenance.kind === 'user') {
    ensure(
      input.role === 'input' &&
        hasArtifactScopeAccess(
          tx.state,
          tx.artifactPolicy,
          agentId,
          scope,
          'import',
        ),
      'ARTIFACT_ACCESS_DENIED',
      'User input attribution requires an explicit host import grant.',
    )
  } else {
    ensure(
      input.role === 'output' && taskId !== null,
      'INVALID_ARTIFACT_SOURCE',
      'Agent-produced content must be an output of a task.',
    )
    const producer = tx.task(provenance.taskId!)
    ensure(
      ['in_progress', 'completed'].includes(producer.status),
      'INVALID_ARTIFACT_SOURCE',
      'Producing task must have started and not failed or been cancelled.',
    )
    const repair = Object.values(tx.state.repairRequests).find(
      (r) => r.taskId === producer.id && r.sourceTaskId === taskId,
    )
    ensure(
      producer.id === taskId ||
        (prior !== undefined &&
          repair &&
          tx.state.qaRequests[repair.sourceQaId]?.artifactId ===
            prior.artifactId),
      'INVALID_ARTIFACT_SOURCE',
      'Output must belong to its producing task or the matching canonical repair.',
    )
    if (
      prior &&
      Object.values(tx.state.qaRequests).some(
        (qa) => qa.artifactId === prior.artifactId && qa.status === 'failed',
      )
    )
      ensure(
        repair &&
          repair.responsibleAgentId === agentId &&
          ['in_progress', 'completed'].includes(repair.status),
        'INVALID_ARTIFACT_SOURCE',
        'Failed artifact repair requires its assigned canonical repair task.',
      )
    openOutput(tx, taskId)
  }
  for (const id of input.derivedFromArtifactIds ?? []) {
    access(tx, agentId, get(tx, id), 'read')
  }
  const artifactId =
    input.artifactId === undefined
      ? tx.id('artifact')
      : memoryId(input.artifactId)
  ensure(
    !Object.hasOwn(tx.state.artifacts, artifactId),
    'DUPLICATE_ARTIFACT',
    'Artifact version ID is already used.',
  )
  return {
    artifactId,
    lineageId: prior?.lineageId ?? artifactId,
    name: memoryText(input.name, 160),
    description: memoryText(input.description, 2000),
    type: input.type,
    role: input.role,
    outputRole: input.outputRole ?? null,
    taskId,
    agentId: provenance.agentId,
    projectId,
    scope,
    status: input.status ?? 'created',
    version: prior ? prior.version + 1 : 1,
    revision: 1,
    createdAt: tx.time,
    updatedAt: tx.time,
    source: provenance,
    content: { ...content },
    metadata: input.metadata ?? {},
    derivedFromArtifactIds: [...new Set(input.derivedFromArtifactIds ?? [])],
    supersedesArtifactId: prior?.artifactId ?? null,
    supersededByArtifactId: null,
    verifiedByQA: null,
  }
}
function linkOutput(tx: ArtifactTransaction, artifact: Artifact) {
  if (artifact.role !== 'output' || artifact.taskId === null) return
  for (const id of new Set([artifact.taskId, artifact.source.taskId!])) {
    const task = tx.task(id)
    tx.taskPatch(id, {
      outputArtifactIds: [
        ...new Set([...(task.outputArtifactIds ?? []), artifact.artifactId]),
      ],
    })
  }
}
function reconcileArtifactVerification(
  tx: ArtifactTransaction,
  artifact: Artifact,
) {
  if (artifact.taskId === null) return
  const verification = taskVerification(tx.state, artifact.taskId)
  if (verification) {
    tx.taskPatch(artifact.taskId, { verification })
    const task = tx.task(artifact.taskId)
    const agent = task.assignedAgentId ? tx.agent(task.assignedAgentId) : null
    if (
      task.status === 'completed' &&
      agent?.currentTaskId === task.id &&
      agent.status !== 'repair'
    )
      tx.agentPatch(agent.id, {
        status: verification.needsAttention
          ? 'blocked'
          : verification.status === 'verified'
            ? 'completed'
            : 'waiting',
        destination: null,
        collaboratorIds: [],
        blockers: verification.needsAttention
          ? ['Output verification requires attention.']
          : [],
      })
  }
}
export function applyArtifactRuntimeCommand(
  tx: ArtifactTransaction,
  command: ArtifactRuntimeCommand,
): void {
  tx.agent(memoryId(command.agentId))
  if (command.type === 'createArtifact') {
    const artifact = build(tx, command.agentId, command.artifact)
    put(tx, artifact)
    linkOutput(tx, artifact)
    tx.emit(
      'ARTIFACT_CREATED',
      'Artifact version created.',
      command.agentId,
      artifact.taskId,
      { artifactId: artifact.artifactId },
    )
    tx.reconcileDependencies()
    return
  }
  const artifact = get(tx, command.artifactId)
  if (command.type === 'linkInputArtifact') {
    const task = tx.task(memoryId(command.taskId))
    access(tx, command.agentId, artifact, 'read')
    ensure(
      controlsTask(tx.state, command.agentId, task.id),
      'ARTIFACT_ACCESS_DENIED',
      'Input handoff requires authority over the receiving task.',
    )
    ensure(
      !['failed', 'archived', 'superseded'].includes(artifact.status) &&
        task.startedAt === null &&
        !['completed', 'failed', 'cancelled'].includes(task.status),
      'INVALID_ARTIFACT_TRANSITION',
      'Input must be usable and linked before task execution.',
    )
    if (task.inputArtifactIds?.includes(artifact.artifactId)) return
    tx.taskPatch(task.id, {
      inputArtifactIds: [...(task.inputArtifactIds ?? []), artifact.artifactId],
    })
    tx.emit(
      'ARTIFACT_INPUT_LINKED',
      'Artifact explicitly linked as task input.',
      command.agentId,
      task.id,
      { artifactId: artifact.artifactId },
    )
    return
  }
  access(
    tx,
    command.agentId,
    artifact,
    command.type === 'archiveArtifact' ? 'archive' : 'modify',
  )
  ensure(
    command.expectedRevision === artifact.revision,
    'STALE_ARTIFACT',
    'Artifact revision is stale.',
  )
  ensure(
    artifact.supersededByArtifactId === null &&
      !['archived', 'superseded'].includes(artifact.status),
    'INVALID_ARTIFACT_TRANSITION',
    'Historical or archived versions cannot be changed.',
  )
  openOutput(tx, artifact.role === 'output' ? artifact.taskId : null)
  noActiveQA(tx, artifact)
  if (command.type === 'versionArtifact') {
    const input = validateVersionInput(command.replacement)
    const replacement = build(
      tx,
      command.agentId,
      {
        ...(input.artifactId === undefined
          ? {}
          : { artifactId: input.artifactId }),
        name: input.name ?? artifact.name,
        description: input.description ?? artifact.description,
        type: artifact.type,
        role: artifact.role,
        ...(artifact.outputRole === null
          ? {}
          : { outputRole: artifact.outputRole }),
        ...(artifact.taskId === null ? {} : { taskId: artifact.taskId }),
        ...(artifact.projectId === null
          ? {}
          : { projectId: artifact.projectId }),
        scope: artifact.scope,
        source: input.source,
        content: input.content,
        status: input.status ?? 'completed',
        metadata: input.metadata ?? artifact.metadata,
        derivedFromArtifactIds: [artifact.artifactId],
      },
      artifact,
    )
    put(tx, {
      ...artifact,
      status: 'superseded',
      supersededByArtifactId: replacement.artifactId,
      revision: artifact.revision + 1,
      updatedAt: tx.time,
    })
    put(tx, replacement)
    linkOutput(tx, replacement)
    reconcileArtifactVerification(tx, replacement)
    tx.emit(
      'ARTIFACT_SUPERSEDED',
      'Artifact content superseded by a new immutable version.',
      command.agentId,
      artifact.taskId,
      {
        artifactId: artifact.artifactId,
        replacementArtifactId: replacement.artifactId,
      },
    )
    tx.emit(
      'ARTIFACT_VERSION_CREATED',
      'New artifact version created; previous provenance retained.',
      command.agentId,
      replacement.taskId,
      {
        artifactId: replacement.artifactId,
        previousArtifactId: artifact.artifactId,
      },
    )
  } else {
    const status =
      command.type === 'archiveArtifact' ? 'archived' : command.status
    ensure(
      status === 'archived' ||
        (['created', 'in_progress'].includes(artifact.status) &&
          ['in_progress', 'completed', 'failed'].includes(status)),
      'INVALID_ARTIFACT_TRANSITION',
      'Completed content must be replaced by a new version; verification requires QA.',
    )
    if (artifact.status === status) return
    put(tx, {
      ...artifact,
      status,
      revision: artifact.revision + 1,
      updatedAt: tx.time,
    })
    reconcileArtifactVerification(tx, artifact)
    tx.emit(
      status === 'archived' ? 'ARTIFACT_ARCHIVED' : 'ARTIFACT_UPDATED',
      status === 'archived'
        ? 'Artifact archived.'
        : 'Artifact lifecycle updated.',
      command.agentId,
      artifact.taskId,
      { artifactId: artifact.artifactId, status },
    )
  }
  tx.reconcileDependencies()
}

interface QAArtifactTransaction extends OrchestrationTransaction {
  canAccessArtifact(
    agentId: string,
    artifactId: string,
    permission: 'read' | 'modify' | 'archive',
  ): boolean
}
export function validateArtifactQATarget(
  tx: QAArtifactTransaction,
  artifactId: string,
  taskId: string,
  managerId: string,
): Artifact {
  const artifact = get(tx, artifactId)
  ensure(
    tx.canAccessArtifact(managerId, artifactId, 'read'),
    'ARTIFACT_ACCESS_DENIED',
    'Manager cannot inspect an inaccessible artifact.',
  )
  ensure(
    artifact.role === 'output' &&
      artifact.taskId === taskId &&
      artifact.supersededByArtifactId === null &&
      ['completed', 'failed'].includes(artifact.status),
    'INVALID_QA_ARTIFACT',
    'QA must target the current completed output version of this task.',
  )
  return artifact
}
export function applyArtifactQAResult(
  tx: OrchestrationTransaction,
  request: QARequest,
): void {
  if (
    request.artifactId === null ||
    !['passed', 'failed'].includes(request.status)
  )
    return
  const artifact = get(tx, request.artifactId)
  ensure(
    request.artifactBinding?.artifactId === artifact.artifactId &&
      request.artifactBinding.version === artifact.version &&
      request.artifactBinding.sha256 === artifact.content.sha256 &&
      request.result?.artifactBinding?.artifactId === artifact.artifactId &&
      request.result.artifactBinding.version === artifact.version &&
      request.result.artifactBinding.sha256 === artifact.content.sha256,
    'STALE_QA_ARTIFACT',
    'QA evidence must identify the exact immutable artifact content.',
  )
  ensure(
    artifact.supersededByArtifactId === null && artifact.status !== 'archived',
    'STALE_QA_ARTIFACT',
    'QA cannot change an archived or superseded version.',
  )
  const verified = request.status === 'passed'
  put(tx, {
    ...artifact,
    status: verified ? 'verified' : 'failed',
    verifiedByQA: verified ? request.qaId : null,
    revision: artifact.revision + 1,
    updatedAt: tx.time,
  })
  tx.emit(
    verified ? 'ARTIFACT_VERIFIED' : 'ARTIFACT_UPDATED',
    verified
      ? 'Artifact version verified by passing QA.'
      : 'Artifact version failed QA.',
    request.verifierAgentId,
    artifact.taskId,
    { artifactId: artifact.artifactId, qaId: request.qaId },
  )
}
/** Restored metadata/history is still subject to the same credential boundary. Bytes stay in storage. */
export function validateRestoredArtifacts(state: RuntimeState): void {
  const validate = (artifact: Artifact) => {
    memorySafeJson(artifact, 32768)
    memoryId(artifact.artifactId)
    memoryId(artifact.lineageId)
    validateContentReference(artifact.content)
    ensure(
      Number.isSafeInteger(artifact.version) &&
        artifact.version > 0 &&
        Number.isSafeInteger(artifact.revision) &&
        artifact.revision > 0,
      'INVALID_ARTIFACT',
      'Invalid restored artifact version.',
    )
    if (artifact.status === 'verified') {
      const qa =
        artifact.verifiedByQA && state.qaRequests?.[artifact.verifiedByQA]
      ensure(
        qa &&
          qa.status === 'passed' &&
          qa.artifactId === artifact.artifactId &&
          qa.result?.status === 'passed' &&
          qa.artifactBinding?.version === artifact.version &&
          qa.artifactBinding.sha256 === artifact.content.sha256 &&
          qa.result.artifactBinding?.artifactId === artifact.artifactId &&
          qa.result.artifactBinding.version === artifact.version &&
          qa.result.artifactBinding.sha256 === artifact.content.sha256,
        'INVALID_ARTIFACT',
        'Restored verification must retain its passing QA result and exact content identity.',
      )
    }
  }
  Object.values(state.artifacts ?? {}).forEach(validate)
  for (const event of state.events) {
    if (event.type.startsWith('ARTIFACT_')) memorySafeJson(event.payload, 32768)
    Object.values(event.changes.artifacts ?? {}).forEach(validate)
  }
}
