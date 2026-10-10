import { useRef, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import {
  DEVELOPMENT_AGENT_IDS,
  developmentRegistrations,
  developmentTask,
} from './runtimeFixtures'

const scenarios = {
  workstation: 'Task → workstation → working → completion',
  dependency: 'Dependency A → B',
  collaboration: 'Collaboration hub → assigned desk',
  blocked: 'Blocked task → repair → explicit resume',
  manager: 'Manager review and task overview',
} as const
type Scenario = keyof typeof scenarios

export default function OfficeRuntimePreview() {
  const [runtime, setRuntime] = useState(createOfficeRuntime)
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const seeded = useRef(false)
  const command = useRef(0)
  const [scenario, setScenario] = useState<Scenario>('workstation')
  const [progress, setProgress] = useState('50')
  const [feedback, setFeedback] = useState<string | null>(null)
  const connected = state.connection === 'local'
  const agents = Object.values(state.agents)
  const tasks = Object.values(state.tasks)
  const agentId = state.selectedAgentId ?? DEVELOPMENT_AGENT_IDS.workerA
  const agent = state.agents[agentId]
  const task = state.selectedTaskId
    ? state.tasks[state.selectedTaskId]
    : undefined

  function issue(input: RuntimeCommand) {
    const result = runtime.dispatch(input)
    setFeedback(result.ok ? `Applied ${input.type}.` : result.error.message)
    return result.ok
  }

  function issueAll(inputs: readonly RuntimeCommand[]) {
    for (const input of inputs) if (!issue(input)) return false
    return true
  }

  function connect() {
    if (!issue({ type: 'connect' })) return
    if (!seeded.current) seeded.current = issueAll(developmentRegistrations())
  }

  function reset() {
    setRuntime(createOfficeRuntime())
    seeded.current = false
    command.current = 0
    setProgress('50')
    setFeedback('Reset to a new empty, disconnected local runtime.')
  }

  function createTask() {
    const id = `phase5-task-${++command.current}`
    const manager = scenario === 'manager'
    const title = manager
      ? 'Development Manager review'
      : `Development ${scenario} task`
    const inputs: RuntimeCommand[] = [
      { type: 'createTask', task: developmentTask(id, title) },
      { type: 'selectTask', taskId: id },
    ]
    if (manager)
      inputs.push(
        {
          type: 'assignTask',
          taskId: id,
          agentId: DEVELOPMENT_AGENT_IDS.manager,
        },
        { type: 'selectAgent', agentId: DEVELOPMENT_AGENT_IDS.manager },
      )
    issueAll(inputs)
  }

  function createDependencyPair() {
    const suffix = ++command.current
    const first = `phase5-dependency-${suffix}-a`
    const second = `phase5-dependency-${suffix}-b`
    issueAll([
      {
        type: 'createTask',
        task: developmentTask(first, 'Development dependency A'),
      },
      {
        type: 'createTask',
        task: developmentTask(second, 'Development dependency B', [first]),
      },
      {
        type: 'assignTask',
        taskId: first,
        agentId: DEVELOPMENT_AGENT_IDS.workerA,
      },
      {
        type: 'assignTask',
        taskId: second,
        agentId: DEVELOPMENT_AGENT_IDS.workerB,
      },
      { type: 'selectTask', taskId: first },
      { type: 'selectAgent', agentId: DEVELOPMENT_AGENT_IDS.workerA },
    ])
  }

  function collaborate() {
    if (!agent) return
    issue({
      type: 'requestMovement',
      agentId: agent.id,
      destinationType: 'hub',
      destinationId: 'hub:central',
      movementReason: 'Explicit development collaboration request',
      arrivalStatus: 'collaborating',
      collaboratorIds: [
        agent.id === DEVELOPMENT_AGENT_IDS.workerB
          ? DEVELOPMENT_AGENT_IDS.workerA
          : DEVELOPMENT_AGENT_IDS.workerB,
      ],
    })
  }

  function returnToDesk() {
    if (!agent?.workstationId) return
    const currentTask = agent.currentTaskId
      ? state.tasks[agent.currentTaskId]
      : null
    issue({
      type: 'requestMovement',
      agentId: agent.id,
      destinationType: 'workstation',
      destinationId: agent.workstationId,
      movementReason: 'Explicit development return to the assigned workstation',
      arrivalStatus:
        currentTask?.status === 'in_progress' ? 'working' : 'waiting',
    })
  }

  return (
    <>
      <p className="asset-preview-notice" data-testid="runtime-connection">
        {connected
          ? 'Local development runtime connected.'
          : 'Local runtime disconnected.'}{' '}
        This preview uses three development registrations and explicit in-memory
        commands. Tasks are created only by the controls below; progress and
        completion are never simulated automatically. No external services run.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Local runtime connection</legend>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-connect"
          disabled={connected}
          onClick={connect}
        >
          Connect local runtime
        </button>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-disconnect"
          disabled={!connected}
          onClick={() => issue({ type: 'disconnect' })}
        >
          Disconnect
        </button>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-reset"
          onClick={reset}
        >
          Reset development scenario
        </button>
      </fieldset>
      <fieldset className="animation-preview-controls" disabled={!connected}>
        <legend>Explicit development commands</legend>
        <label>
          Development scenario
          <select
            data-testid="runtime-scenario"
            value={scenario}
            onChange={(event) =>
              setScenario(event.currentTarget.value as Scenario)
            }
          >
            {Object.entries(scenarios).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent command target
          <select
            data-testid="runtime-agent"
            value={agents.length ? agentId : ''}
            onChange={(event) =>
              issue({ type: 'selectAgent', agentId: event.currentTarget.value })
            }
          >
            {!agents.length && (
              <option value="">
                Connect to register the development characters
              </option>
            )}
            {agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Selected task
          <select
            data-testid="runtime-task"
            value={task?.id ?? ''}
            onChange={(event) =>
              issue({
                type: 'selectTask',
                taskId: event.currentTarget.value || null,
              })
            }
          >
            <option value="">No task selected</option>
            {tasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} ({item.id})
              </option>
            ))}
          </select>
        </label>
        {scenario === 'dependency' ? (
          <button
            className="reset-view"
            type="button"
            data-testid="runtime-create-dependencies"
            onClick={createDependencyPair}
          >
            Create and assign dependency pair
          </button>
        ) : (
          <button
            className="reset-view"
            type="button"
            data-testid="runtime-create-task"
            onClick={createTask}
          >
            {scenario === 'manager'
              ? 'Create and assign Manager review'
              : 'Create development task'}
          </button>
        )}
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-assign-task"
          disabled={!task || !agent}
          onClick={() =>
            task &&
            agent &&
            issue({ type: 'assignTask', taskId: task.id, agentId: agent.id })
          }
        >
          Assign selected task
        </button>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-start-task"
          disabled={!task}
          onClick={() => task && issue({ type: 'startTask', taskId: task.id })}
        >
          Start / resume selected task
        </button>
        <label>
          Requested progress percent
          <input
            data-testid="runtime-progress-value"
            type="number"
            min={0}
            max={100}
            value={progress}
            onChange={(event) => setProgress(event.currentTarget.value)}
          />
        </label>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-set-progress"
          disabled={!task || !progress.trim()}
          onClick={() =>
            task &&
            issue({
              type: 'updateProgress',
              taskId: task.id,
              progressPercent: Number(progress),
            })
          }
        >
          Set progress
        </button>
        <button
          className="reset-view"
          type="button"
          data-testid="runtime-complete-task"
          disabled={!task}
          onClick={() =>
            task && issue({ type: 'completeTask', taskId: task.id })
          }
        >
          Complete selected task
        </button>
        {scenario === 'collaboration' && (
          <>
            <button
              className="reset-view"
              type="button"
              data-testid="runtime-collaborate"
              disabled={!agent}
              onClick={collaborate}
            >
              Request collaboration at hub
            </button>
            <button
              className="reset-view"
              type="button"
              data-testid="runtime-return"
              disabled={!agent?.workstationId}
              onClick={returnToDesk}
            >
              Return to assigned desk
            </button>
          </>
        )}
        {scenario === 'blocked' && (
          <>
            <button
              className="reset-view"
              type="button"
              data-testid="runtime-block-task"
              disabled={!task}
              onClick={() =>
                task &&
                issue({
                  type: 'blockTask',
                  taskId: task.id,
                  reason:
                    'Development blocker explicitly requested from the preview.',
                })
              }
            >
              Block selected task
            </button>
            <button
              className="reset-view"
              type="button"
              data-testid="runtime-repair-agent"
              disabled={!agent}
              onClick={() =>
                agent &&
                issue({
                  type: 'beginRepair',
                  agentId: agent.id,
                  reason:
                    'Development repair explicitly requested; resume remains a separate command.',
                })
              }
            >
              Put agent in repair
            </button>
            <button
              className="reset-view"
              type="button"
              data-testid="runtime-acknowledge-repair"
              disabled={!agent}
              onClick={() =>
                agent &&
                issue({
                  type: 'repairAgent',
                  agentId: agent.id,
                  reason:
                    'Development repair explicitly acknowledged; work has not resumed.',
                })
              }
            >
              Acknowledge repair
            </button>
          </>
        )}
        {scenario === 'manager' && (
          <button
            className="reset-view"
            type="button"
            data-testid="runtime-focus-manager"
            onClick={() =>
              issue({
                type: 'selectAgent',
                agentId: DEVELOPMENT_AGENT_IDS.manager,
              })
            }
          >
            Select Manager
          </button>
        )}
      </fieldset>
      {feedback && (
        <p
          className="asset-preview-notice"
          data-testid="runtime-feedback"
          role="status"
        >
          {feedback}
        </p>
      )}
      <RuntimeOffice runtime={runtime} diagnostics />
      <section aria-labelledby="runtime-task-overview-heading">
        <h2 id="runtime-task-overview-heading">Local task overview</h2>
        {tasks.length ? (
          <table
            className="runtime-task-table"
            data-testid="runtime-task-overview"
          >
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Assigned agent</th>
                <th scope="col">Status</th>
                <th scope="col">Progress</th>
                <th scope="col">Dependencies</th>
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
                      onClick={() =>
                        issueAll([
                          { type: 'selectTask', taskId: item.id },
                          ...(item.assignedAgentId
                            ? [
                                {
                                  type: 'selectAgent' as const,
                                  agentId: item.assignedAgentId,
                                },
                              ]
                            : []),
                        ])
                      }
                    >
                      {item.title}
                    </button>
                  </td>
                  <td>
                    {item.assignedAgentId
                      ? (state.agents[item.assignedAgentId]?.name ??
                        item.assignedAgentId)
                      : 'Unassigned'}
                  </td>
                  <td data-testid={`runtime-task-status-${item.id}`}>
                    {item.status}
                  </td>
                  <td>{item.progressPercent}%</td>
                  <td>{item.dependencyIds.join(', ') || 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No tasks have been created in this local runtime.</p>
        )}
      </section>
    </>
  )
}
