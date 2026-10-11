import type { RuntimeState, RuntimeTask } from '../runtime/runtimeTypes'
import type { Artifact } from './artifactTypes'

export function artifactsForTask(
  state: RuntimeState,
  taskId: string,
): readonly Artifact[] {
  const task = state.tasks[taskId]
  const ids = new Set([
    ...(task?.inputArtifactIds ?? []),
    ...(task?.outputArtifactIds ?? []),
  ])
  return Object.values(state.artifacts).filter(
    (artifact) => artifact.taskId === taskId || ids.has(artifact.artifactId),
  )
}
export function taskOutputAssessment(state: RuntimeState, task: RuntimeTask) {
  const artifacts = (task.outputArtifactIds ?? [])
    .map((id) => state.artifacts[id])
    .filter(
      (artifact): artifact is Artifact =>
        !!artifact &&
        artifact.role === 'output' &&
        artifact.supersededByArtifactId === null &&
        !['archived', 'superseded'].includes(artifact.status),
    )
  const missing: string[] = []
  const unverified: string[] = []
  for (const expected of task.expectedOutputs ?? []) {
    const outputs = artifacts.filter(
      (artifact) =>
        artifact.type === expected.type &&
        artifact.outputRole === expected.role,
    )
    if (outputs.length < expected.count) missing.push(expected.role)
    else if (
      outputs.filter(
        (artifact) =>
          artifact.status === 'verified' && artifact.verifiedByQA !== null,
      ).length < expected.count
    )
      unverified.push(expected.role)
  }
  return {
    missing,
    unverified,
    satisfied: missing.length === 0 && unverified.length === 0,
    artifacts,
  }
}
