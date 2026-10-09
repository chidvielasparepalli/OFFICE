import {
  eligibleAgents,
  meetsCapabilities,
} from '../orchestration/capabilityMatcher'
import { validatePlanProposal } from '../orchestration/planValidation'
import { hasLiveToolExecution } from './toolRuntime'
import type {
  ExecutionPlan,
  ManagerRequest,
  OrchestrationCommand,
  OrchestrationIssue,
  PlanStatus,
  RequestStatus,
} from '../orchestration/orchestrationTypes'
import type {
  RuntimeAgent,
  RuntimeCommand,
  RuntimeEventType,
  RuntimeJson,
  RuntimeState,
  RuntimeTask,
} from './runtimeTypes'

/** A view of the existing transaction, not another store or publication boundary. */
export interface OrchestrationTransaction {
  state: RuntimeState
  readonly time: string
  id(scope: string): string
  agent(id: string): Readonly<RuntimeAgent>
  task(id: string): Readonly<RuntimeTask>
  apply(command: RuntimeCommand): void
  emit(
    type: RuntimeEventType,
    summary: string,
    agentId?: string | null,
    taskId?: string | null,
    payload?: Readonly<Record<string, RuntimeJson>>,
  ): void
}

export class OrchestrationFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function ensure(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new OrchestrationFault(code, message)
}

const terminalTask = (task: RuntimeTask) =>
  ['completed', 'failed', 'cancelled'].includes(task.status)
const commandTypes = new Set([
  'receiveRequest',
  'beginPlanning',
  'acceptPlan',
  'rejectPlan',
  'dispatchPlanTask',
  'recordDispatchIssue',
  'synchronizePlan',
  'cancelRequest',
])
export function isOrchestrationCommand(
  command: RuntimeCommand,
): command is OrchestrationCommand {
  return commandTypes.has(command.type)
}

function nonempty(value: unknown, label: string): asserts value is string {
  ensure(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_INPUT',
    `${label} must be nonempty text.`,
  )
}

function validId(value: unknown, label: string): asserts value is string {
  nonempty(value, label)
  ensure(
    !['__proto__', 'constructor', 'prototype'].includes(value) &&
      ![...value].some(
        (character) =>
          character.trim() === '' ||
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127,
      ),
    'INVALID_INPUT',
    `${label} is invalid.`,
  )
}

function manager(tx: OrchestrationTransaction, managerId: string) {
  const agent = tx.agent(managerId)
  ensure(
    agent.kind === 'manager',
    'INVALID_MANAGER',
    'A request must be owned by a registered Manager.',
  )
  return agent
}

function ownedRequest(
  tx: OrchestrationTransaction,
  managerId: string,
  requestId: string,
) {
  manager(tx, managerId)
  validId(requestId, 'Request ID')
  ensure(
    Object.hasOwn(tx.state.requests, requestId),
    'NOT_FOUND',
    `Request ${requestId} does not exist.`,
  )
  const request = tx.state.requests[requestId]
  ensure(
    request.managerId === managerId,
    'INVALID_OWNERSHIP',
    'This Manager does not own the request.',
  )
  return request
}

function ownedPlan(
  tx: OrchestrationTransaction,
  managerId: string,
  planId: string,
) {
  validId(planId, 'Plan ID')
  ensure(
    Object.hasOwn(tx.state.plans, planId),
    'NOT_FOUND',
    `Plan ${planId} does not exist.`,
  )
  const plan = tx.state.plans[planId]
  const request = ownedRequest(tx, managerId, plan.requestId)
  ensure(
    plan.managerId === managerId && request.planId === planId,
    'INVALID_OWNERSHIP',
    'The plan does not belong to this Manager request.',
  )
  return { plan, request }
}

function requestPatch(
  tx: OrchestrationTransaction,
  request: ManagerRequest,
  patch: Partial<ManagerRequest>,
) {
  tx.state = {
    ...tx.state,
    requests: {
      ...tx.state.requests,
      [request.requestId]: { ...request, ...patch, updatedAt: tx.time },
    },
  }
}

