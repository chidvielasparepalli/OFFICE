import {
  ToolFault,
  type ToolExecutionResult,
  type ToolPermission,
  type ToolPermissionDecision,
  type ToolRuntimeCommand,
} from '../tools/toolTypes'
import {
  publicToolJson,
  redactToolText,
  toolId,
  toolText,
} from '../tools/toolValidation'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type { RuntimeCommand, RuntimeJson, RuntimeState } from './runtimeTypes'

// The same transaction interface is shared by both domain handlers. Neither owns
// a second store, clock, executor, permission registry, or publication boundary.
type ToolTransaction = OrchestrationTransaction

const commands = new Set([
  'requestToolExecution',
  'startToolExecution',
  'completeToolExecution',
  'failToolExecution',
  'cancelToolExecution',
])
const permissions: readonly ToolPermission[] = [
  'read',
  'write',
  'execute',
  'network',
  'git',
]
const live = (execution: ToolExecutionResult) =>
  execution.status === 'queued' || execution.status === 'running'

function ensure(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new ToolFault(code, message)
}

function safeText(value: unknown, label: string) {
  const checked = toolText(value, label, 1024)
  return redactToolText(checked)
}

function permissionCopy(value: ToolPermissionDecision): ToolPermissionDecision {
  ensure(
    value && typeof value.allowed === 'boolean',
    'INVALID_INPUT',
    'A permission decision is required.',
  )
  ensure(
    Array.isArray(value.requiredPermissions) &&
      new Set(value.requiredPermissions).size ===
        value.requiredPermissions.length &&
      value.requiredPermissions.every((permission) =>
        permissions.includes(permission),
      ),
    'INVALID_INPUT',
    'Permission scopes must be unique known permissions.',
  )
  return {
    allowed: value.allowed,
    code: toolId(value.code),
    reason: safeText(value.reason, 'Permission reason'),
    requiredPermissions: [...value.requiredPermissions],
  }
}

function patch(
  tx: ToolTransaction,
  execution: ToolExecutionResult,
  changes: Partial<ToolExecutionResult>,
) {
  tx.state = {
    ...tx.state,
    toolExecutions: {
      ...tx.state.toolExecutions,
      [execution.executionId]: { ...execution, ...changes },
    },
  }
}

function requireOwnership(
  tx: ToolTransaction,
  agentId: string,
  taskId: string,
) {
  const agent = tx.agent(agentId)
  const task = tx.task(taskId)
  ensure(
    agent.currentTaskId === task.id && task.assignedAgentId === agent.id,
    'INVALID_ASSIGNMENT',
    'Tool execution must belong to the assigned agent and its current task.',
  )
  ensure(
    task.status === 'in_progress',
    'INVALID_TRANSITION',
    'Tool execution requires an explicitly started task.',
  )
  ensure(
    agent.status === 'working',
    'INVALID_TRANSITION',
    'Tool execution requires a working agent.',
  )
  return { agent, task }
}

function activeExecution(tx: ToolTransaction, id: string) {
  toolId(id)
  ensure(
    Object.hasOwn(tx.state.toolExecutions, id),
    'NOT_FOUND',
    'Tool execution does not exist.',
  )
  const execution = tx.state.toolExecutions[id]
  ensure(
    live(execution),
    'STALE_TOOL_EXECUTION',
    'Tool execution is already terminal; late callbacks are ignored.',
  )
  requireOwnership(tx, execution.agentId, execution.taskId)
  return execution
}

function payload(
  execution: ToolExecutionResult,
): Readonly<Record<string, RuntimeJson>> {
  return { executionId: execution.executionId, toolId: execution.toolId }
}

function fail(
  tx: ToolTransaction,
  execution: ToolExecutionResult,
  code: string,
  message: string,
) {
  patch(tx, execution, {
    status: 'failed',
    completedAt: tx.time,
    error: { code, message },
    output: null,
  })
  tx.emit(
    'TOOL_FAILED',
    `Tool ${execution.toolId} failed (${code}): ${message}`,
    execution.agentId,
    execution.taskId,
    { ...payload(execution), code },
  )
  tx.apply({
    type: 'blockTask',
    taskId: execution.taskId,
    reason: `Tool ${execution.toolId} failed (${code}): ${message}`,
  })
}

export function isToolRuntimeCommand(
  command: RuntimeCommand,
): command is ToolRuntimeCommand {
  return commands.has(command.type)
}

export function hasLiveToolExecution(
  state: RuntimeState,
  target: { agentId?: string; taskId?: string },
) {
  return Object.values(state.toolExecutions).some(
    (execution) =>
      live(execution) &&
      (target.agentId === undefined || execution.agentId === target.agentId) &&
      (target.taskId === undefined || execution.taskId === target.taskId),
  )
}

