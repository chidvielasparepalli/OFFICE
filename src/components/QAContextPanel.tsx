import type { RuntimeState } from '../runtime/runtimeTypes'

export function TaskQAContext({
  state,
  taskId,
}: {
  state: RuntimeState
  taskId: string
}) {
  const selectedRepair = Object.values(state.repairRequests).find(
    (item) => item.taskId === taskId,
  )
  const sourceTaskId = selectedRepair?.sourceTaskId ?? taskId
  const task = state.tasks[sourceTaskId]
  const verification = task?.verification
  const qa = verification ? state.qaRequests[verification.qaId] : null
  if (!qa || !verification)
    return (
      <p data-testid="qa-empty">
        QA not available. Task completion alone is not verification.
      </p>
    )
  const attempts = Object.values(state.qaRequests).filter(
    (item) => item.rootQaId === qa.rootQaId,
  )
  const repairs = Object.values(state.repairRequests).filter(
    (item) => item.sourceTaskId === sourceTaskId,
  )
  const repair = repairs.at(-1)
  return (
    <section
      aria-label="Task quality verification"
      data-testid="qa-task-context"
    >
      <h3>Quality verification</h3>
      {selectedRepair && <p>Repair of original task: {sourceTaskId}</p>}
      <dl>
        <dt>Verification</dt>
        <dd data-testid="qa-verification">{verification.status}</dd>
        <dt>Latest QA</dt>
        <dd>
          {qa.qaId}: {qa.status}
        </dd>
        <dt>Severity</dt>
        <dd>
          {qa.result?.severity ?? 'Not available until inspection finishes.'}
        </dd>
        <dt>Failed checks</dt>
        <dd>
          {qa.result
            ? qa.result.failedChecks.join(', ') || 'None'
            : 'Not available.'}
        </dd>
        <dt>Repair</dt>
        <dd>
          {repair
            ? `${repair.repairId}: ${repair.status}`
            : 'No repair requested.'}
        </dd>
        <dt>Repair attempts</dt>
        <dd>
          {verification.repairAttempts} / {verification.maxRepairAttempts}
        </dd>
        <dt>Attention</dt>
        <dd>
          {verification.needsAttention
            ? 'Needs attention'
            : 'No intervention flagged'}
        </dd>
      </dl>
      {qa.result?.findings.length ? (
        <ul>
          {qa.result.findings.map((finding) => (
            <li key={finding.findingId}>
              {finding.severity}: {finding.title} — {finding.description}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>Evidence and retained QA history ({attempts.length})</summary>
        {attempts.map((attempt) => (
          <article key={attempt.qaId}>
            <h4>
              {attempt.qaId}: {attempt.status}
            </h4>
            <p>
              Previous attempt: {attempt.previousQaId ?? 'Initial inspection'} ·
              Repair: {attempt.repairId ?? 'None'}
            </p>
            {attempt.result?.evidence.length ? (
              <ul>
                {attempt.result.evidence.map((item, index) => (
                  <li key={`${item.executionId}-${index}`}>
                    {item.toolId} · Execution {item.executionId} · Path{' '}
                    {item.path.join('.') || '(root)'} ·{' '}
                    {item.errorCode ??
                      (item.matched
                        ? 'Assertion matched'
                        : 'Assertion did not match')}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No execution evidence available.</p>
            )}
          </article>
        ))}
      </details>
    </section>
  )
}

export function AgentQAContext({
  state,
  onSelectTask,
}: {
  state: RuntimeState
  onSelectTask: (taskId: string) => void
}) {
  if (state.connection !== 'local' || !state.selectedAgentId) return null
  const agent = state.agents[state.selectedAgentId]
  if (!agent) return null
  const related = Object.values(state.qaRequests).filter(
    (qa) =>
      qa.agentId === agent.id ||
      state.tasks[qa.taskId]?.assignedAgentId === agent.id ||
      qa.verifierAgentId === agent.id ||
      qa.requestedBy === agent.id,
  )
  const repairs = Object.values(state.repairRequests).filter(
    (repair) => repair.responsibleAgentId === agent.id,
  )
  const qa = related.at(-1)
  const repair = repairs.at(-1)
  return (
    <section
      className="runtime-task-context"
      aria-label="Selected agent QA context"
      data-testid="qa-agent-context"
    >
      <h2>{agent.name} — QA / repair</h2>
      <p>Current state: {agent.status}</p>
      {qa ? (
        <p>
          QA-related task:{' '}
          <button
            type="button"
            className="reset-view"
            onClick={() => onSelectTask(qa.taskId)}
          >
            {state.tasks[qa.taskId]?.title ?? qa.taskId}
          </button>{' '}
          · {qa.status}
        </p>
      ) : (
        <p>QA not available for this agent.</p>
      )}
      {repair ? (
        <p>
          Repair assignment:{' '}
          <button
            type="button"
            className="reset-view"
            onClick={() => onSelectTask(repair.taskId)}
          >
            {repair.taskId}
          </button>{' '}
          · {repair.status}
        </p>
      ) : (
        <p>No repair assignment.</p>
      )}
    </section>
  )
}
