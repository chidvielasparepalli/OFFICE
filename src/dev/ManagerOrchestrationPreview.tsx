import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import { ManagerOrchestrator } from '../orchestration/ManagerOrchestrator'
import { DeterministicPlanner } from '../orchestration/planner'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import {
  MANAGER_PREVIEW_IDS,
  MANAGER_PREVIEW_TEMPLATE,
  managerDevelopmentPlan,
  managerRegistrations,
} from './managerFixtures'
import './ManagerOrchestrationPreview.css'

function createPreview() {
  const runtime = createOfficeRuntime()
  return {
    runtime,
    manager: new ManagerOrchestrator({
      runtime,
      managerId: MANAGER_PREVIEW_IDS.manager,
      planner: new DeterministicPlanner(managerDevelopmentPlan),
    }),
  }
}

export default function ManagerOrchestrationPreview() {
  const [preview, setPreview] = useState(createPreview)
  const { runtime, manager } = preview
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const seeded = useRef(false)
  const sequence = useRef(0)
  const generation = useRef(0)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [title, setTitle] = useState('Development request')
  const [description, setDescription] = useState(
    'Validate explicit Manager delegation through the two-step development template.',
  )
  const [reason, setReason] = useState(
    'Manually reported development condition.',
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const connected = state.connection === 'local'
  const context = manager.getContext(requestId ?? undefined)
  const monitorError = manager.getMetrics().monitorError
  const request = requestId ? state.requests[requestId] : null
  const plan = request?.planId ? state.plans[request.planId] : null
  const tasks = plan ? plan.taskIds.map((id) => state.tasks[id]) : []
  const task = tasks.find((item) => item.id === state.selectedTaskId)

  useEffect(() => {
    manager.start()
    return () => manager.dispose()
  }, [manager])

  function report(result: RuntimeResult, success: string) {
    setFeedback(
      result.ok ? success : `${result.error.code}: ${result.error.message}`,
    )
    return result.ok
  }

  function issue(command: RuntimeCommand) {
    return report(runtime.dispatch(command), `Applied ${command.type}.`)
  }

  function connect() {
    if (!issue({ type: 'connect' }) || seeded.current) return
    for (const command of managerRegistrations()) if (!issue(command)) return
    seeded.current = true
    setFeedback(
      'Connected three development registrations. No request has been submitted automatically.',
    )
  }

  function reset() {
    generation.current++
    setPreview(createPreview())
    seeded.current = false
    sequence.current = 0
    setRequestId(null)
    setFeedback('Reset to an empty, disconnected Manager development runtime.')
  }

  function receiveRequest() {
    const id = `phase6-request-${++sequence.current}`
    if (
      report(
        manager.receiveRequest({
          requestId: id,
          title,
          description,
          requestedBy: 'Development preview operator',
          priority: 'normal',
          constraints: [
            'Explicit local development commands only; no external task execution.',
          ],
        }),
        'Request received by the Manager. Planning remains an explicit action.',
      )
    )
      setRequestId(id)
  }

  async function planRequest() {
    if (!request) return
    const current = generation.current
    const result = await manager.planRequest(request.requestId)
    if (current !== generation.current) return
    if (
      report(
        result,
        'The fixed development template was validated and committed. Dispatch remains explicit.',
      ) &&
      result.ok
    ) {
      const accepted = result.state.requests[request.requestId]
      const first = accepted?.planId
        ? result.state.plans[accepted.planId]?.taskIds[0]
        : null
      if (first) runtime.dispatch({ type: 'selectTask', taskId: first })
    }
  }

  function dispatchReady() {
    if (!request) return
    const result = manager.dispatchReady(request.requestId)
    setFeedback(
      [
        `Dispatched ${result.dispatchedTaskIds.length} eligible task(s).`,
        ...result.issues.map((issue) => `${issue.code}: ${issue.message}`),
      ].join(' '),
    )
  }

  function selectTask(id: string) {
    if (!issue({ type: 'selectTask', taskId: id || null })) return
    const assignee = state.tasks[id]?.assignedAgentId
    if (assignee) issue({ type: 'selectAgent', agentId: assignee })
  }

  return (
    <>
      <p className="asset-preview-notice" data-testid="manager-preview-notice">
        Manager orchestration development preview. Requests and task outcomes
        are explicit local inputs. The named template does not interpret prose
        or execute external work. No progress, completion or artifacts are
        fabricated.
      </p>
      <section
        className="manager-preview-controls"
        aria-labelledby="manager-controls-heading"
      >
        <h2 id="manager-controls-heading">Manager development controls</h2>
        <div className="manager-preview-actions">
          <button
            className="reset-view"
            type="button"
            data-testid="manager-connect"
            disabled={connected}
            onClick={connect}
          >
            Connect local runtime
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-disconnect"
            disabled={!connected}
            onClick={() => issue({ type: 'disconnect' })}
          >
            Disconnect
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-reset"
            onClick={reset}
          >
            Reset development scenario
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-focus"
            disabled={!connected}
            onClick={() =>
              issue({
                type: 'selectAgent',
                agentId: MANAGER_PREVIEW_IDS.manager,
              })
            }
          >
            Select Manager
          </button>
        </div>
        <p data-testid="manager-template">
          {MANAGER_PREVIEW_TEMPLATE}. Every submitted request uses this same
          fixed template.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            receiveRequest()
          }}
        >
          <label>
            Request title
            <input
              data-testid="manager-request-title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              disabled={!connected}
            />
          </label>
          <label>
            Request description
            <textarea
              data-testid="manager-request-description"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              disabled={!connected}
              rows={2}
            />
          </label>
          <button
            className="reset-view"
            type="submit"
            data-testid="manager-receive"
            disabled={!connected || !title.trim() || !description.trim()}
          >
            Submit request
          </button>
        </form>
        <div className="manager-preview-actions">
          <label>
            Selected request
            <select
              data-testid="manager-request"
              value={requestId ?? ''}
              disabled={!connected}
              onChange={(event) =>
                setRequestId(event.currentTarget.value || null)
              }
            >
              <option value="">No request selected</option>
              {Object.values(state.requests).map((item) => (
                <option key={item.requestId} value={item.requestId}>
                  {item.title} ({item.requestId})
                </option>
              ))}
            </select>
          </label>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-plan"
            disabled={!connected || !request || request.status === 'planning'}
            onClick={() => void planRequest()}
          >
            Plan with development template
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-dispatch"
            disabled={!connected || !plan}
            onClick={dispatchReady}
          >
            Dispatch eligible tasks
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-cancel"
            disabled={!connected || !request}
            onClick={() =>
              request &&
              report(
                manager.cancelRequest(request.requestId, reason),
                'Request cancellation recorded.',
              )
            }
          >
            Cancel selected request
          </button>
        </div>
        <div className="manager-preview-actions">
          <label>
            Selected plan task
            <select
              data-testid="manager-task"
              value={task?.id ?? ''}
              disabled={!connected}
              onChange={(event) => selectTask(event.currentTarget.value)}
            >
              <option value="">No plan task selected</option>
              {tasks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Manual outcome reason
            <input
              data-testid="manager-outcome-reason"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              disabled={!connected}
            />
          </label>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-complete-task"
            disabled={!connected || !task}
            onClick={() =>
              task && issue({ type: 'completeTask', taskId: task.id })
            }
          >
            Manually complete task
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-block-task"
            disabled={!connected || !task || !reason.trim()}
            onClick={() =>
              task && issue({ type: 'blockTask', taskId: task.id, reason })
            }
          >
            Report task blocked
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-fail-task"
            disabled={!connected || !task || !reason.trim()}
            onClick={() =>
              task && issue({ type: 'failTask', taskId: task.id, reason })
            }
          >
            Report task failed
          </button>
          <button
            className="reset-view"
            type="button"
            data-testid="manager-resume-task"
            disabled={!connected || !task}
            onClick={() =>
              task && issue({ type: 'startTask', taskId: task.id })
            }
          >
            Explicitly resume task
          </button>
        </div>
      </section>
      {feedback && (
        <p
          className="asset-preview-notice"
          role="status"
          data-testid="manager-feedback"
        >
          {feedback}
        </p>
      )}
      {monitorError && (
        <div
          className="asset-preview-notice"
          role="alert"
          data-testid="manager-monitor-error"
        >
          <p>
            Manager runtime update was not committed: {monitorError.code}:{' '}
            {monitorError.message}
          </p>
          {plan ? (
            <button
              className="reset-view"
              type="button"
              data-testid="manager-synchronize"
              disabled={!connected || !request}
              onClick={() =>
                request &&
                report(
                  manager.synchronize(request.requestId),
                  'Workflow synchronization retried.',
                )
              }
            >
              Retry workflow synchronization
            </button>
          ) : (
            <p>
              Select and cancel the affected request before submitting a fresh
              request to retry planning.
            </p>
          )}
        </div>
      )}
      <details className="manager-preview-context" open>
        <summary>Manager request, plan and execution context</summary>
        {!connected && Object.keys(state.requests).length > 0 && (
          <p data-testid="manager-retained-records">
            Disconnected — showing retained local session records; commands and
            3D runtime are inactive.
          </p>
        )}
        <dl data-testid="manager-context">
          <dt>Manager</dt>
          <dd>{context.manager?.name ?? 'Not registered'}</dd>
          <dt>Manager status</dt>
          <dd>{context.manager?.status ?? 'Not connected'}</dd>
          <dt>Request</dt>
          <dd>{request?.title ?? 'No request selected'}</dd>
          <dt>Request ID</dt>
          <dd>{request?.requestId ?? 'None'}</dd>
          <dt>Request status</dt>
          <dd data-testid="manager-request-status">
            {request?.status ?? 'None'}
          </dd>
          <dt>Plan ID</dt>
          <dd>{plan?.planId ?? 'No plan committed'}</dd>
          <dt>Plan status</dt>
          <dd data-testid="manager-plan-status">{plan?.status ?? 'None'}</dd>
          <dt>Active tasks</dt>
          <dd>
            {context.activeTasks.map((item) => item.title).join(', ') || 'None'}
          </dd>
          <dt>Blocked tasks</dt>
          <dd>
            {context.blockedTasks.map((item) => item.title).join(', ') ||
              'None'}
          </dd>
          <dt>Completed tasks</dt>
          <dd>
            {context.completedTasks.map((item) => item.title).join(', ') ||
              'None'}
          </dd>
          <dt>Active agents</dt>
          <dd>
            {context.activeAgents.map((item) => item.name).join(', ') || 'None'}
          </dd>
        </dl>
        {!!request?.issues.length && (
          <ul data-testid="manager-request-issues">
            {request.issues.map((issue, index) => (
              <li key={`${issue.code}:${issue.taskId}:${index}`}>
                {issue.code}: {issue.message}
              </li>
            ))}
          </ul>
        )}
        {plan && (
          <div className="manager-preview-graph">
            <table
              className="runtime-task-table"
              data-testid="manager-task-graph"
            >
              <caption>Committed task graph — live runtime records</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Depends on</th>
                  <th scope="col">Assigned agent</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((item) => (
                  <tr key={item.id} data-task-id={item.id}>
                    <td>
                      <button
                        className="reset-view"
                        type="button"
                        disabled={!connected}
                        onClick={() => selectTask(item.id)}
                      >
                        {item.title}
                      </button>
                    </td>
                    <td>
                      {item.dependencyIds
                        .map((id) => state.tasks[id]?.title ?? id)
                        .join(', ') || 'None'}
                    </td>
                    <td>
                      {item.assignedAgentId
                        ? (state.agents[item.assignedAgentId]?.name ??
                          item.assignedAgentId)
                        : 'Unassigned'}
                    </td>
                    <td data-testid={`manager-task-status-${item.id}`}>
                      {item.status}
                    </td>
                    <td>{item.progressPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3>Execution result</h3>
        <div data-testid="manager-result">
          {context.result ? (
            <>
              <p>{context.result.summary}</p>
              <p>
                Status: {context.result.status}. Completed:{' '}
                {context.result.completedTaskIds.length}; failed:{' '}
                {context.result.failedTaskIds.length}; blocked:{' '}
                {context.result.blockedTaskIds.length}.
              </p>
              <p>
                {context.result.artifacts.length
                  ? context.result.artifacts
                      .map((artifact) => artifact.title)
                      .join(', ')
                  : 'No artifacts have been reported.'}
              </p>
            </>
          ) : (
            <p>No execution result is available.</p>
          )}
        </div>
        <h3>Recent orchestration events</h3>
        {context.events.length ? (
          <ol data-testid="manager-events">
            {context.events.slice(-8).map((event) => (
              <li key={event.id}>
                <time dateTime={event.occurredAt}>{event.occurredAt}</time>{' '}
                {event.type}
              </li>
            ))}
          </ol>
        ) : (
          <p>No orchestration events recorded.</p>
        )}
      </details>
      <RuntimeOffice runtime={runtime} diagnostics />
    </>
  )
}
