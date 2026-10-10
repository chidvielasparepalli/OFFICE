import { randomUUID } from 'node:crypto'
import { createOfficeRuntime } from '../../src/runtime/officeRuntime'
import { ManagerOrchestrator } from '../../src/orchestration/ManagerOrchestrator'
import { DeterministicPlanner } from '../../src/orchestration/planner'
import { ToolRegistry } from '../../src/tools/ToolRegistry'
import { ToolExecutor } from '../../src/tools/ToolExecutor'
import { createResearchTool } from '../../src/tools/researchTool'
import { DeterministicResearchProvider } from '../../src/dev/deterministicResearchProvider'
import { ToolFault, type ToolExecutionResult } from '../../src/tools/toolTypes'
import type {
  RuntimeCommand,
  RuntimeResult,
} from '../../src/runtime/runtimeTypes'
import type {
  ToolPreviewAction,
  ToolPreviewOperation,
  ToolPreviewScenario,
  ToolPreviewSnapshot,
} from '../../src/dev/toolPreviewProtocol'
import { createFilesystemTools } from '../adapters/filesystem'
import { createTerminalTool } from '../adapters/terminal'
import { createGitTools } from '../adapters/git'
import {
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from '../../src/office/characterMotion'
import { createSandbox, IDS, registrations, scenarioPlan } from './fixtures'

function requireOk(result: RuntimeResult) {
  if (!result.ok) throw new ToolFault(result.error.code, result.error.message)
}
const scenarioOperations: Record<
  ToolPreviewScenario,
  readonly ToolPreviewOperation[]
> = {
  research: ['research'],
  coding: ['read', 'terminal'],
  git: ['git-status', 'git-diff', 'git-add', 'git-commit'],
  denied: ['denied'],
  timeout: ['timeout', 'cancellable'],
}

export async function createPreviewSession(projectRoot: string) {
  const sessionId = randomUUID()
  const { sandbox, git } = await createSandbox(projectRoot, sessionId)
  const runtime = createOfficeRuntime()
  requireOk(runtime.dispatch({ type: 'connect' }))
  for (const command of registrations()) requireOk(runtime.dispatch(command))
  let scenario: ToolPreviewScenario | null = null
  let requestId: string | null = null
  let taskId: string | null = null
  let executionId: string | null = null
  let running = false
  let preparing = false
  let disposed = false
  let counter = 0
  let pendingExecution: Promise<ToolExecutionResult> | null = null
  const registry = new ToolRegistry()
  const roots = { fixture: { path: sandbox, writable: true } }
  registry.register(createResearchTool(new DeterministicResearchProvider()))
  for (const tool of createFilesystemTools({ roots })) registry.register(tool)
  registry.register(
    createTerminalTool({
      roots,
      timeoutMs: 15000,
      commands: {
        'node-version': { executable: process.execPath, args: ['--version'] },
        'bounded-wait': {
          executable: process.execPath,
          args: [
            '-e',
            'setTimeout(() => process.stdout.write("finished\\n"), 10000)',
          ],
          timeoutMs: 1400,
        },
        cancellable: {
          executable: process.execPath,
          args: [
            '-e',
            'setTimeout(() => process.stdout.write("finished\\n"), 10000)',
          ],
          timeoutMs: 15000,
        },
      },
    }),
  )
  const [inspect, add, commit] = createGitTools({
    roots,
    executable: git,
    author: {
      name: 'OFFICE Development Fixture',
      email: 'fixture@example.invalid',
    },
  })
  registry.register(inspect)
  registry.register(add)
  registry.register(commit)
  const executor = new ToolExecutor({
    runtime,
    registry,
    grants: {
      [IDS.research]: { toolIds: ['research.search'], permissions: ['read'] },
      [IDS.coding]: {
        toolIds: [
          'filesystem.read',
          'filesystem.write',
          'terminal.run',
          'git.inspect',
          'git.add',
          'git.commit',
        ],
        permissions: ['read', 'write', 'execute', 'git'],
      },
      [IDS.manager]: { toolIds: [], permissions: [] },
    },
  })
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: IDS.manager,
    planner: new DeterministicPlanner((request) =>
      scenarioPlan(request, scenario!),
    ),
  })
  manager.start()
  const snapshot = (): ToolPreviewSnapshot => ({
    sessionId,
    state: runtime.getSnapshot(),
    scenario,
    requestId,
    taskId,
    executionId,
  })

  async function action(input: ToolPreviewAction) {
    if (disposed)
      throw new ToolFault(
        'SESSION_CLOSED',
        'This development session has ended.',
      )
    if (preparing && input.action !== 'feedback')
      throw new ToolFault(
        'BUSY',
        'Wait for the explicit planning command to finish.',
      )
    if (input.action === 'feedback') {
      validateFeedback(input.command)
      requireOk(runtime.dispatch(input.command))
      return 'Host accepted discrete scene feedback.'
    }
    if (input.action === 'cancel') {
      if (executionId && running) {
        executor.cancel(executionId)
        return 'Cancellation requested.'
      }
      if (requestId)
        requireOk(
          manager.cancelRequest(
            requestId,
            'Explicit development cancellation.',
          ),
        )
      return 'Request cancelled explicitly.'
    }
    if (input.action === 'disconnect') {
      if (executionId && running) executor.cancel(executionId)
      requireOk(runtime.dispatch({ type: 'disconnect' }))
      return 'Disconnected; retained session records are inactive.'
    }
    if (input.action === 'reconnect') {
      requireOk(runtime.dispatch({ type: 'connect' }))
      return 'Reconnected to the same host session.'
    }
    if (running || executor.getMetrics().activeExecutions > 0)
      throw new ToolFault(
        'BUSY',
        'Wait for the current tool execution and its host cleanup to finish.',
      )
    if (runtime.getSnapshot().connection !== 'local')
      throw new ToolFault('DISCONNECTED', 'Connect before sending a command.')
    if (input.action === 'prepare') {
      if (counter > 100)
        throw new ToolFault(
          'SESSION_LIMIT',
          'Reset the development session before creating more records.',
        )
      if (
        taskId &&
        !['completed', 'failed', 'cancelled'].includes(
          runtime.getSnapshot().tasks[taskId].status,
        )
      )
        throw new ToolFault(
          'ACTIVE_TASK',
          'Complete or cancel the current scenario before preparing another.',
        )
      preparing = true
      try {
        scenario = input.scenario
        requestId = `phase7-request-${++counter}`
        taskId = `${requestId}:task`
        executionId = null
        requireOk(
          manager.receiveRequest({
            requestId,
            title: `Development ${scenario} scenario`,
            description:
              'Explicit host fixture; no natural-language inference or external provider.',
            requestedBy: 'Development preview user',
            priority: 'normal',
            constraints: [
              'Disposable sandbox only',
              'Tool success never completes this task',
            ],
          }),
        )
        requireOk(await manager.planRequest(requestId))
        const dispatched = manager.dispatchReady(requestId)
        if (!dispatched.ok)
          throw new ToolFault(
            'DISPATCH_FAILED',
            dispatched.issues.map((issue) => issue.message).join(' '),
          )
        requireOk(runtime.dispatch({ type: 'selectTask', taskId }))
        requireOk(
          runtime.dispatch({
            type: 'selectAgent',
            agentId: runtime.getSnapshot().tasks[taskId].assignedAgentId,
          }),
        )
        return 'Manager planned and dispatched the explicit development task.'
      } finally {
        preparing = false
      }
    }
    if (!taskId || !scenario)
      throw new ToolFault('NO_TASK', 'Prepare a scenario first.')
    if (input.action === 'complete' || input.action === 'resume') {
      requireOk(
        runtime.dispatch({
          type: input.action === 'complete' ? 'completeTask' : 'startTask',
          taskId,
        }),
      )
      return input.action === 'complete'
        ? 'Task completed by explicit user command.'
        : 'Task resumed by explicit user command.'
    }
    if (input.action !== 'execute')
      throw new ToolFault('ACTION_DENIED', 'Unsupported action.')
    if (counter > 100)
      throw new ToolFault(
        'SESSION_LIMIT',
        'Reset the development session before creating more records.',
      )
    if (!scenarioOperations[scenario].includes(input.operation))
      throw new ToolFault(
        'OPERATION_DENIED',
        'This operation is not part of the selected scenario.',
      )
    const agentId = runtime.getSnapshot().tasks[taskId].assignedAgentId!
    const operation = input.operation
    const toolId =
      operation === 'research'
        ? 'research.search'
        : operation === 'read'
          ? 'filesystem.read'
          : operation === 'denied' ||
              operation === 'terminal' ||
              operation === 'timeout' ||
              operation === 'cancellable'
            ? 'terminal.run'
            : operation === 'git-add'
              ? 'git.add'
              : operation === 'git-commit'
                ? 'git.commit'
                : 'git.inspect'
    const toolInput =
      operation === 'research'
        ? { query: 'Development fixture query; no real web search.' }
        : operation === 'read'
          ? { rootId: 'fixture', path: 'readme.txt' }
          : toolId === 'terminal.run'
            ? {
                rootId: 'fixture',
                cwd: '.',
                commandId:
                  operation === 'timeout'
                    ? 'bounded-wait'
                    : operation === 'cancellable'
                      ? 'cancellable'
                      : 'node-version',
              }
            : operation === 'git-add'
              ? { rootId: 'fixture', paths: ['readme.txt'] }
              : operation === 'git-commit'
                ? {
                    rootId: 'fixture',
                    paths: ['readme.txt'],
                    message: 'Record explicit development fixture change',
                  }
                : operation === 'git-diff'
                  ? {
                      rootId: 'fixture',
                      operation: 'diff',
                      paths: ['readme.txt'],
                    }
                  : { rootId: 'fixture', operation: 'status' }
    executionId = `phase7-execution-${++counter}`
    running = true
    try {
      pendingExecution = executor.execute({
        executionId,
        agentId,
        taskId,
        toolId,
        input: toolInput,
      })
      const result = await pendingExecution
      return `Tool ${result.status}${result.error ? `: ${result.error.message}` : ''}. Task completion remains explicit.`
    } finally {
      running = false
      pendingExecution = null
    }
  }

  function validateFeedback(command: RuntimeCommand) {
    const state = runtime.getSnapshot()
    if (command.type === 'selectAgent' || command.type === 'selectTask') return
    if (command.type !== 'arrive' && command.type !== 'rejectMovement')
      throw new ToolFault(
        'COMMAND_DENIED',
        'Only selection and discrete spatial feedback are accepted from the scene.',
      )
    const agent = state.agents[command.agentId]
    if (!agent || agent.destination?.id !== command.intentId)
      throw new ToolFault(
        'STALE_INTENT',
        'Spatial feedback does not match the current host intent.',
      )
    if (command.type === 'arrive') {
      const desk =
        agent.workstationId && state.workstations[agent.workstationId]
      if (!desk || agent.destination.destinationType !== 'workstation')
        throw new ToolFault(
          'DESTINATION_DENIED',
          'Only the assigned fixture workstation may receive arrival feedback.',
        )
      const near = ([px, py, pz]: readonly number[]) =>
        Math.hypot(
          command.position[0] - px,
          command.position[1] - py,
          command.position[2] - pz,
        ) < 0.03
      const facing = Math.abs(
        Math.atan2(
          Math.sin(command.headingRadians - desk.headingRadians),
          Math.cos(command.headingRadians - desk.headingRadians),
        ),
      )
      if (
        !near(seatedWorkstationAnchor(desk)) &&
        !near(standingWorkstationAnchor(desk))
      )
        throw new ToolFault(
          'INVALID_ARRIVAL',
          'Arrival must match an authored seated or standing workstation anchor.',
        )
      if (near(seatedWorkstationAnchor(desk)) && facing > 0.02)
        throw new ToolFault(
          'INVALID_ARRIVAL',
          'A seated arrival must face its assigned workstation.',
        )
    }
  }
  return {
    sessionId,
    runtime,
    snapshot,
    action,
    cancelRunning: () => {
      if (running && executionId) executor.cancel(executionId)
    },
    dispose: async () => {
      disposed = true
      executor.dispose()
      manager.dispose()
      await pendingExecution?.catch(() => undefined)
    },
  }
}
export type PreviewSession = Awaited<ReturnType<typeof createPreviewSession>>