function planPatch(
  tx: OrchestrationTransaction,
  plan: ExecutionPlan,
  patch: Partial<ExecutionPlan>,
) {
  tx.state = {
    ...tx.state,
    plans: {
      ...tx.state.plans,
      [plan.planId]: { ...plan, ...patch, updatedAt: tx.time },
    },
  }
}

function liveAttempt(
  tx: OrchestrationTransaction,
  command: Extract<OrchestrationCommand, { type: 'acceptPlan' | 'rejectPlan' }>,
) {
  const request = ownedRequest(tx, command.managerId, command.requestId)
  ensure(
    request.status === 'planning' &&
      request.planningAttemptId === command.attemptId &&
      request.coordinationTaskId !== null &&
      request.planId === null,
    'STALE_PLANNING_ATTEMPT',
    'The proposal no longer matches an active planning attempt.',
  )
  return request
}

function ownedTask(
  tx: OrchestrationTransaction,
  plan: ExecutionPlan,
  taskId: string,
) {
  ensure(
    plan.taskIds.includes(taskId) && Object.hasOwn(plan.requirements, taskId),
    'INVALID_ASSIGNMENT',
    'Task is not a body task of this plan.',
  )
  const task = tx.task(taskId)
  ensure(
    task.metadata.requestId === plan.requestId &&
      task.metadata.planId === plan.planId,
    'INVALID_OWNERSHIP',
    'Task ownership does not match the accepted plan.',
  )
  return task
}

function sameIssues(
  a: readonly OrchestrationIssue[],
  b: readonly OrchestrationIssue[],
) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const derivedCodes = new Set([
  'TASK_MISSING',
  'TASK_FAILED',
  'TASK_CANCELLED',
  'TASK_BLOCKED',
  'TASK_WAITING',
  'TASK_AGENT_UNAVAILABLE',
  'COORDINATION_UNAVAILABLE',
  'INVALID_ASSIGNMENT',
  'INVALID_DEPENDENCY',
])

