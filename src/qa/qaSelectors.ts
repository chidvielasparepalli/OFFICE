import type { RuntimeState, RuntimeTask } from '../runtime/runtimeTypes'
import { taskOutputAssessment } from '../artifacts/artifactSelectors'
import type { QARequest, TaskVerification } from './qaTypes'

/** Completion without selected checks is not a verification claim. */
export function isTaskReadyForDependents(
  task: RuntimeTask | undefined,
  state?: RuntimeState,
) {
  const verification =
    task && state
      ? (taskVerification(state, task.id) ?? task.verification)
      : task?.verification
  return (
    task?.status === 'completed' &&
    (!verification || verification.status === 'verified') &&
    (!state || taskOutputAssessment(state, task).satisfied)
  )
}

/** Each independently selected policy keeps its own immutable recheck chain. */
export function latestTaskQAs(state: RuntimeState, taskId: string) {
  const requests = Object.values(state.qaRequests).filter(
    (qa) => qa.taskId === taskId,
  )
  const replaced = new Set(requests.map((qa) => qa.previousQaId))
  return requests.filter((qa) => !replaced.has(qa.qaId))
}

/** Immutable passing evidence cannot transfer its verdict onto newer content. */
export function taskVerification(
  state: RuntimeState,
  taskId: string,
): TaskVerification | undefined {
  const status = (qa: QARequest): QARequest['status'] => {
    if (qa.status !== 'passed' || !qa.artifactBinding) return qa.status
    const artifact = state.artifacts[qa.artifactBinding.artifactId]
    if (artifact?.supersededByArtifactId) return 'queued'
    return artifact?.status === 'verified' &&
      artifact.verifiedByQA === qa.qaId &&
      artifact.version === qa.artifactBinding.version &&
      artifact.content.sha256 === qa.artifactBinding.sha256
      ? 'passed'
      : 'blocked'
  }
  const priority = {
    blocked: 0,
    failed: 1,
    cancelled: 2,
    running: 3,
    queued: 4,
    passed: 5,
  }
  const relevant = latestTaskQAs(state, taskId)
    .map((qa) => ({ qa, status: status(qa) }))
    .sort((a, b) => priority[a.status] - priority[b.status])
  const value = relevant[0]
  if (!value) return undefined
  return {
    qaId: value.qa.qaId,
    status:
      value.status === 'queued'
        ? 'pending'
        : value.status === 'passed'
          ? 'verified'
          : value.status,
    repairAttempts: value.qa.attempt,
    maxRepairAttempts: value.qa.maxRepairAttempts,
    needsAttention: ['failed', 'blocked', 'cancelled'].includes(value.status),
  }
}

export function repairForTask(state: RuntimeState, taskId: string) {
  return Object.values(state.repairRequests).find(
    (repair) => repair.taskId === taskId,
  )
}
