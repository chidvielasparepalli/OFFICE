import { useMemo } from 'react'
import type { Artifact } from '../artifacts/artifactTypes'
import type { RuntimeState } from '../runtime/runtimeTypes'

/** Metadata only: the content store is not a browser download or file viewer. */
export function ArtifactDetails({
  artifact,
  state,
}: {
  artifact: Artifact
  state: RuntimeState
}) {
  const qa = artifact.verifiedByQA
    ? state.qaRequests[artifact.verifiedByQA]
    : Object.values(state.qaRequests)
        .filter((item) => item.artifactId === artifact.artifactId)
        .at(-1)
  return (
    <details data-testid={`artifact-detail-${artifact.artifactId}`}>
      <summary>
        {artifact.name} · {artifact.type} · v{artifact.version} ·{' '}
        {artifact.status}
      </summary>
      <p>{artifact.description}</p>
      <dl>
        <dt>Artifact / lineage</dt>
        <dd>
          {artifact.artifactId} / {artifact.lineageId}
        </dd>
        <dt>Use</dt>
        <dd>
          {artifact.role}
          {artifact.outputRole ? ` / ${artifact.outputRole}` : ''}
        </dd>
        <dt>Owning task</dt>
        <dd>{artifact.taskId ?? 'User-provided input'}</dd>
        <dt>Producing agent</dt>
        <dd>{artifact.agentId ?? 'No agent producer'}</dd>
        <dt>Provenance</dt>
        <dd>
          {artifact.source.kind} · task {artifact.source.taskId ?? 'none'} ·
          execution {artifact.source.executionId ?? 'none'} · recorded by{' '}
          {artifact.source.recordedByAgentId}
        </dd>
        <dt>Version history</dt>
        <dd>
          Supersedes {artifact.supersedesArtifactId ?? 'none'} · superseded by{' '}
          {artifact.supersededByArtifactId ?? 'none'}
        </dd>
        <dt>QA</dt>
        <dd>
          {qa
            ? `${qa.qaId}: ${qa.status}`
            : 'Not requested. Completion is not verification.'}
        </dd>
        <dt>Verified by</dt>
        <dd>{artifact.verifiedByQA ?? 'Not verified'}</dd>
        <dt>Created / updated</dt>
        <dd>
          {artifact.createdAt} / {artifact.updatedAt}
        </dd>
        <dt>Integrity identity</dt>
        <dd style={{ overflowWrap: 'anywhere' }}>
          SHA-256 {artifact.content.sha256} · {artifact.content.byteLength}{' '}
          bytes · {artifact.content.mediaType}
        </dd>
      </dl>
      <p>
        Hash identifies bytes; it does not prove correctness. Content stays in
        the controlled storage boundary.
      </p>
    </details>
  )
}

export function TaskArtifactContext({
  state,
  taskId,
  canRead,
}: {
  state: RuntimeState
  taskId: string
  canRead?: (artifactId: string) => boolean
}) {
  const task = state.tasks[taskId]
  if (!task) return null
  const ids = [
    ...(task.inputArtifactIds ?? []),
    ...(task.outputArtifactIds ?? []),
  ]
  const visible = ids.filter((id) => canRead?.(id)).slice(-20)
  return (
    <section aria-label="Task artifacts" data-testid="artifact-task-context">
      <h3>Artifacts and expected outputs</h3>
      {task.expectedOutputs?.length ? (
        <ul>
          {task.expectedOutputs.map((expected) => (
            <li key={expected.role}>
              {expected.count} verified {expected.type} · role {expected.role}
            </li>
          ))}
        </ul>
      ) : (
        <p>No structured output expectation configured.</p>
      )}
      {visible.length ? (
        visible.map((id) => (
          <ArtifactDetails
            key={id}
            artifact={state.artifacts[id]}
            state={state}
          />
        ))
      ) : (
        <p>
          {ids.length
            ? 'No artifacts accessible to the selected agent. Select an authorized agent to inspect metadata.'
            : 'No input or output artifacts linked.'}
        </p>
      )}
      {ids.length > visible.length && (
        <p>
          Some entries are restricted or outside the 20-record context limit.
        </p>
      )}
    </section>
  )
}

export function AgentArtifactContext({
  state,
  canRead,
}: {
  state: RuntimeState
  canRead?: (artifactId: string) => boolean
}) {
  const records = useMemo(
    () =>
      Object.values(state.artifacts).filter(
        (item) => item.agentId === state.selectedAgentId,
      ),
    [state.artifacts, state.selectedAgentId],
  )
  if (state.connection !== 'local' || !state.selectedAgentId) return null
  const agent = state.agents[state.selectedAgentId]
  if (!agent) return null
  const visible = records
    .filter((item) => canRead?.(item.artifactId))
    .slice(-20)
  return (
    <section
      className="runtime-task-context"
      aria-label="Selected agent artifacts"
      data-testid="artifact-agent-context"
    >
      <h2>{agent.name} — artifacts</h2>
      {visible.length ? (
        visible.map((item) => (
          <ArtifactDetails
            key={item.artifactId}
            artifact={item}
            state={state}
          />
        ))
      ) : (
        <p>No accessible artifacts created by this agent.</p>
      )}
      {records.length > visible.length && (
        <p>
          Some entries are restricted or outside the 20-record context limit.
        </p>
      )}
    </section>
  )
}
