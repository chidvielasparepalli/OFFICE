import type { RuntimeState, RuntimeTask } from '../runtime/runtimeTypes'

/** Completion without selected checks is not a verification claim. */
export function isTaskReadyForDependents(task: RuntimeTask | undefined) {
  return (
    task?.status === 'completed' &&
    (!task.verification || task.verification.status === 'verified')
  )
}

export function repairForTask(state: RuntimeState, taskId: string) {
  return Object.values(state.repairRequests).find(
    (repair) => repair.taskId === taskId,
  )
}