/** Invalidate before publishing a task transition/disconnect, then the host aborts
 * its matching process. No late callback can change the cancelled execution. */
export function cancelLiveToolExecutions(
  tx: ToolTransaction,
  matches: (execution: ToolExecutionResult) => boolean,
  reason: string,
  waitForTask = false,
) {
  const message = safeText(reason, 'Cancellation reason')
  for (const execution of Object.values(tx.state.toolExecutions)) {
    if (!live(execution) || !matches(execution)) continue
    patch(tx, execution, {
      status: 'cancelled',
      completedAt: tx.time,
      error: { code: 'TOOL_CANCELLED', message },
      output: null,
    })
    tx.emit(
      'TOOL_CANCELLED',
      `Cancelled tool ${execution.toolId}: ${message}`,
      execution.agentId,
      execution.taskId,
      payload(execution),
    )
    const task = tx.state.tasks[execution.taskId]
    const agent = tx.state.agents[execution.agentId]
    if (
      waitForTask &&
      task?.status === 'in_progress' &&
      task.assignedAgentId === agent?.id &&
      agent.currentTaskId === task.id &&
      !['blocked', 'repair'].includes(agent.status)
    )
      tx.apply({
        type: 'waitTask',
        taskId: task.id,
        reason: `Tool execution cancelled: ${message}`,
      })
  }
}

export function applyToolRuntimeCommand(
  tx: ToolTransaction,
  command: ToolRuntimeCommand,
) {
  if (command.type === 'requestToolExecution') {
    const executionId = toolId(command.executionId)
    ensure(
      !['constructor', 'prototype', '__proto__'].includes(executionId),
      'INVALID_INPUT',
      'Execution ID is reserved.',
    )
    ensure(
      !Object.hasOwn(tx.state.toolExecutions, executionId),
      'DUPLICATE_ID',
      'Tool execution ID already exists.',
    )
    const tool = toolId(command.toolId)
    requireOwnership(tx, command.agentId, command.taskId)
    ensure(
      !hasLiveToolExecution(tx.state, { agentId: command.agentId }),
      'TOOL_ACTIVE',
      'The agent already has a queued or running tool.',
    )
    const permission = permissionCopy(command.permission)
    const inputSummary = publicToolJson(command.inputSummary, 8 * 1024)
    const metadata = publicToolJson(command.metadata ?? {}, 8 * 1024)
    ensure(
      metadata !== null &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata),
      'INVALID_INPUT',
      'Tool metadata must be a JSON object.',
    )
    const execution: ToolExecutionResult = {
      executionId,
      agentId: command.agentId,
      taskId: command.taskId,
      toolId: tool,
      status: 'queued',
      requestedAt: tx.time,
      startedAt: null,
      completedAt: null,
      inputSummary,
      permission,
      output: null,
      error: null,
      metadata: metadata as Readonly<Record<string, RuntimeJson>>,
    }
    patch(tx, execution, {})
    tx.emit(
      'TOOL_REQUESTED',
      `Requested tool ${tool}.`,
      execution.agentId,
      execution.taskId,
      {
        ...payload(execution),
        allowed: permission.allowed,
        permissionCode: permission.code,
      },
    )
    // A committed denial is a successful audit command, never execution authority.
    if (!permission.allowed)
      fail(tx, execution, permission.code, permission.reason)
    return
  }
  const execution = activeExecution(tx, command.executionId)
  switch (command.type) {
    case 'startToolExecution':
      ensure(
        execution.status === 'queued' && execution.permission.allowed,
        'INVALID_TRANSITION',
        'Only an allowed queued tool can start.',
      )
      patch(tx, execution, { status: 'running', startedAt: tx.time })
      tx.emit(
        'TOOL_STARTED',
        `Started tool ${execution.toolId}.`,
        execution.agentId,
        execution.taskId,
        payload(execution),
      )
      return
    case 'completeToolExecution': {
      ensure(
        execution.status === 'running',
        'INVALID_TRANSITION',
        'Only a running tool can complete.',
      )
      const output = publicToolJson(command.output)
      patch(tx, execution, {
        status: 'completed',
        completedAt: tx.time,
        output,
        error: null,
      })
      tx.emit(
        'TOOL_COMPLETED',
        `Completed tool ${execution.toolId}; task completion remains explicit.`,
        execution.agentId,
        execution.taskId,
        payload(execution),
      )
      return
    }
    case 'failToolExecution':
      fail(
        tx,
        execution,
        toolId(command.error.code),
        safeText(command.error.message, 'Tool error'),
      )
      return
    case 'cancelToolExecution':
      cancelLiveToolExecutions(
        tx,
        (item) => item.executionId === execution.executionId,
        command.reason,
        true,
      )
      return
  }
}
