import {
  eligibleAgents,
  meetsCapabilities,
} from '../orchestration/capabilityMatcher'
import { evaluateQA, validateQARequest } from '../qa/qaPolicy'
import { latestTaskQAs, taskVerification } from '../qa/qaSelectors'
import {
  applyArtifactQAResult,
  validateArtifactQATarget,
} from './artifactRuntime'
import {
  QAFault,
  type QARequest,
  type QARuntimeCommand,
  type RepairRequest,
} from '../qa/qaTypes'
import { toolId, toolText } from '../tools/toolValidation'
import { memorySafeJson } from '../memory/memoryPolicy'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type { RuntimeAgent, RuntimeCommand, RuntimeTask } from './runtimeTypes'
import { hasLiveToolExecution } from './toolRuntime'

interface QATransaction extends OrchestrationTransaction {
  agentPatch(
    id: string,
    patch: Partial<RuntimeAgent>,
    recoverFromRepair?: boolean,
  ): void
  taskPatch(id: string, patch: Partial<RuntimeTask>): void
  reconcileDependencies(): void
  canAccessArtifact(
    agentId: string,
    artifactId: string,
    permission: 'read' | 'modify' | 'archive',
  ): boolean
}
const commands = new Set([
  'requestQA',
  'startQA',
  'completeQA',
  'cancelQA',
  'recheckQA',
  'requestRepair',
  'assignRepair',
  'startRepair',
])
const terminal = new Set(['completed', 'failed', 'cancelled'])
const ensure = (value: unknown, code: string, message: string): void => {
  if (!value) throw new QAFault(code, message)
}
export function isQARuntimeCommand(
  command: RuntimeCommand,
): command is QARuntimeCommand {
  return commands.has(command.type)
}
function qa(tx: QATransaction, id: string): QARequest {
  toolId(id)
  ensure(
    Object.hasOwn(tx.state.qaRequests, id),
    'QA_NOT_FOUND',
    'QA request does not exist.',
  )
  return tx.state.qaRequests[id]
}
function repair(tx: QATransaction, id: string): RepairRequest {
  toolId(id)
  ensure(
    Object.hasOwn(tx.state.repairRequests, id),
    'REPAIR_NOT_FOUND',
    'Repair request does not exist.',
  )
  return tx.state.repairRequests[id]
}
function putQA(tx: QATransaction, value: QARequest) {
  tx.state = {
    ...tx.state,
    qaRequests: { ...tx.state.qaRequests, [value.qaId]: value },
  }
}
function putRepair(tx: QATransaction, value: RepairRequest) {
  tx.state = {
    ...tx.state,
    repairRequests: { ...tx.state.repairRequests, [value.repairId]: value },
  }
}
function activeWorkflow(tx: QATransaction, taskId: string) {
  const plan = Object.values(tx.state.plans).find((item) =>
    item.taskIds.includes(taskId),
  )
  ensure(
    !plan || !['completed', 'failed', 'cancelled'].includes(plan.status),
    'QA_WORKFLOW_CLOSED',
    'QA and repair cannot reopen a terminal workflow.',
  )
}
export function validateRepairAssignment(
  tx: QATransaction,
  taskId: string,
  agentId: string,
) {
  const value = Object.values(tx.state.repairRequests).find(
    (item) => item.taskId === taskId,
  )
  if (!value) return
  activeWorkflow(tx, value.sourceTaskId)
  const request = qa(tx, value.sourceQaId)
  ensure(
    meetsCapabilities(
      tx.agent(agentId),
      { capabilities: value.capabilities, preferredAgentId: null },
      request.requestedBy,
    ),
    'INVALID_REPAIR_AGENT',
    'Repair assignment requires a capable worker under the responsible Manager.',
  )
}
function freshQAId(tx: QATransaction, explicit?: string) {
  const id = explicit === undefined ? tx.id('qa') : toolId(explicit)
  ensure(
    !['__proto__', 'prototype', 'constructor'].includes(id) &&
      !Object.hasOwn(tx.state.qaRequests, id),
    'DUPLICATE_QA',
    'QA ID must be unique and unreserved.',
  )
  return id
}
function sourcePresentation(
  tx: QATransaction,
  request: QARequest,
  status: RuntimeAgent['status'],
) {
  const task = tx.task(request.taskId)
  if (task.status !== 'completed' || task.assignedAgentId === null) return
  if (task.verification)
    status = task.verification.needsAttention
      ? 'blocked'
      : task.verification.status === 'verified'
        ? 'completed'
        : 'waiting'
  const agent = tx.agent(task.assignedAgentId)
  if (agent.currentTaskId !== task.id || agent.status === 'repair') return
  tx.agentPatch(agent.id, {
    status,
    destination: null,
    collaboratorIds: [],
    blockers: status === 'blocked' ? ['QA requires attention.'] : [],
  })
}
function setVerification(tx: QATransaction, request: QARequest) {
  tx.taskPatch(request.taskId, {
    verification: taskVerification(tx.state, request.taskId),
  })
}
function queueQA(tx: QATransaction, request: QARequest) {
  putQA(tx, request)
  setVerification(tx, request)
  sourcePresentation(tx, request, 'waiting')
  tx.reconcileDependencies()
  tx.emit(
    'QA_REQUESTED',
    request.previousQaId ? 'QA recheck requested.' : 'QA requested.',
    request.agentId,
    request.taskId,
    { qaId: request.qaId, previousQaId: request.previousQaId },
  )
}
function requestRepair(tx: QATransaction, request: QARequest) {
  activeWorkflow(tx, request.taskId)
  ensure(
    request.status === 'failed',
    'INVALID_QA_TRANSITION',
    'Only failed QA can request repair.',
  )
  if (
    Object.values(tx.state.repairRequests).some(
      (item) => item.sourceQaId === request.qaId,
    )
  )
    return
  if (request.attempt >= request.maxRepairAttempts) {
    tx.emit(
      'REPAIR_EXHAUSTED',
      'Repair limit reached; explicit intervention is required.',
      request.agentId,
      request.taskId,
      { qaId: request.qaId, attempts: request.attempt },
    )
    return
  }
  const taskId = tx.id('task')
  const repairId = tx.id('repair')
  const failed = request.result!.findings.filter((item) =>
    request.result!.failedChecks.includes(item.checkId),
  )
  tx.apply({
    type: 'createTask',
    task: {
      id: taskId,
      title: `Repair: ${tx.task(request.taskId).title}`,
      description: failed.map((item) => item.description).join('\n'),
      priority: request.priority,
      parentTaskId: request.taskId,
      metadata: { qaId: request.qaId, repairId, sourceTaskId: request.taskId },
    },
  })
  putRepair(tx, {
    repairId,
    sourceQaId: request.qaId,
    sourceTaskId: request.taskId,
    taskId,
    responsibleAgentId: null,
    findings: failed.map((item) => item.findingId),
    requiredChanges: failed.map((item) => item.description),
    capabilities: request.repairCapabilities,
    priority: request.priority,
    status: 'queued',
    attempt: request.attempt + 1,
    createdAt: tx.time,
    startedAt: null,
    completedAt: null,
  })
  tx.emit(
    'REPAIR_REQUESTED',
    'QA failure requires a canonical repair task.',
    request.agentId,
    taskId,
    { qaId: request.qaId, repairId, sourceTaskId: request.taskId },
  )
}
function cancelQA(tx: QATransaction, request: QARequest) {
  if (request.inspectionTaskId !== null) {
    const task = tx.task(request.inspectionTaskId)
    if (!terminal.has(task.status)) {
      // Disconnect also uses this path after local command admission has closed.
      tx.taskPatch(task.id, {
        status: 'cancelled',
        cancelledAt: tx.time,
        statusReason: 'QA cancelled.',
        waitingForDependencies: false,
      })
      if (
        task.assignedAgentId !== null &&
        tx.agent(task.assignedAgentId).currentTaskId === task.id
      )
        tx.agentPatch(task.assignedAgentId, {
          status: 'waiting',
          destination: null,
          blockers: [],
        })
      tx.emit(
        'TASK_CANCELLED',
        'QA inspection task cancelled.',
        task.assignedAgentId,
        task.id,
      )
    }
  }
  const value: QARequest = {
    ...request,
    status: 'cancelled',
    completedAt: tx.time,
    result: {
      qaId: request.qaId,
      status: 'cancelled',
      checks: [],
      passedChecks: [],
      failedChecks: [],
      findings: [],
      evidence: [],
      severity: 'info',
      verifier:
        request.verifierAgentId && request.inspectionTaskId
          ? {
              agentId: request.verifierAgentId,
              taskId: request.inspectionTaskId,
            }
          : null,
      startedAt: request.startedAt,
      completedAt: tx.time,
      ...(request.artifactBinding
        ? { artifactBinding: request.artifactBinding }
        : {}),
    },
  }
  putQA(tx, value)
  setVerification(tx, value)
  sourcePresentation(tx, value, 'blocked')
  tx.emit(
    'QA_CANCELLED',
    'QA cancelled; work remains unverified.',
    value.agentId,
    value.taskId,
    { qaId: value.qaId },
  )
}