function synchronize(
  tx: OrchestrationTransaction,
  managerId: string,
  planId: string,
  addedIssue?: OrchestrationIssue,
) {
  const { plan, request } = ownedPlan(tx, managerId, planId)
  if (plan.status === 'completed' || plan.status === 'cancelled') return
  const tasks = plan.taskIds.map((id) => tx.state.tasks[id])
  const issues: OrchestrationIssue[] = []
  const add = (
    code: string,
    message: string,
    taskId: string | null,
    agentId: string | null,
  ) => {
    const issue = { code, message, taskId, agentId }
    if (
      !issues.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(issue),
      )
    )
      issues.push(issue)
  }
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    if (!task) {
      add(
        'TASK_MISSING',
        `Plan task ${plan.taskIds[index]} is missing.`,
        plan.taskIds[index],
        null,
      )
      continue
    }
    if (task.dependencyIds.some((id) => !plan.taskIds.includes(id)))
      add(
        'INVALID_DEPENDENCY',
        `Task ${task.id} has dependencies outside its accepted plan.`,
        task.id,
        task.assignedAgentId,
      )
    if (['failed', 'cancelled', 'blocked'].includes(task.status))
      add(
        `TASK_${task.status.toUpperCase()}`,
        task.statusReason ?? `Task ${task.id} is ${task.status}.`,
        task.id,
        task.assignedAgentId,
      )
    else if (task.status === 'waiting' && !task.waitingForDependencies)
      add(
        'TASK_WAITING',
        task.statusReason ?? `Task ${task.id} is manually waiting.`,
        task.id,
        task.assignedAgentId,
      )
    if (task.assignedAgentId) {
      const agent = tx.state.agents[task.assignedAgentId]
      const requirements = plan.requirements[task.id]
      if (
        !agent ||
        !requirements ||
        !meetsCapabilities(agent, requirements, managerId) ||
        (!terminalTask(task) && agent.currentTaskId !== task.id)
      )
        add(
          'INVALID_ASSIGNMENT',
          `Task ${task.id} is assigned outside its capability, ownership or current-task contract.`,
          task.id,
          task.assignedAgentId,
        )
      if (
        !terminalTask(task) &&
        (!agent || agent.status === 'blocked' || agent.status === 'repair')
      )
        add(
          'TASK_AGENT_UNAVAILABLE',
          `Assigned agent ${task.assignedAgentId} is unavailable.`,
          task.id,
          task.assignedAgentId,
        )
    }
  }
  const coordination = request.coordinationTaskId
    ? tx.state.tasks[request.coordinationTaskId]
    : undefined
  const owner = manager(tx, managerId)
  const coordinating =
    coordination?.status === 'in_progress' &&
    coordination.assignedAgentId === managerId &&
    owner.currentTaskId === coordination.id &&
    owner.status !== 'blocked' &&
    owner.status !== 'repair'
  if (!coordinating)
    add(
      'COORDINATION_UNAVAILABLE',
      'The Manager coordination task is not available; explicit recovery or cancellation is required.',
      request.coordinationTaskId,
      managerId,
    )
  for (const issue of [...plan.issues, ...(addedIssue ? [addedIssue] : [])]) {
    if (derivedCodes.has(issue.code) && issue !== addedIssue) continue
    if (issue.taskId) {
      const task = tx.state.tasks[issue.taskId]
      if (!task || task.status !== 'queued' || task.assignedAgentId !== null)
        continue
      if (
        issue.code === 'AGENT_UNAVAILABLE' &&
        eligibleAgents(tx.state, plan.requirements[task.id], managerId).length >
          0
      )
        continue
    }
    add(issue.code, issue.message, issue.taskId, issue.agentId)
  }
  let status: PlanStatus
  let requestStatus: RequestStatus
  if (issues.length) {
    status = 'needs_attention'
    requestStatus = 'blocked'
  } else if (
    tasks.length > 0 &&
    tasks.every((task) => task?.status === 'completed') &&
    coordinating &&
    !hasLiveToolExecution(tx.state, { taskId: coordination.id })
  ) {
    tx.apply({ type: 'completeTask', taskId: coordination.id })
    status = 'completed'
    requestStatus = 'completed'
  } else if (
    tasks.some(
      (task) =>
        task && (task.startedAt !== null || task.assignedAgentId !== null),
    )
  ) {
    status = 'executing'
    requestStatus = 'executing'
  } else {
    status = 'planned'
    requestStatus = 'planned'
  }
  if (
    status === plan.status &&
    requestStatus === request.status &&
    sameIssues(plan.issues, issues) &&
    sameIssues(request.issues, issues)
  )
    return
  planPatch(tx, plan, { status, issues })
  requestPatch(tx, request, { status: requestStatus, issues })
  tx.emit(
    'PLAN_STATUS_CHANGED',
    `Plan ${plan.planId} is ${status}.`,
    managerId,
    request.coordinationTaskId,
    { requestId: request.requestId, planId, status },
  )
}

/** A disconnected planner response can never become a live plan after reconnect. */
export function invalidatePlanningOnDisconnect(tx: OrchestrationTransaction) {
  for (const request of Object.values(tx.state.requests)) {
    if (request.status !== 'planning') continue
    if (request.coordinationTaskId) {
      const task = tx.task(request.coordinationTaskId)
      if (!terminalTask(task))
        tx.apply({
          type: 'cancelTask',
          taskId: task.id,
          reason: 'Disconnected while planning.',
        })
    }
    const issue: OrchestrationIssue = {
      code: 'CONNECTION_LOST',
      message:
        'Planning was interrupted by disconnect. Reconnect and explicitly retry.',
      taskId: request.coordinationTaskId,
      agentId: request.managerId,
    }
    requestPatch(tx, request, {
      status: 'blocked',
      planningAttemptId: null,
      issues: [issue],
    })
    tx.emit(
      'PLAN_REJECTED',
      `Planning for ${request.requestId} stopped on disconnect.`,
      request.managerId,
      request.coordinationTaskId,
      {
        requestId: request.requestId,
        attemptId: request.planningAttemptId,
        code: issue.code,
      },
    )
  }
}

