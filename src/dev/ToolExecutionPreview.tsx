import { useEffect, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import { ToolPreviewClient } from './toolPreviewClient'
import type {
  ToolPreviewAction,
  ToolPreviewOperation,
  ToolPreviewScenario,
} from './toolPreviewProtocol'
import './ManagerOrchestrationPreview.css'

const operations: Record<
  ToolPreviewScenario,
  readonly [ToolPreviewOperation, string][]
> = {
  research: [['research', 'Run fixture research']],
  coding: [
    ['read', 'Read sandbox file'],
    ['terminal', 'Run Node version'],
  ],
  git: [
    ['git-status', 'Git status'],
    ['git-diff', 'Git diff'],
    ['git-add', 'Stage fixture file'],
    ['git-commit', 'Commit staged fixture file'],
  ],
  denied: [['denied', 'Request denied terminal tool']],
  timeout: [
    ['timeout', 'Run short timeout command'],
    ['cancellable', 'Run cancellable command'],
  ],
}

export function ToolExecutionPreview() {
  const [client] = useState(() => new ToolPreviewClient())
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const preview = useSyncExternalStore(
    client.subscribe,
    client.getPreview,
    client.getPreview,
  )
  const [scenario, setScenario] = useState<ToolPreviewScenario>('research')
  const [notice, setNotice] = useState(
    'Disconnected. Connect explicitly to create a disposable host sandbox.',
  )
  const [pendingActions, setPendingActions] = useState(0)
  const busy = pendingActions > 0
  useEffect(() => () => client.dispose(), [client])
  const run = async (action?: ToolPreviewAction) => {
    setPendingActions((count) => count + 1)
    try {
      setNotice(await (action ? client.action(action) : client.connect()))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Host action failed.')
    } finally {
      setPendingActions((count) => count - 1)
    }
  }
  const connected = state.connection === 'local'
  const task = preview?.taskId ? state.tasks[preview.taskId] : null
  const assignedAgent = task?.assignedAgentId
    ? state.agents[task.assignedAgentId]
    : null
  const readyToExecute =
    task?.status === 'in_progress' && assignedAgent?.status === 'working'
  const request = preview?.requestId ? state.requests[preview.requestId] : null
  const plan = request?.planId ? state.plans[request.planId] : null
  const executions = Object.values(state.toolExecutions)
  return (
    <>
      <section
        className="manager-preview-controls"
        data-testid="tools-preview-controls"
        aria-label="Development tools execution controls"
      >
        <h2>Local tools execution preview</h2>
        <p>
          Development only. One authoritative host runtime owns these records.
          Research is an explicit fixture with no web search. File, terminal and
          Git operations execute only inside a disposable sandbox with fixed
          permissions and commands.
        </p>
        <div className="manager-preview-actions">
          <button
            type="button"
            data-testid="tools-connect"
            disabled={busy}
            onClick={() => void run()}
          >
            Connect / reset sandbox
          </button>
          <button
            type="button"
            data-testid="tools-disconnect"
            disabled={!connected}
            onClick={() => void run({ action: 'disconnect' })}
          >
            Disconnect
          </button>
          <button
            type="button"
            data-testid="tools-reconnect"
            disabled={connected || !preview || busy}
            onClick={() => void run({ action: 'reconnect' })}
          >
            Reconnect retained session
          </button>
        </div>
        <p role="status" data-testid="tools-notice">
          {notice}
        </p>
        {!connected && preview && (
          <p>
            Disconnected — retained host records are inactive; the 3D runtime is
            disconnected.
          </p>
        )}
        <label>
          Explicit development scenario{' '}
          <select
            data-testid="tools-scenario"
            value={scenario}
            onChange={(event) =>
              setScenario(event.target.value as ToolPreviewScenario)
            }
          >
            <option value="research">A — Fixture research</option>
            <option value="coding">B — Real file read and terminal</option>
            <option value="git">
              C — Disposable Git inspection and commit
            </option>
            <option value="denied">D — Permission denied</option>
            <option value="timeout">
              E — Real process timeout / cancellation
            </option>
          </select>
        </label>
        <button
          type="button"
          data-testid="tools-prepare"
          disabled={!connected || busy}
          onClick={() => void run({ action: 'prepare', scenario })}
        >
          Manager: plan and dispatch scenario
        </button>
        <div className="manager-preview-actions">
          {(preview?.scenario ? operations[preview.scenario] : []).map(
            ([operation, label]) => (
              <button
                type="button"
                key={operation}
                data-testid={`tools-execute-${operation}`}
                disabled={!connected || busy || !readyToExecute}
                onClick={() => void run({ action: 'execute', operation })}
              >
                {label}
              </button>
            ),
          )}
          <button
            type="button"
            data-testid="tools-complete"
            disabled={!connected || busy || !task}
            onClick={() => void run({ action: 'complete' })}
          >
            Complete task explicitly
          </button>
          <button
            type="button"
            data-testid="tools-resume"
            disabled={!connected || busy || !task}
            onClick={() => void run({ action: 'resume' })}
          >
            Resume task explicitly
          </button>
          <button
            type="button"
            data-testid="tools-cancel"
            disabled={!connected || !task}
            onClick={() => void run({ action: 'cancel' })}
          >
            Cancel running tool / request
          </button>
        </div>
        {connected && task?.status === 'in_progress' && !readyToExecute && (
          <p>
            Tool execution requires the assigned worker to be in working state.
          </p>
        )}
        <p>
          Tool success leaves the task unresolved. Review the returned output
          before explicitly completing it. Timeout or denial blocks the task for
          attention; Resume is a separate command.
        </p>
        <p data-testid="tools-plan-status">
          Request: {request?.status ?? 'none'} · Plan: {plan?.status ?? 'none'}{' '}
          · Task: {task?.status ?? 'none'} · Progress:{' '}
          {task?.progressPercent ?? 0}%
        </p>
        <div className="manager-preview-actions">
          {Object.values(state.agents).map((agent) => (
            <button
              key={agent.id}
              type="button"
              disabled={!connected}
              data-testid={`tools-focus-${agent.id}`}
              onClick={() =>
                void client.dispatch({ type: 'selectAgent', agentId: agent.id })
              }
            >
              Focus {agent.name}
            </button>
          ))}
        </div>
        <details open>
          <summary>
            Host execution audit and structured outputs ({executions.length})
          </summary>
          <div
            style={{ maxHeight: '24rem', overflow: 'auto' }}
            data-testid="tools-executions"
          >
            {executions.map((execution) => (
              <article
                key={execution.executionId}
                data-testid={`execution-${execution.executionId}`}
              >
                <h3>
                  {execution.toolId} — {execution.status}
                </h3>
                <pre>{JSON.stringify(execution, null, 2)}</pre>
              </article>
            ))}
          </div>
        </details>
        <details>
          <summary>Actual runtime activity</summary>
          <ol data-testid="tools-activity">
            {state.activities.slice(-30).map((activity) => (
              <li key={activity.id}>{activity.summary}</li>
            ))}
          </ol>
        </details>
      </section>
      <RuntimeOffice
        runtime={client}
        diagnostics
        executionNotice="Host runtime connected — controlled local tools execute in a disposable development sandbox. No AI provider is connected."
      />
    </>
  )
}

export default ToolExecutionPreview