export function applyQARuntimeCommand(
  tx: QATransaction,
  command: QARuntimeCommand,
) {
  switch (command.type) {
    case 'requestQA': {
      const input = validateQARequest(command.request)
      const task = tx.task(input.taskId)
      const artifact = input.artifactId
        ? validateArtifactQATarget(
            tx,
            input.artifactId,
            task.id,
            input.requestedBy,
          )
        : null
      ensure(
        !Object.values(tx.state.requests).some(
          (item) => item.coordinationTaskId === task.id,
        ),
        'COORDINATION_QA',
        'QA targets work outputs, not the Manager coordination control task.',
      )
      ensure(
        !Object.values(tx.state.repairRequests).some(
          (item) => item.taskId === task.id,
        ) &&
          !Object.values(tx.state.qaRequests).some(
            (item) => item.inspectionTaskId === task.id,
          ),
        'NESTED_QA',
        'Inspection and repair tasks are verified through the original QA recheck policy.',
      )
      const manager = tx.agent(input.requestedBy)
      ensure(
        manager.kind === 'manager',
        'INVALID_QA_REQUESTER',
        'The responsible Manager requests QA.',
      )
      const owner =
        task.assignedAgentId === null
          ? null
          : tx.agent(task.assignedAgentId).managerId
      const plan = Object.values(tx.state.plans).find((item) =>
        item.taskIds.includes(task.id),
      )
      ensure(
        (owner === null || owner === manager.id) &&
          (!plan || plan.managerId === manager.id),
        'QA_OWNERSHIP',
        'QA must belong to the responsible Manager.',
      )
      ensure(
        !Object.values(tx.state.qaRequests).some(
          (item) =>
            item.taskId === task.id &&
            (artifact
              ? item.artifactId !== null &&
                tx.state.artifacts[item.artifactId]?.lineageId ===
                  artifact.lineageId
              : item.artifactId === null),
        ),
        'QA_ALREADY_CONFIGURED',
        'Use recheck for an existing QA policy.',
      )
      ensure(
        !['failed', 'cancelled'].includes(task.status) &&
          (!plan ||
            !['completed', 'failed', 'cancelled'].includes(plan.status)),
        'INVALID_QA_TRANSITION',
        'QA cannot be retroactively attached to terminal workflows.',
      )
      ensure(
        !Object.values(tx.state.tasks).some(
          (item) =>
            item.dependencyIds.includes(task.id) && item.startedAt !== null,
        ),
        'QA_TOO_LATE',
        'Configure QA before dependent work starts.',
      )
      const qaId = freshQAId(tx, input.qaId)
      queueQA(tx, {
        ...input,
        qaId,
        agentId: task.assignedAgentId,
        artifactId: input.artifactId ?? null,
        ...(artifact
          ? {
              artifactBinding: {
                artifactId: artifact.artifactId,
                version: artifact.version,
                sha256: artifact.content.sha256,
              },
            }
          : {}),
        priority: input.priority!,
        maxRepairAttempts: input.maxRepairAttempts!,
        status: 'queued',
        rootQaId: qaId,
        previousQaId: null,
        repairId: null,
        attempt: 0,
        verifierAgentId: null,
        inspectionTaskId: null,
        executionIds: {},
        result: null,
        createdAt: tx.time,
        startedAt: null,
        completedAt: null,
      })
      return
    }
    case 'startQA': {
      const request = qa(tx, command.qaId)
      activeWorkflow(tx, request.taskId)
      if (request.artifactBinding) {
        const artifact = validateArtifactQATarget(
          tx,
          request.artifactBinding.artifactId,
          request.taskId,
          request.requestedBy,
        )
        ensure(
          artifact.version === request.artifactBinding.version &&
            artifact.content.sha256 === request.artifactBinding.sha256,
          'ARTIFACT_CHANGED',
          'QA must inspect the captured artifact version and content identity.',
        )
      }
      ensure(
        request.status === 'queued' &&
          tx.task(request.taskId).status === 'completed',
        'INVALID_QA_TRANSITION',
        'QA starts once queued work has completed.',
      )
      const verifier = tx.agent(command.verifierAgentId)
      ensure(
        eligibleAgents(
          tx.state,
          { capabilities: ['qa'], preferredAgentId: verifier.id },
          request.requestedBy,
        ).length === 1,
        'QA_VERIFIER_UNAVAILABLE',
        'QA requires an available QA-capable worker under the responsible Manager.',
      )
      const taskId = tx.id('task')
      tx.apply({
        type: 'createTask',
        task: {
          id: taskId,
          title: 'QA inspection',
          description: request.scope,
          priority: request.priority,
          parentTaskId: request.taskId,
          metadata: { qaId: request.qaId, sourceTaskId: request.taskId },
        },
      })
      tx.apply({ type: 'assignTask', taskId, agentId: verifier.id })
      tx.apply({ type: 'startTask', taskId })
      const value: QARequest = {
        ...request,
        agentId: tx.task(request.taskId).assignedAgentId,
        status: 'running',
        verifierAgentId: verifier.id,
        inspectionTaskId: taskId,
        executionIds: Object.fromEntries(
          request.checks.map((check) => [check.checkId, tx.id('tool')]),
        ),
        startedAt: tx.time,
      }
      putQA(tx, value)
      setVerification(tx, value)
      sourcePresentation(tx, value, 'waiting')
      tx.emit(
        'QA_STARTED',
        'QA inspection started.',
        verifier.id,
        request.taskId,
        { qaId: request.qaId, inspectionTaskId: taskId },
      )
      return
    }
    case 'completeQA': {
      const request = qa(tx, command.qaId)
      ensure(
        request.status === 'running',
        'INVALID_QA_TRANSITION',
        'Only running QA can produce a result.',
      )
      ensure(
        !hasLiveToolExecution(tx.state, { taskId: request.inspectionTaskId! }),
        'QA_TOOL_ACTIVE',
        'Wait for verification tools to finish or cancel.',
      )
      const bound = request.artifactBinding
      const artifact = bound ? tx.state.artifacts[bound.artifactId] : undefined
      const artifactAvailable =
        !bound ||
        !!(
          artifact &&
          artifact.version === bound.version &&
          artifact.content.sha256 === bound.sha256 &&
          !artifact.supersededByArtifactId &&
          ['completed', 'failed'].includes(artifact.status)
        )
      const result = evaluateQA(
        request,
        tx.state.toolExecutions,
        tx.time,
        artifactAvailable,
      )
      const inspection = tx.task(request.inspectionTaskId!)
      if (inspection.status === 'in_progress')
        tx.apply({ type: 'completeTask', taskId: inspection.id })
      else if (!terminal.has(inspection.status))
        tx.apply({
          type: 'cancelTask',
          taskId: inspection.id,
          reason: 'Verification tool unavailable; QA blocked.',
        })
      const value: QARequest = {
        ...request,
        result,
        status: result.status,
        completedAt: tx.time,
      }
      putQA(tx, value)
      if (value.artifactBinding) applyArtifactQAResult(tx, value)
      setVerification(tx, value)
      const verification = tx.task(value.taskId).verification!
      sourcePresentation(
        tx,
        value,
        verification.status === 'verified'
          ? 'completed'
          : verification.needsAttention
            ? 'blocked'
            : 'waiting',
      )
      tx.emit(
        value.status === 'passed'
          ? 'QA_PASSED'
          : value.status === 'failed'
            ? 'QA_FAILED'
            : 'QA_BLOCKED',
        `QA ${value.status}.`,
        value.agentId,
        value.taskId,
        { qaId: value.qaId },
      )
      if (value.status === 'failed') requestRepair(tx, value)
      tx.reconcileDependencies()
      return
    }
    case 'cancelQA': {
      const request = qa(tx, command.qaId)
      ensure(
        ['queued', 'running'].includes(request.status),
        'INVALID_QA_TRANSITION',
        'Only pending QA can be cancelled.',
      )
      memorySafeJson(command.reason, 1000)
      toolText(command.reason, 'Cancellation reason', 1000)
      cancelQA(tx, request)
      return
    }
    case 'requestRepair':
      requestRepair(tx, qa(tx, command.qaId))
      return
    case 'assignRepair': {
      const value = repair(tx, command.repairId)
      activeWorkflow(tx, value.sourceTaskId)
      ensure(
        value.status === 'queued',
        'INVALID_REPAIR_TRANSITION',
        'Only queued repairs can be assigned.',
      )
      const request = qa(tx, value.sourceQaId)
      const requirements = {
        capabilities: value.capabilities,
        preferredAgentId: command.agentId ?? null,
      }
      const candidates = eligibleAgents(
        tx.state,
        requirements,
        request.requestedBy,
      )
      // A worker blocked by this exact QA failure can fix its own completed work.
      const source = tx.task(value.sourceTaskId).assignedAgentId
      const blockedOwner = source === null ? undefined : tx.agent(source)
      const eligibleOwner =
        blockedOwner &&
        blockedOwner.currentTaskId === value.sourceTaskId &&
        blockedOwner.status === 'blocked' &&
        blockedOwner.blockers.length === 1 &&
        blockedOwner.blockers[0] === 'QA requires attention.' &&
        meetsCapabilities(blockedOwner, requirements, request.requestedBy)
      const selected = eligibleOwner ? blockedOwner : candidates[0]
      ensure(
        !!selected,
        'NO_REPAIR_AGENT',
        'No available worker matches the repair capabilities.',
      )
      tx.apply({
        type: 'assignTask',
        taskId: value.taskId,
        agentId: selected!.id,
      })
      putRepair(tx, {
        ...value,
        responsibleAgentId: selected!.id,
        status: 'assigned',
      })
      tx.emit(
        'REPAIR_ASSIGNED',
        'Repair assigned by capability.',
        selected!.id,
        value.taskId,
        { repairId: value.repairId },
      )
      return
    }
    case 'startRepair': {
      const value = repair(tx, command.repairId)
      activeWorkflow(tx, value.sourceTaskId)
      ensure(
        ['assigned', 'waiting'].includes(value.status),
        'INVALID_REPAIR_TRANSITION',
        'Assign or resume a repair before starting it.',
      )
      tx.apply({ type: 'startTask', taskId: value.taskId })
      return
    }
    case 'recheckQA': {
      const previous = qa(tx, command.qaId)
      activeWorkflow(tx, previous.taskId)
      ensure(
        ['failed', 'blocked', 'cancelled'].includes(previous.status) ||
          (previous.status === 'passed' &&
            !!previous.artifactBinding &&
            !!command.replacementArtifactId),
        'INVALID_QA_TRANSITION',
        'A recheck follows failed, blocked or cancelled QA.',
      )
      ensure(
        latestTaskQAs(tx.state, previous.taskId).some(
          (item) => item.qaId === previous.qaId,
        ),
        'STALE_QA',
        'Only the latest QA attempt can be rechecked.',
      )
      const completedRepair = Object.values(tx.state.repairRequests).find(
        (item) => item.sourceQaId === previous.qaId,
      )
      ensure(
        previous.status !== 'failed' || completedRepair?.status === 'completed',
        'REPAIR_NOT_COMPLETED',
        'Complete the linked repair before rechecking failed QA.',
      )
      const artifact = previous.artifactBinding
        ? validateArtifactQATarget(
            tx,
            command.replacementArtifactId ??
              previous.artifactBinding.artifactId,
            previous.taskId,
            previous.requestedBy,
          )
        : null
      ensure(
        !command.replacementArtifactId || !!previous.artifactBinding,
        'ARTIFACT_RECHECK_CONFLICT',
        'A task-only QA policy cannot become an artifact policy during recheck.',
      )
      if (previous.artifactBinding) {
        const original = tx.state.artifacts[previous.artifactBinding.artifactId]
        ensure(
          !!artifact && artifact.lineageId === original.lineageId,
          'ARTIFACT_RECHECK_CONFLICT',
          'Recheck must retain the artifact lineage.',
        )
        if (previous.status === 'failed')
          ensure(
            !!command.replacementArtifactId &&
              artifact!.version > original.version &&
              artifact!.source.taskId === completedRepair!.taskId,
            'REPAIR_ARTIFACT_REQUIRED',
            'Failed artifact QA requires a newer version produced by its completed repair task.',
          )
        else if (command.replacementArtifactId)
          ensure(
            artifact!.version > original.version &&
              (artifact!.source.taskId === previous.taskId ||
                Object.values(tx.state.repairRequests).some(
                  (repair) =>
                    repair.taskId === artifact!.source.taskId &&
                    repair.sourceTaskId === previous.taskId &&
                    repair.status === 'completed',
                )),
            'ARTIFACT_RECHECK_CONFLICT',
            'Changed output must be a newer version produced by its owning task or completed repair.',
          )
      }
      queueQA(tx, {
        ...previous,
        qaId: freshQAId(tx, command.newQaId),
        previousQaId: previous.qaId,
        repairId: completedRepair?.repairId ?? previous.repairId,
        ...(artifact
          ? {
              artifactId: artifact.artifactId,
              artifactBinding: {
                artifactId: artifact.artifactId,
                version: artifact.version,
                sha256: artifact.content.sha256,
              },
            }
          : {}),
        attempt: completedRepair?.attempt ?? previous.attempt,
        status: 'queued',
        verifierAgentId: null,
        inspectionTaskId: null,
        executionIds: {},
        result: null,
        createdAt: tx.time,
        startedAt: null,
        completedAt: null,
      })
      return
    }
  }
}