export function applyOrchestrationCommand(
  tx: OrchestrationTransaction,
  command: OrchestrationCommand,
) {
  switch (command.type) {
    case 'receiveRequest': {
      manager(tx, command.managerId)
      const input = command.request
      validId(input.requestId, 'Request ID')
      nonempty(input.title, 'Request title')
      nonempty(input.description, 'Request description')
      nonempty(input.requestedBy, 'Requested by')
      ensure(
        !Object.hasOwn(tx.state.requests, input.requestId) &&
          !Object.hasOwn(tx.state.plans, input.requestId) &&
          !Object.hasOwn(tx.state.tasks, input.requestId),
        'DUPLICATE_ID',
        'Request ID already exists.',
      )
      ensure(
        ['low', 'normal', 'high', 'urgent'].includes(input.priority),
        'INVALID_INPUT',
        'Request priority is unknown.',
      )
      ensure(
        Array.isArray(input.constraints),
        'INVALID_INPUT',
        'Request constraints must be an array.',
      )
      for (const constraint of input.constraints)
        nonempty(constraint, 'Constraint')
      const request: ManagerRequest = {
        requestId: input.requestId,
        title: input.title,
        description: input.description,
        requestedBy: input.requestedBy,
        priority: input.priority,
        constraints: [...input.constraints],
        managerId: command.managerId,
        status: 'received',
        planId: null,
        planningAttemptId: null,
        coordinationTaskId: null,
        issues: [],
        createdAt: tx.time,
        updatedAt: tx.time,
      }
      tx.state = {
        ...tx.state,
        requests: { ...tx.state.requests, [request.requestId]: request },
      }
      tx.emit(
        'REQUEST_RECEIVED',
        `Manager received ${request.title}.`,
        command.managerId,
        null,
        { requestId: request.requestId },
      )
      return
    }
    case 'beginPlanning': {
      const request = ownedRequest(tx, command.managerId, command.requestId)
      ensure(
        ['received', 'blocked', 'failed'].includes(request.status) &&
          request.planId === null,
        'INVALID_TRANSITION',
        'This request cannot begin a new planning attempt.',
      )
      const owner = manager(tx, command.managerId)
      ensure(
        !Object.values(tx.state.requests).some(
          (other) =>
            other.requestId !== request.requestId &&
            other.managerId === command.managerId &&
            (other.status === 'planning' ||
              (other.planId !== null &&
                ['planned', 'executing', 'needs_attention'].includes(
                  tx.state.plans[other.planId]?.status ?? '',
                ))),
        ),
        'MANAGER_BUSY',
        'Manager still owns an active request; complete or cancel it before planning another.',
      )
      ensure(
        !['working', 'walking', 'collaborating', 'blocked', 'repair'].includes(
          owner.status,
        ) &&
          (owner.currentTaskId === null ||
            terminalTask(tx.task(owner.currentTaskId))),
        'MANAGER_BUSY',
        'Manager must be available before planning another request.',
      )
      const attemptId = tx.id('planning')
      const coordinationTaskId = tx.id('coordination')
      tx.apply({
        type: 'createTask',
        task: {
          id: coordinationTaskId,
          title: `Coordinate: ${request.title}`,
          description: request.description,
          priority: request.priority,
          metadata: { requestId: request.requestId, coordination: true },
        },
      })
      tx.apply({
        type: 'assignTask',
        taskId: coordinationTaskId,
        agentId: owner.id,
      })
      tx.apply({ type: 'startTask', taskId: coordinationTaskId })
      requestPatch(tx, request, {
        status: 'planning',
        planningAttemptId: attemptId,
        coordinationTaskId,
        issues: [],
      })
      tx.emit(
        'PLANNING_STARTED',
        `${owner.name} began planning ${request.title}.`,
        owner.id,
        coordinationTaskId,
        { requestId: request.requestId, attemptId },
      )
      return
    }
    case 'acceptPlan': {
      const request = liveAttempt(tx, command)
      const owner = manager(tx, command.managerId)
      const coordination = tx.task(request.coordinationTaskId!)
      ensure(
        coordination.status === 'in_progress' &&
          owner.currentTaskId === coordination.id &&
          owner.status !== 'blocked' &&
          owner.status !== 'repair',
        'PLANNING_INTERRUPTED',
        'Manager coordination was interrupted before the proposal arrived.',
      )
      const validated = validatePlanProposal(
        command.proposal,
        request,
        tx.state,
      )
      if (!validated.ok)
        throw new OrchestrationFault(
          validated.error.code,
          validated.error.message,
        )
      const proposal = validated.proposal
      const requirements: Record<
        string,
        ExecutionPlan['requirements'][string]
      > = {}
      for (const task of proposal.tasks) {
        tx.apply({
          type: 'createTask',
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            dependencyIds: task.dependencyIds,
            parentTaskId: coordination.id,
            metadata: { requestId: request.requestId, planId: proposal.planId },
          },
        })
        requirements[task.id] = {
          capabilities: [...task.requiredCapabilities],
          preferredAgentId: task.preferredAgentId,
        }
      }
      const plan: ExecutionPlan = {
        planId: proposal.planId,
        requestId: request.requestId,
        managerId: command.managerId,
        objective: proposal.objective,
        taskIds: proposal.tasks.map((task) => task.id),
        requirements,
        constraints: [...proposal.constraints],
        expectedOutputs: [...proposal.expectedOutputs],
        status: 'planned',
        issues: [],
        createdAt: tx.time,
        updatedAt: tx.time,
      }
      tx.state = {
        ...tx.state,
        plans: { ...tx.state.plans, [plan.planId]: plan },
      }
      requestPatch(tx, request, {
        status: 'planned',
        planId: plan.planId,
        planningAttemptId: null,
        issues: [],
      })
      tx.emit(
        'PLAN_ACCEPTED',
        `Accepted plan ${plan.planId} with ${plan.taskIds.length} tasks.`,
        command.managerId,
        coordination.id,
        {
          requestId: request.requestId,
          planId: plan.planId,
          attemptId: command.attemptId,
          taskIds: [...plan.taskIds],
        },
      )
      return
    }
    case 'rejectPlan': {
      const request = liveAttempt(tx, command)
      nonempty(command.reason, 'Plan rejection reason')
      const task = tx.task(request.coordinationTaskId!)
      if (!terminalTask(task))
        tx.apply({ type: 'failTask', taskId: task.id, reason: command.reason })
      const issue: OrchestrationIssue = {
        code: 'PLAN_REJECTED',
        message: command.reason,
        taskId: task.id,
        agentId: command.managerId,
      }
      requestPatch(tx, request, {
        status: 'failed',
        planningAttemptId: null,
        issues: [issue],
      })
      tx.emit(
        'PLAN_REJECTED',
        `Rejected planning result for ${request.title}: ${command.reason}`,
        command.managerId,
        task.id,
        {
          requestId: request.requestId,
          attemptId: command.attemptId,
          reason: command.reason,
        },
      )
      return
    }
    case 'dispatchPlanTask': {
      const { plan, request } = ownedPlan(tx, command.managerId, command.planId)
      ensure(
        !['completed', 'failed', 'cancelled'].includes(plan.status),
        'INVALID_TRANSITION',
        'A terminal plan cannot dispatch tasks.',
      )
      const owner = manager(tx, command.managerId)
      const coordination = request.coordinationTaskId
        ? tx.state.tasks[request.coordinationTaskId]
        : undefined
      ensure(
        coordination?.status === 'in_progress' &&
          owner.currentTaskId === coordination.id &&
          owner.status !== 'blocked' &&
          owner.status !== 'repair',
        'MANAGER_UNAVAILABLE',
        'Manager coordination must be active before dispatching work.',
      )
      const task = ownedTask(tx, plan, command.taskId)
      ensure(
        task.dependencyIds.every((id) => plan.taskIds.includes(id)),
        'INVALID_DEPENDENCY',
        'A plan task cannot dispatch with dependencies outside its accepted plan.',
      )
      ensure(
        task.status === 'queued' &&
          task.assignedAgentId === null &&
          task.dependencyIds.every((id) => tx.task(id).status === 'completed'),
        'TASK_NOT_READY',
        'Only unassigned queued tasks with completed dependencies can dispatch.',
      )
      const agent = tx.agent(command.agentId)
      ensure(
        meetsCapabilities(agent, plan.requirements[task.id], command.managerId),
        'INVALID_ASSIGNMENT',
        'Selected worker does not meet the task capabilities, preference or ownership requirements.',
      )
      ensure(
        eligibleAgents(
          tx.state,
          plan.requirements[task.id],
          command.managerId,
        ).some((candidate) => candidate.id === agent.id),
        'AGENT_UNAVAILABLE',
        'Selected worker is unavailable.',
      )
      tx.apply({ type: 'assignTask', taskId: task.id, agentId: agent.id })
      tx.apply({ type: 'startTask', taskId: task.id })
      tx.emit(
        'PLAN_DISPATCHED',
        `Manager dispatched ${task.title} to ${agent.name}.`,
        command.managerId,
        task.id,
        {
          requestId: request.requestId,
          planId: plan.planId,
          agentId: agent.id,
        },
      )
      synchronize(tx, command.managerId, plan.planId)
      return
    }
    case 'recordDispatchIssue': {
      const { plan } = ownedPlan(tx, command.managerId, command.planId)
      nonempty(command.issue.code, 'Issue code')
      nonempty(command.issue.message, 'Issue message')
      if (command.issue.taskId !== null)
        ownedTask(tx, plan, command.issue.taskId)
      if (command.issue.agentId !== null) tx.agent(command.issue.agentId)
      synchronize(tx, command.managerId, command.planId, {
        code: command.issue.code,
        message: command.issue.message,
        taskId: command.issue.taskId,
        agentId: command.issue.agentId,
      })
      return
    }
    case 'synchronizePlan': {
      synchronize(tx, command.managerId, command.planId)
      return
    }
    case 'cancelRequest': {
      const request = ownedRequest(tx, command.managerId, command.requestId)
      nonempty(command.reason, 'Cancellation reason')
      ensure(
        request.status !== 'completed',
        'INVALID_TRANSITION',
        'A completed request cannot be cancelled.',
      )
      if (request.status === 'cancelled') return
      const plan = request.planId ? tx.state.plans[request.planId] : undefined
      const ids = [
        ...(plan?.taskIds ?? []),
        ...(request.coordinationTaskId ? [request.coordinationTaskId] : []),
      ]
      for (const id of ids) {
        const task = tx.task(id)
        if (plan && plan.taskIds.includes(id)) ownedTask(tx, plan, id)
        if (!terminalTask(task))
          tx.apply({ type: 'cancelTask', taskId: id, reason: command.reason })
      }
      const issue: OrchestrationIssue = {
        code: 'REQUEST_CANCELLED',
        message: command.reason,
        taskId: null,
        agentId: command.managerId,
      }
      if (plan) planPatch(tx, plan, { status: 'cancelled', issues: [issue] })
      requestPatch(tx, request, {
        status: 'cancelled',
        planningAttemptId: null,
        issues: [issue],
      })
      tx.emit(
        'REQUEST_CANCELLED',
        `Cancelled ${request.title}: ${command.reason}`,
        command.managerId,
        request.coordinationTaskId,
        {
          requestId: request.requestId,
          planId: request.planId,
          reason: command.reason,
        },
      )
      return
    }
  }
}
