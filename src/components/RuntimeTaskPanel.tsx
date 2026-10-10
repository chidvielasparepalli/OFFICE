import type { RuntimeState } from '../runtime/runtimeTypes'

export function RuntimeTaskPanel({
  state,
  onClose,
}: {
  state: RuntimeState
  onClose: () => void
}) {
  if (state.connection !== 'local' || !state.selectedTaskId) return null
  const task = state.tasks[state.selectedTaskId]
  if (!task) return null
  const activity = state.activities
    .filter((item) => item.taskId === task.id)
    .slice(-8)
    .reverse()
  return (
    <section
      className="runtime-task-context"
      aria-label="Selected task"
      data-testid="runtime-task-context"
    >
      <h2>{task.title}</h2>
      <p>{task.description || 'No description supplied.'}</p>
      <dl>
        <dt>Task ID</dt>
        <dd>{task.id}</dd>
        <dt>Status</dt>
        <dd>{task.status}</dd>
        <dt>Assigned agent</dt>
        <dd>
          {task.assignedAgentId
            ? (state.agents[task.assignedAgentId]?.name ?? task.assignedAgentId)
            : 'Unassigned'}
        </dd>
        <dt>Progress</dt>
        <dd>{task.progressPercent}%</dd>
        <dt>Dependencies</dt>
        <dd>
          {task.dependencyIds.length
            ? task.dependencyIds
                .map((id) => {
                  const dependency = state.tasks[id]
                  return dependency
                    ? `${dependency.title} (${id}): ${dependency.status}`
                    : id
                })
                .join(', ')
            : 'None'}
        </dd>
        {task.statusReason && (
          <>
            <dt>Reason</dt>
            <dd>{task.statusReason}</dd>
          </>
        )}
      </dl>
      <h3>Task activity</h3>
      {activity.length ? (
        <ul>
          {activity.map((item) => (
            <li key={item.id}>
              <time dateTime={item.occurredAt}>{item.occurredAt}</time>{' '}
              {item.summary}
            </li>
          ))}
        </ul>
      ) : (
        <p>No activity recorded.</p>
      )}
      <button type="button" className="reset-view" onClick={onClose}>
        Close task context
      </button>
    </section>
  )
}