/** Reconciles canonical tasks once per accepted lifecycle command, never per frame. */
export function reconcileQA(tx: QATransaction) {
  for (const request of Object.values(tx.state.qaRequests)) {
    if (
      ['queued', 'running'].includes(request.status) &&
      (tx.state.connection === 'disconnected' ||
        ['failed', 'cancelled'].includes(tx.task(request.taskId).status) ||
        (request.inspectionTaskId !== null &&
          ['failed', 'cancelled'].includes(
            tx.task(request.inspectionTaskId).status,
          )))
    )
      cancelQA(tx, request)
  }
  for (const value of Object.values(tx.state.repairRequests)) {
    const task = tx.task(value.taskId)
    const status = task.status === 'blocked' ? 'waiting' : task.status
    if (status === value.status) continue
    putRepair(tx, {
      ...value,
      status,
      responsibleAgentId: task.assignedAgentId,
      startedAt: task.startedAt,
      completedAt: terminal.has(status) ? tx.time : null,
    })
    if (
      task.assignedAgentId !== null &&
      tx.agent(task.assignedAgentId).currentTaskId === task.id
    ) {
      if (status === 'in_progress')
        tx.agentPatch(task.assignedAgentId, {
          status: 'repair',
          destination: null,
          blockers: [],
        })
      else
        tx.agentPatch(
          task.assignedAgentId,
          {
            status:
              status === 'completed'
                ? 'completed'
                : status === 'failed'
                  ? 'blocked'
                  : 'waiting',
            destination: null,
            blockers: task.statusReason ? [task.statusReason] : [],
          },
          true,
        )
    }
    const events = {
      queued: 'REPAIR_REQUESTED',
      assigned: 'REPAIR_ASSIGNED',
      in_progress: 'REPAIR_STARTED',
      waiting: 'REPAIR_WAITING',
      completed: 'REPAIR_COMPLETED',
      failed: 'REPAIR_FAILED',
      cancelled: 'REPAIR_CANCELLED',
    } as const
    tx.emit(
      events[status],
      `Repair ${status.replace('_', ' ')}.`,
      task.assignedAgentId,
      task.id,
      { repairId: value.repairId, qaId: value.sourceQaId },
    )
  }
}
