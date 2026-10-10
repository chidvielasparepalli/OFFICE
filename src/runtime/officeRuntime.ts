import type { OfficeAgentStatus, WorldPosition } from '../office/officeState'
import { ToolFault } from '../tools/toolTypes'
import { MemoryFault, type MemoryPolicy } from '../memory/memoryTypes'
import { copyMemoryPolicy } from '../memory/memoryPolicy'
import {
  applyMemoryRuntimeCommand,
  isMemoryRuntimeCommand,
} from './memoryRuntime'
import {
  applyOrchestrationCommand,
  invalidatePlanningOnDisconnect,
  isOrchestrationCommand,
  OrchestrationFault,
} from './orchestrationRuntime'
import {
  applyToolRuntimeCommand,
  cancelLiveToolExecutions,
  hasLiveToolExecution,
  isToolRuntimeCommand,
} from './toolRuntime'
import type {
  AgentSpatialIntent,
  OfficeRuntimeOptions,
  OfficeRuntimeRepository,
  RuntimeAgent,
  RuntimeBusinessChanges,
  RuntimeCommand,
  RuntimeEventType,
  RuntimeJson,
  RuntimeMetrics,
  RuntimeResult,
  RuntimeState,
  RuntimeTask,
  RuntimeTaskStatus,
} from './runtimeTypes'

const TERMINAL = new Set<RuntimeTaskStatus>([
  'completed',
  'failed',
  'cancelled',
])
const AGENT_STATUSES: readonly OfficeAgentStatus[] = [
  'sleeping',
  'queued',
  'working',
  'walking',
  'collaborating',
  'waiting',
  'completed',
  'blocked',
  'repair',
]

class RuntimeFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function requireCondition(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new RuntimeFault(code, message)
}

function text(value: unknown, label: string): asserts value is string {
  requireCondition(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_INPUT',
    `${label} must be a nonempty string.`,
  )
}

function identifier(value: unknown, label = 'ID'): asserts value is string {
  text(value, label)
  requireCondition(
    !['__proto__', 'prototype', 'constructor'].includes(value),
    'INVALID_INPUT',
    `${label} is reserved.`,
  )
}

function has<T>(record: Readonly<Record<string, T>>, id: string) {
  return Object.hasOwn(record, id)
}

function groundPose(position: WorldPosition, heading: number) {
  requireCondition(
    Array.isArray(position) &&
      position.length === 3 &&
      position.every(Number.isFinite) &&
      position[1] === 0 &&
      Number.isFinite(heading),
    'INVALID_POSE',
    'Position must be finite, grounded Y-up meters; heading must be finite radians.',
  )
}

function copyPosition(position: WorldPosition): WorldPosition {
  return [position[0], position[1], position[2]]
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

/** Copies command-owned metadata and rejects values that cannot be faithfully persisted. */
function copyJson(
  value: RuntimeJson,
  ancestors = new Set<object>(),
): RuntimeJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    requireCondition(
      Number.isFinite(value),
      'INVALID_INPUT',
      'Metadata numbers must be finite.',
    )
    return value
  }
  requireCondition(
    typeof value === 'object' && !ancestors.has(value),
    'INVALID_INPUT',
    'Metadata must be acyclic JSON.',
  )
  ancestors.add(value)
  let result: RuntimeJson
  if (Array.isArray(value))
    result = value.map((item) => copyJson(item, ancestors))
  else {
    requireCondition(
      Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null,
      'INVALID_INPUT',
      'Metadata must contain plain JSON objects.',
    )
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        copyJson(item, ancestors),
      ]),
    )
  }
  ancestors.delete(value)
  return result
}

export function createEmptyRuntimeState(): RuntimeState {
  return freeze({
    connection: 'disconnected',
    revision: 0,
    agents: {},
    tasks: {},
    workstations: {},
    departments: {},
    requests: {},
    plans: {},
    toolExecutions: {},
    memories: {},
    events: [],
    activities: [],
    selectedAgentId: null,
    selectedTaskId: null,
  })
}

export class InMemoryOfficeRuntimeRepository implements OfficeRuntimeRepository {
  private snapshot: RuntimeState | null
  constructor(initial: RuntimeState | null = null) {
    this.snapshot = initial === null ? null : freeze(structuredClone(initial))
  }
  read() {
    return this.snapshot
  }
  write(snapshot: RuntimeState) {
    this.snapshot = snapshot
  }
}

export function createInMemoryOfficeRuntimeRepository(
  initial: RuntimeState | null = null,
) {
  return new InMemoryOfficeRuntimeRepository(initial)
}

interface PendingEvent {
  type: RuntimeEventType
  summary: string
  agentId: string | null
  taskId: string | null
  payload: Readonly<Record<string, RuntimeJson>>
  checkpoint: RuntimeState
}

function changedRecords<T>(
  before: Readonly<Record<string, T>>,
  after: Readonly<Record<string, T>>,
) {
  if (before === after) return undefined
  const entries = Object.entries(after).filter(
    ([id, record]) => before[id] !== record,
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function businessChanges(
  before: RuntimeState,
  after: RuntimeState,
): RuntimeBusinessChanges {
  const agents = changedRecords(before.agents, after.agents)
  const tasks = changedRecords(before.tasks, after.tasks)
  const workstations = changedRecords(before.workstations, after.workstations)
  const departments = changedRecords(before.departments, after.departments)
  const requests = changedRecords(before.requests, after.requests)
  const plans = changedRecords(before.plans, after.plans)
  const toolExecutions = changedRecords(
    before.toolExecutions,
    after.toolExecutions,
  )
  const memories = changedRecords(before.memories, after.memories)
  return {
    ...(agents ? { agents } : {}),
    ...(tasks ? { tasks } : {}),
    ...(workstations ? { workstations } : {}),
    ...(departments ? { departments } : {}),
    ...(requests ? { requests } : {}),
    ...(plans ? { plans } : {}),
    ...(toolExecutions ? { toolExecutions } : {}),
    ...(memories ? { memories } : {}),
    ...(before.connection !== after.connection
      ? { connection: after.connection }
      : {}),
  }
}

class Transaction {
  state: RuntimeState
  readonly events: PendingEvent[] = []
  private timestamp: string | null = null
  private readonly generated = new Set<string>()
  private readonly now: () => string
  private readonly nextId: (scope: string) => string
  readonly memoryPolicy: MemoryPolicy
  constructor(
    state: RuntimeState,
    now: () => string,
    nextId: (scope: string) => string,
    memoryPolicy: MemoryPolicy,
  ) {
    this.state = state
    this.now = now
    this.nextId = nextId
    this.memoryPolicy = memoryPolicy
  }
  get time() {
    if (this.timestamp === null) {
      this.timestamp = this.now()
      requireCondition(
        typeof this.timestamp === 'string' &&
          Number.isFinite(Date.parse(this.timestamp)),
        'INVALID_CLOCK',
        'The injected clock must return a valid timestamp.',
      )
    }
    return this.timestamp
  }
  id(scope: string) {
    const id = this.nextId(scope)
    identifier(id, 'Generated ID')
    const occupied =
      this.generated.has(id) ||
      has(this.state.tasks, id) ||
      has(this.state.agents, id) ||
      has(this.state.toolExecutions, id) ||
      has(this.state.memories, id) ||
      orchestrationIdUsed(this.state, id) ||
      this.state.events.some((event) => event.id === id) ||
      intentUsed(this.state, id)
    requireCondition(
      !occupied,
      'DUPLICATE_ID',
      `Generated ID ${id} already exists.`,
    )
    this.generated.add(id)
    return id
  }
  agent(id: string) {
    identifier(id, 'Agent ID')
    requireCondition(
      has(this.state.agents, id),
      'NOT_FOUND',
      `Agent ${id} does not exist.`,
    )
    return this.state.agents[id]
  }
  task(id: string) {
    identifier(id, 'Task ID')
    requireCondition(
      has(this.state.tasks, id),
      'NOT_FOUND',
      `Task ${id} does not exist.`,
    )
    return this.state.tasks[id]
  }
  agentPatch(
    id: string,
    patch: Partial<RuntimeAgent>,
    recoverFromRepair = false,
  ) {
    const current = this.agent(id)
    // Task readiness and spatial feedback cannot acknowledge an active repair.
    // Only repairAgent explicitly permits recovery and clears its stated blockers.
    const changes =
      current.status === 'repair' && !recoverFromRepair
        ? { ...patch, status: 'repair' as const, blockers: current.blockers }
        : patch
    this.state = {
      ...this.state,
      agents: {
        ...this.state.agents,
        [id]: { ...current, ...changes, updatedAt: this.time },
      },
    }
  }
  taskPatch(id: string, patch: Partial<RuntimeTask>) {
    // Invalidate execution authority before a pause/terminal transition publishes.
    // Host subscribers abort side effects; late callbacks cannot resume old work.
    if (patch.status !== undefined && patch.status !== 'in_progress')
      cancelLiveToolExecutions(
        this,
        (execution) => execution.taskId === id,
        `Task changed to ${patch.status}.`,
      )
    this.state = {
      ...this.state,
      tasks: {
        ...this.state.tasks,
        [id]: { ...this.task(id), ...patch, updatedAt: this.time },
      },
    }
  }
  apply(command: RuntimeCommand) {
    applyCommand(this, command)
  }
  emit(
    type: RuntimeEventType,
    summary: string,
    agentId: string | null = null,
    taskId: string | null = null,
    payload: Readonly<Record<string, RuntimeJson>> = {},
  ) {
    this.events.push({
      type,
      summary,
      agentId,
      taskId,
      payload,
      checkpoint: this.state,
    })
  }
  finish(previous: RuntimeState): RuntimeState {
    if (this.state === previous && this.events.length === 0) return previous
    let checkpoint = previous
    const events = this.events.map(
      ({ summary: _summary, checkpoint: emittedState, ...event }, index) => {
        // The last event includes any final dependency reconciliation after emit().
        const after =
          index === this.events.length - 1 ? this.state : emittedState
        const changes = businessChanges(checkpoint, after)
        checkpoint = after
        return {
          ...event,
          id: this.id('event'),
          occurredAt: this.time,
          changes,
          transactionRevision: previous.revision + 1,
          transactionEventIndex: index,
          transactionEventCount: this.events.length,
        }
      },
    )
    const activities = events.map((event, index) => ({
      id: `activity:${event.id}`,
      eventId: event.id,
      occurredAt: event.occurredAt,
      agentId: event.agentId,
      taskId: event.taskId,
      summary: this.events[index].summary,
    }))
    return freeze({
      ...this.state,
      revision: previous.revision + 1,
      events: events.length ? [...previous.events, ...events] : previous.events,
      activities: activities.length
        ? [...previous.activities, ...activities]
        : previous.activities,
    })
  }
}

function nonterminal(task: RuntimeTask) {
  requireCondition(
    !TERMINAL.has(task.status),
    'INVALID_TRANSITION',
    `Task ${task.id} is already ${task.status}.`,
  )
}

function currentAgent(tx: Transaction, task: RuntimeTask) {
  requireCondition(
    task.assignedAgentId !== null,
    'UNASSIGNED_TASK',
    `Task ${task.id} has no assigned agent.`,
  )
  const agent = tx.agent(task.assignedAgentId)
  requireCondition(
    agent.currentTaskId === task.id,
    'INVALID_ASSIGNMENT',
    `Task ${task.id} is not ${agent.id}'s current task.`,
  )
  return agent
}

function dependencyReason(tx: Transaction, task: RuntimeTask) {
  const pending = task.dependencyIds
    .map((id) => tx.task(id))
    .filter((dependency) => dependency.status !== 'completed')
  return pending.length
    ? `Waiting for dependencies: ${pending.map((dependency) => `${dependency.id} (${dependency.status})`).join(', ')}.`
    : null
}

function validateDependencies(
  tx: Transaction,
  taskId: string,
  ids: readonly string[],
) {
  requireCondition(
    Array.isArray(ids),
    'INVALID_DEPENDENCY',
    'Dependencies must be an array of task IDs.',
  )
  requireCondition(
    new Set(ids).size === ids.length,
    'INVALID_DEPENDENCY',
    'Dependencies must not contain duplicate IDs.',
  )
  for (const id of ids) {
    requireCondition(
      id !== taskId,
      'DEPENDENCY_CYCLE',
      'A task cannot depend on itself.',
    )
    tx.task(id)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string) {
    requireCondition(
      !visiting.has(id),
      'DEPENDENCY_CYCLE',
      'Task dependencies must not form a cycle.',
    )
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of id === taskId ? ids : tx.task(id).dependencyIds)
      visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  visit(taskId)
}

/** Dependency release changes readiness, never starts work. Manual pauses remain paused. */
function reconcileDependencies(tx: Transaction) {
  const visited = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    let task = tx.task(id)
    for (const dependency of task.dependencyIds) visit(dependency)
    task = tx.task(id)
    if (TERMINAL.has(task.status)) return
    const reason = dependencyReason(tx, task)
    if (
      reason !== null &&
      task.status !== 'blocked' &&
      (task.status !== 'waiting' || task.waitingForDependencies)
    ) {
      if (task.status === 'waiting' && task.statusReason === reason) return
      tx.taskPatch(id, {
        status: 'waiting',
        statusReason: reason,
        waitingForDependencies: true,
      })
      if (task.assignedAgentId !== null) {
        const agent = currentAgent(tx, task)
        tx.agentPatch(agent.id, {
          status: 'waiting',
          blockers: [reason],
          destination: null,
          collaboratorIds: [],
        })
        tx.emit(
          'AGENT_WAITING',
          `${agent.name} is waiting for task dependencies.`,
          agent.id,
          task.id,
          { reason },
        )
      }
    } else if (reason === null && task.waitingForDependencies) {
      const status = task.assignedAgentId ? 'assigned' : 'queued'
      tx.taskPatch(id, {
        status,
        statusReason: null,
        waitingForDependencies: false,
      })
      if (task.assignedAgentId !== null) {
        const agent = currentAgent(tx, task)
        tx.agentPatch(agent.id, { status: 'queued', blockers: [] })
      }
      tx.emit(
        'TASK_READY',
        `${task.title} has completed prerequisites and is ${status}.`,
        task.assignedAgentId,
        id,
        { status },
      )
    }
  }
  for (const id of Object.keys(tx.state.tasks)) visit(id)
}

function intentUsed(state: RuntimeState, id: string) {
  return (
    Object.values(state.agents).some((agent) => agent.destination?.id === id) ||
    state.events.some((event) => event.payload.intentId === id)
  )
}

function orchestrationIdUsed(state: RuntimeState, id: string) {
  return (
    has(state.requests, id) ||
    has(state.plans, id) ||
    Object.values(state.requests).some(
      (request) => request.planningAttemptId === id,
    ) ||
    state.events.some((event) => event.payload.attemptId === id)
  )
}

function collaborators(
  tx: Transaction,
  agentId: string,
  ids: readonly string[],
) {
  requireCondition(
    Array.isArray(ids) && new Set(ids).size === ids.length,
    'INVALID_INPUT',
    'Collaborators must be unique agent IDs.',
  )
  for (const id of ids) {
    requireCondition(
      id !== agentId,
      'INVALID_INPUT',
      'An agent cannot collaborate with itself.',
    )
    tx.agent(id)
  }
  return [...ids]
}

function requireWorkingArrival(
  tx: Transaction,
  agent: RuntimeAgent,
  destination: Pick<AgentSpatialIntent, 'destinationType' | 'destinationId'>,
) {
  requireCondition(
    agent.currentTaskId !== null &&
      tx.task(agent.currentTaskId).status === 'in_progress',
    'INVALID_TRANSITION',
    'Working requires an explicitly started current task.',
  )
  requireCondition(
    agent.workstationId !== null &&
      destination.destinationType === 'workstation' &&
      destination.destinationId === agent.workstationId,
    'INVALID_DESTINATION',
    "Working movement must arrive at the agent's assigned workstation.",
  )
}

function applyCommand(tx: Transaction, command: RuntimeCommand) {
  if (command.type === 'connect' || command.type === 'disconnect') {
    const connection = command.type === 'connect' ? 'local' : 'disconnected'
    if (tx.state.connection === connection) return
    if (command.type === 'disconnect') {
      cancelLiveToolExecutions(tx, () => true, 'Runtime disconnected.', true)
      invalidatePlanningOnDisconnect(tx)
    }
    tx.state = { ...tx.state, connection }
    tx.emit(
      command.type === 'connect' ? 'RUNTIME_CONNECTED' : 'RUNTIME_DISCONNECTED',
      `Local runtime ${command.type === 'connect' ? 'connected' : 'disconnected'}.`,
    )
    return
  }
  if (command.type === 'selectAgent') {
    if (command.agentId !== null) tx.agent(command.agentId)
    if (tx.state.selectedAgentId !== command.agentId)
      tx.state = { ...tx.state, selectedAgentId: command.agentId }
    return
  }
  if (command.type === 'selectTask') {
    if (command.taskId !== null) tx.task(command.taskId)
    if (tx.state.selectedTaskId !== command.taskId)
      tx.state = { ...tx.state, selectedTaskId: command.taskId }
    return
  }
  requireCondition(
    tx.state.connection === 'local',
    'DISCONNECTED',
    'Connect the local runtime before issuing commands.',
  )
  if (isOrchestrationCommand(command)) {
    applyOrchestrationCommand(tx, command)
    return
  }
  if (isToolRuntimeCommand(command)) {
    applyToolRuntimeCommand(tx, command)
    return
  }
  if (isMemoryRuntimeCommand(command)) {
    applyMemoryRuntimeCommand(tx, tx.memoryPolicy, command)
    return
  }
  switch (command.type) {
    case 'registerDepartment': {
      const input = command.department
      identifier(input.id, 'Department ID')
      text(input.name, 'Department name')
      requireCondition(
        !has(tx.state.departments, input.id),
        'DUPLICATE_ID',
        `Department ${input.id} already exists.`,
      )
      requireCondition(
        input.description == null || typeof input.description === 'string',
        'INVALID_INPUT',
        'Department description must be text.',
      )
      tx.state = {
        ...tx.state,
        departments: {
          ...tx.state.departments,
          [input.id]: {
            id: input.id,
            name: input.name,
            description: input.description ?? null,
          },
        },
      }
      tx.emit(
        'DEPARTMENT_REGISTERED',
        `Registered department ${input.name}.`,
        null,
        null,
        { departmentId: input.id },
      )
      return
    }
    case 'registerWorkstation': {
      const input = command.workstation
      identifier(input.id, 'Workstation ID')
      groundPose(input.position, input.headingRadians)
      requireCondition(
        !has(tx.state.workstations, input.id),
        'DUPLICATE_ID',
        `Workstation ${input.id} already exists.`,
      )
      if (input.departmentId != null)
        requireCondition(
          has(tx.state.departments, input.departmentId),
          'NOT_FOUND',
          `Department ${input.departmentId} does not exist.`,
        )
      tx.state = {
        ...tx.state,
        workstations: {
          ...tx.state.workstations,
          [input.id]: {
            id: input.id,
            position: copyPosition(input.position),
            headingRadians: input.headingRadians,
            departmentId: input.departmentId ?? null,
          },
        },
      }
      tx.emit(
        'WORKSTATION_REGISTERED',
        `Registered workstation ${input.id}.`,
        null,
        null,
        { workstationId: input.id },
      )
      return
    }
    case 'registerAgent': {
      const input = command.agent
      identifier(input.id, 'Agent ID')
      text(input.name, 'Agent name')
      text(input.role, 'Agent role')
      groundPose(input.position, input.headingRadians)
      requireCondition(
        !has(tx.state.agents, input.id),
        'DUPLICATE_ID',
        `Agent ${input.id} already exists.`,
      )
      requireCondition(
        has(tx.state.departments, input.departmentId),
        'NOT_FOUND',
        `Department ${input.departmentId} does not exist.`,
      )
      requireCondition(
        input.kind === 'standard-worker' || input.kind === 'manager',
        'INVALID_INPUT',
        'Agent kind must be standard-worker or manager.',
      )
      const status = input.status ?? 'sleeping'
      requireCondition(
        AGENT_STATUSES.includes(status),
        'INVALID_INPUT',
        'Agent status is unknown.',
      )
      requireCondition(
        !['working', 'walking', 'collaborating'].includes(status),
        'INVALID_TRANSITION',
        'Register agents at rest; task and movement commands explicitly begin activity.',
      )
      if (input.workstationId != null) {
        requireCondition(
          has(tx.state.workstations, input.workstationId),
          'NOT_FOUND',
          `Workstation ${input.workstationId} does not exist.`,
        )
        requireCondition(
          !Object.values(tx.state.agents).some(
            (agent) => agent.workstationId === input.workstationId,
          ),
          'WORKSTATION_OCCUPIED',
          `Workstation ${input.workstationId} is already assigned.`,
        )
      }
      if (input.managerId != null)
        requireCondition(
          tx.agent(input.managerId).kind === 'manager',
          'INVALID_INPUT',
          'managerId must reference a registered Manager.',
        )
      const capabilities = input.capabilities ?? []
      requireCondition(
        Array.isArray(capabilities) &&
          new Set(capabilities).size === capabilities.length,
        'INVALID_INPUT',
        'Capabilities must be unique strings.',
      )
      for (const capability of capabilities) text(capability, 'Capability')
      const agent: RuntimeAgent = {
        id: input.id,
        name: input.name,
        role: input.role,
        departmentId: input.departmentId,
        kind: input.kind,
        capabilities: [...capabilities],
        status,
        workstationId: input.workstationId ?? null,
        managerId: input.managerId ?? null,
        currentTaskId: null,
        destination: null,
        collaboratorIds: [],
        blockers: [],
        position: copyPosition(input.position),
        headingRadians: input.headingRadians,
        createdAt: tx.time,
        updatedAt: tx.time,
      }
      tx.state = {
        ...tx.state,
        agents: { ...tx.state.agents, [agent.id]: agent },
      }
      tx.emit('AGENT_REGISTERED', `Registered ${agent.name}.`, agent.id, null, {
        kind: agent.kind,
      })
      return
    }
    case 'createTask': {
      const input = command.task
      text(input.title, 'Task title')
      const id = input.id ?? tx.id('task')
      identifier(id, 'Task ID')
      requireCondition(
        !has(tx.state.tasks, id),
        'DUPLICATE_ID',
        `Task ${id} already exists.`,
      )
      const dependencies = input.dependencyIds ?? []
      validateDependencies(tx, id, dependencies)
      const priority = input.priority ?? 'normal'
      requireCondition(
        ['low', 'normal', 'high', 'urgent'].includes(priority),
        'INVALID_INPUT',
        'Task priority is unknown.',
      )
      requireCondition(
        input.description === undefined ||
          typeof input.description === 'string',
        'INVALID_INPUT',
        'Task description must be text.',
      )
      if (input.parentTaskId != null) {
        requireCondition(
          input.parentTaskId !== id,
          'INVALID_INPUT',
          'A task cannot parent itself.',
        )
        tx.task(input.parentTaskId)
      }
      const metadata = copyJson(input.metadata ?? {})
      requireCondition(
        metadata !== null &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata),
        'INVALID_INPUT',
        'Task metadata must be a JSON object.',
      )
      const task: RuntimeTask = {
        id,
        title: input.title,
        description: input.description ?? '',
        status: 'queued',
        priority,
        progressPercent: 0,
        assignedAgentId: null,
        dependencyIds: [...dependencies],
        parentTaskId: input.parentTaskId ?? null,
        statusReason: null,
        waitingForDependencies: false,
        metadata: metadata as Readonly<Record<string, RuntimeJson>>,
        createdAt: tx.time,
        updatedAt: tx.time,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
      }
      const reason = dependencyReason(tx, task)
      tx.state = {
        ...tx.state,
        tasks: {
          ...tx.state.tasks,
          [id]: reason
            ? {
                ...task,
                status: 'waiting',
                statusReason: reason,
                waitingForDependencies: true,
              }
            : task,
        },
      }
      tx.emit('TASK_CREATED', `Created task ${task.title}.`, null, id, {
        dependencyIds: [...dependencies],
        priority,
      })
      return
    }
    case 'assignTask': {
      const task = tx.task(command.taskId)
      nonterminal(task)
      const agent = tx.agent(command.agentId)
      requireCondition(
        agent.status !== 'repair',
        'INVALID_TRANSITION',
        'Acknowledge repair before assigning another task.',
      )
      requireCondition(
        task.assignedAgentId === null,
        'INVALID_ASSIGNMENT',
        `Task ${task.id} already has an assignee.`,
      )
      requireCondition(
        agent.currentTaskId === null ||
          TERMINAL.has(tx.task(agent.currentTaskId).status),
        'AGENT_BUSY',
        `${agent.name} already owns a nonterminal task.`,
      )
      const reason = dependencyReason(tx, task)
      const held =
        task.status === 'blocked' ||
        (task.status === 'waiting' && !task.waitingForDependencies)
      const status = held ? task.status : reason ? 'waiting' : 'assigned'
      const statusReason = held ? task.statusReason : reason
      tx.taskPatch(task.id, {
        assignedAgentId: agent.id,
        status,
        statusReason,
        waitingForDependencies: !held && reason !== null,
      })
      tx.agentPatch(agent.id, {
        currentTaskId: task.id,
        status:
          status === 'blocked'
            ? 'blocked'
            : status === 'waiting'
              ? 'waiting'
              : 'queued',
        blockers: statusReason ? [statusReason] : [],
        destination: null,
        collaboratorIds: [],
      })
      tx.emit(
        'TASK_ASSIGNED',
        `Assigned ${task.title} to ${agent.name}.`,
        agent.id,
        task.id,
      )
      if (status === 'blocked' || status === 'waiting')
        tx.emit(
          status === 'blocked' ? 'AGENT_BLOCKED' : 'AGENT_WAITING',
          `${agent.name} is ${status}: ${statusReason ?? 'Task hold retained'}`,
          agent.id,
          task.id,
          { reason: statusReason },
        )
      return
    }
    case 'startTask': {
      const task = tx.task(command.taskId)
      nonterminal(task)
      const agent = currentAgent(tx, task)
      const reason = dependencyReason(tx, task)
      requireCondition(
        reason === null,
        'DEPENDENCIES_NOT_READY',
        reason ?? 'Dependencies are not ready.',
      )
      requireCondition(
        agent.status !== 'repair',
        'INVALID_TRANSITION',
        'Acknowledge repair before restarting work.',
      )
      requireCondition(
        !(task.status === 'in_progress' && agent.status === 'working'),
        'INVALID_TRANSITION',
        `Task ${task.id} is already working.`,
      )
      const destination: AgentSpatialIntent | null =
        agent.workstationId === null
          ? null
          : {
              id: tx.id('intent'),
              destinationType: 'workstation',
              destinationId: agent.workstationId,
              movementReason: `Work on task ${task.id}`,
              arrivalStatus: 'working',
              collaboratorIds: [],
            }
      tx.taskPatch(task.id, {
        status: 'in_progress',
        statusReason: null,
        waitingForDependencies: false,
        startedAt: task.startedAt ?? tx.time,
      })
      tx.agentPatch(agent.id, {
        status: 'working',
        blockers: [],
        collaboratorIds: [],
        destination,
      })
      tx.emit(
        'AGENT_STARTED',
        `${agent.name} started ${task.title}.`,
        agent.id,
        task.id,
        { intentId: destination?.id ?? null },
      )
      return
    }
    case 'updateProgress': {
      const task = tx.task(command.taskId)
      requireCondition(
        task.status === 'in_progress',
        'INVALID_TRANSITION',
        'Only in-progress tasks accept progress updates.',
      )
      requireCondition(
        Number.isFinite(command.progressPercent) &&
          command.progressPercent >= 0 &&
          command.progressPercent <= 100,
        'INVALID_PROGRESS',
        'Progress must be a finite percentage between 0 and 100.',
      )
      if (command.progressPercent === task.progressPercent) return
      tx.taskPatch(task.id, { progressPercent: command.progressPercent })
      tx.emit(
        'TASK_PROGRESS_UPDATED',
        `Updated ${task.title} to ${command.progressPercent}%.`,
        task.assignedAgentId,
        task.id,
        { progressPercent: command.progressPercent },
      )
      return
    }
    case 'completeTask': {
      const task = tx.task(command.taskId)
      requireCondition(
        !hasLiveToolExecution(tx.state, { taskId: task.id }),
        'TOOL_ACTIVE',
        'Finish or cancel the active tool before completing its task.',
      )
      requireCondition(
        task.status === 'in_progress',
        'INVALID_TRANSITION',
        'Only an in-progress task can be completed.',
      )
      const agent = currentAgent(tx, task)
      requireCondition(
        agent.status !== 'blocked' && agent.status !== 'repair',
        'INVALID_TRANSITION',
        'Resume the agent before completing its task.',
      )
      tx.taskPatch(task.id, {
        status: 'completed',
        progressPercent: 100,
        statusReason: null,
        waitingForDependencies: false,
        completedAt: tx.time,
      })
      tx.agentPatch(agent.id, {
        status: 'completed',
        destination: null,
        blockers: [],
        collaboratorIds: [],
      })
      tx.emit('TASK_COMPLETED', `Completed ${task.title}.`, agent.id, task.id)
      reconcileDependencies(tx)
      return
    }
    case 'failTask':
    case 'cancelTask': {
      const task = tx.task(command.taskId)
      nonterminal(task)
      const failed = command.type === 'failTask'
      if (failed || command.reason !== undefined) text(command.reason, 'Reason')
      const reason = command.reason ?? 'Cancelled by an explicit command.'
      tx.taskPatch(task.id, {
        status: failed ? 'failed' : 'cancelled',
        statusReason: reason,
        waitingForDependencies: false,
        ...(failed ? { failedAt: tx.time } : { cancelledAt: tx.time }),
      })
      if (task.assignedAgentId !== null) {
        const agent = currentAgent(tx, task)
        tx.agentPatch(agent.id, {
          status: failed ? 'blocked' : 'waiting',
          destination: null,
          blockers: failed ? [reason] : [],
          collaboratorIds: [],
        })
      }
      tx.emit(
        failed ? 'TASK_FAILED' : 'TASK_CANCELLED',
        `${failed ? 'Failed' : 'Cancelled'} ${task.title}: ${reason}`,
        task.assignedAgentId,
        task.id,
        { reason },
      )
      if (failed && task.assignedAgentId !== null)
        tx.emit(
          'AGENT_BLOCKED',
          `Agent blocked after ${task.title} failed.`,
          task.assignedAgentId,
          task.id,
          { reason },
        )
      reconcileDependencies(tx)
      return
    }
    case 'waitTask':
    case 'blockTask': {
      const task = tx.task(command.taskId)
      nonterminal(task)
      text(command.reason, 'Reason')
      const blocked = command.type === 'blockTask'
      tx.taskPatch(task.id, {
        status: blocked ? 'blocked' : 'waiting',
        statusReason: command.reason,
        waitingForDependencies: false,
      })
      if (task.assignedAgentId !== null) {
        const agent = currentAgent(tx, task)
        tx.agentPatch(agent.id, {
          status: blocked ? 'blocked' : 'waiting',
          blockers: [command.reason],
          ...(blocked ? {} : { destination: null, collaboratorIds: [] }),
        })
      }
      tx.emit(
        blocked ? 'AGENT_BLOCKED' : 'AGENT_WAITING',
        `${task.title} is ${blocked ? 'blocked' : 'waiting'}: ${command.reason}`,
        task.assignedAgentId,
        task.id,
        { reason: command.reason },
      )
      return
    }
    case 'setTaskDependencies': {
      const task = tx.task(command.taskId)
      nonterminal(task)
      validateDependencies(tx, task.id, command.dependencyIds)
      if (
        task.dependencyIds.length === command.dependencyIds.length &&
        task.dependencyIds.every(
          (id, index) => command.dependencyIds[index] === id,
        )
      )
        return
      tx.taskPatch(task.id, { dependencyIds: [...command.dependencyIds] })
      tx.emit(
        'TASK_DEPENDENCIES_CHANGED',
        `Updated dependencies for ${task.title}.`,
        task.assignedAgentId,
        task.id,
        { dependencyIds: [...command.dependencyIds] },
      )
      reconcileDependencies(tx)
      return
    }
    case 'beginRepair': {
      const agent = tx.agent(command.agentId)
      text(command.reason, 'Repair reason')
      requireCondition(
        agent.status === 'blocked',
        'INVALID_TRANSITION',
        'Only a blocked agent can enter repair.',
      )
      tx.agentPatch(agent.id, { status: 'repair', blockers: [command.reason] })
      tx.emit(
        'AGENT_REPAIR_STARTED',
        `${agent.name} entered repair: ${command.reason}`,
        agent.id,
        agent.currentTaskId,
        { reason: command.reason },
      )
      return
    }
    case 'repairAgent': {
      const agent = tx.agent(command.agentId)
      text(command.reason, 'Repair acknowledgment')
      requireCondition(
        agent.status === 'blocked' || agent.status === 'repair',
        'INVALID_TRANSITION',
        'Only a blocked or repairing agent can acknowledge recovery.',
      )
      let status: OfficeAgentStatus = 'waiting'
      let blockers: string[] = []
      if (agent.currentTaskId !== null) {
        const task = tx.task(agent.currentTaskId)
        if (!TERMINAL.has(task.status)) {
          const reason = dependencyReason(tx, task)
          tx.taskPatch(task.id, {
            status: reason ? 'waiting' : 'assigned',
            statusReason: reason,
            waitingForDependencies: reason !== null,
          })
          status = reason ? 'waiting' : 'queued'
          blockers = reason ? [reason] : []
        }
      }
      tx.agentPatch(
        agent.id,
        {
          status,
          blockers,
          destination: null,
          collaboratorIds: [],
        },
        true,
      )
      tx.emit(
        'AGENT_REPAIRED',
        `${agent.name} recovery was acknowledged: ${command.reason}`,
        agent.id,
        agent.currentTaskId,
        { reason: command.reason },
      )
      return
    }
    case 'requestMovement': {
      const agent = tx.agent(command.agentId)
      requireCondition(
        !hasLiveToolExecution(tx.state, { agentId: agent.id }),
        'TOOL_ACTIVE',
        'Finish or cancel the active tool before requesting movement.',
      )
      requireCondition(
        agent.status !== 'blocked' && agent.status !== 'repair',
        'INVALID_TRANSITION',
        'Blocked or repairing agents must explicitly resume before moving.',
      )
      identifier(command.destinationId, 'Destination ID')
      text(command.movementReason, 'Movement reason')
      requireCondition(
        ['workstation', 'hub', 'agent', 'waypoint'].includes(
          command.destinationType,
        ),
        'INVALID_INPUT',
        'Destination type is unknown.',
      )
      requireCondition(
        ['working', 'waiting', 'collaborating'].includes(command.arrivalStatus),
        'INVALID_INPUT',
        'Arrival status is unknown.',
      )
      if (command.destinationType === 'workstation')
        requireCondition(
          has(tx.state.workstations, command.destinationId),
          'NOT_FOUND',
          `Workstation ${command.destinationId} does not exist.`,
        )
      if (command.destinationType === 'agent') {
        requireCondition(
          command.destinationId !== agent.id,
          'INVALID_INPUT',
          'An agent cannot move toward itself.',
        )
        tx.agent(command.destinationId)
      }
      if (command.arrivalStatus === 'working')
        requireWorkingArrival(tx, agent, command)
      const collaboratorIds = collaborators(
        tx,
        agent.id,
        command.collaboratorIds ?? [],
      )
      const id = command.intentId ?? tx.id('intent')
      identifier(id, 'Intent ID')
      requireCondition(
        !intentUsed(tx.state, id),
        'DUPLICATE_ID',
        `Movement intent ${id} was already issued.`,
      )
      const destination: AgentSpatialIntent = {
        id,
        destinationType: command.destinationType,
        destinationId: command.destinationId,
        movementReason: command.movementReason,
        arrivalStatus: command.arrivalStatus,
        collaboratorIds,
      }
      tx.agentPatch(agent.id, {
        status: 'walking',
        destination,
        collaboratorIds: [],
        blockers: [],
      })
      tx.emit(
        'AGENT_WALKING',
        `${agent.name} was directed to ${command.destinationId}: ${command.movementReason}`,
        agent.id,
        agent.currentTaskId,
        {
          intentId: id,
          destinationType: command.destinationType,
          destinationId: command.destinationId,
          arrivalStatus: command.arrivalStatus,
        },
      )
      return
    }
    case 'arrive': {
      const agent = tx.agent(command.agentId)
      const intent = agent.destination
      requireCondition(
        intent !== null && intent.id === command.intentId,
        'STALE_INTENT',
        'Arrival does not match the current movement intent.',
      )
      requireCondition(
        agent.status !== 'blocked' && agent.status !== 'repair',
        'INVALID_TRANSITION',
        'Paused agents cannot accept movement completion.',
      )
      groundPose(command.position, command.headingRadians)
      if (intent.arrivalStatus === 'working')
        requireWorkingArrival(tx, agent, intent)
      tx.agentPatch(agent.id, {
        status: intent.arrivalStatus,
        position: copyPosition(command.position),
        headingRadians: command.headingRadians,
        destination: null,
        collaboratorIds: intent.collaboratorIds,
        blockers: [],
      })
      tx.emit(
        'AGENT_ARRIVED',
        `${agent.name} arrived at ${intent.destinationId}.`,
        agent.id,
        agent.currentTaskId,
        {
          intentId: intent.id,
          destinationId: intent.destinationId,
          position: [...command.position],
          headingRadians: command.headingRadians,
        },
      )
      if (intent.arrivalStatus === 'collaborating')
        tx.emit(
          'AGENT_COLLABORATING',
          `${agent.name} began the requested collaboration.`,
          agent.id,
          agent.currentTaskId,
          { collaboratorIds: [...intent.collaboratorIds] },
        )
      return
    }
    case 'rejectMovement': {
      const agent = tx.agent(command.agentId)
      text(command.reason, 'Movement rejection reason')
      requireCondition(
        agent.destination?.id === command.intentId,
        'STALE_INTENT',
        'Rejection does not match the current movement intent.',
      )
      tx.agentPatch(agent.id, {
        status: 'blocked',
        destination: null,
        blockers: [command.reason],
      })
      if (
        agent.currentTaskId !== null &&
        !TERMINAL.has(tx.task(agent.currentTaskId).status)
      )
        tx.taskPatch(agent.currentTaskId, {
          status: 'blocked',
          statusReason: command.reason,
          waitingForDependencies: false,
        })
      tx.emit(
        'AGENT_BLOCKED',
        `${agent.name} could not reach the requested destination: ${command.reason}`,
        agent.id,
        agent.currentTaskId,
        { intentId: command.intentId, reason: command.reason },
      )
      return
    }
    default:
      throw new RuntimeFault('INVALID_COMMAND', 'Unknown runtime command.')
  }
}

/** Local command processor. No timers, navigation, rendering, or task execution. */
export class OfficeRuntime {
  private snapshot: RuntimeState
  private readonly repository: OfficeRuntimeRepository
  private readonly now: () => string
  private readonly nextId: (scope: string) => string
  private readonly memoryPolicy: MemoryPolicy
  private readonly listeners = new Set<() => void>()
  private counters = {
    commands: 0,
    commits: 0,
    notifications: 0,
    rejectedCommands: 0,
  }
  private dispatching = false

  constructor(options: OfficeRuntimeOptions = {}) {
    this.memoryPolicy = copyMemoryPolicy(options.memoryPolicy ?? { grants: [] })
    this.repository =
      options.repository ?? createInMemoryOfficeRuntimeRepository()
    const restored = this.repository.read()
    this.snapshot =
      restored === null
        ? createEmptyRuntimeState()
        : freeze({
            ...structuredClone(restored),
            requests: restored.requests
              ? structuredClone(restored.requests)
              : {},
            plans: restored.plans ? structuredClone(restored.plans) : {},
            toolExecutions: restored.toolExecutions
              ? structuredClone(restored.toolExecutions)
              : {},
            memories: restored.memories
              ? structuredClone(restored.memories)
              : {},
          })
    this.now = options.now ?? (() => new Date().toISOString())
    let sequence =
      this.snapshot.events.length + Object.keys(this.snapshot.tasks).length
    this.nextId =
      options.nextId ??
      ((scope) => {
        let id: string
        do {
          id = `${scope}:${++sequence}`
        } while (
          has(this.snapshot.tasks, id) ||
          has(this.snapshot.agents, id) ||
          has(this.snapshot.toolExecutions, id) ||
          has(this.snapshot.memories, id) ||
          orchestrationIdUsed(this.snapshot, id) ||
          this.snapshot.events.some((event) => event.id === id) ||
          intentUsed(this.snapshot, id)
        )
        return id
      })
  }

  readonly getSnapshot = () => this.snapshot
  readonly getMetrics = (): RuntimeMetrics =>
    Object.freeze({ ...this.counters, subscribers: this.listeners.size })
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly dispatch = (command: RuntimeCommand): RuntimeResult => {
    this.counters.commands += 1
    if (this.dispatching) {
      this.counters.rejectedCommands += 1
      return {
        ok: false,
        error: {
          code: 'REENTRANT_COMMAND',
          message: 'A repository transaction is already in progress.',
        },
      }
    }
    this.dispatching = true
    let next: RuntimeState
    try {
      const tx = new Transaction(
        this.snapshot,
        this.now,
        this.nextId,
        this.memoryPolicy,
      )
      applyCommand(tx, command)
      next = tx.finish(this.snapshot)
      if (next !== this.snapshot) {
        try {
          this.repository.write(next)
        } catch {
          throw new RuntimeFault(
            'REPOSITORY_ERROR',
            'The repository could not commit this command.',
          )
        }
        this.snapshot = next
        this.counters.commits += 1
      } else return { ok: true, state: this.snapshot }
    } catch (error) {
      this.counters.rejectedCommands += 1
      return {
        ok: false,
        error:
          error instanceof RuntimeFault ||
          error instanceof OrchestrationFault ||
          error instanceof ToolFault ||
          error instanceof MemoryFault
            ? { code: error.code, message: error.message }
            : {
                code: 'INVALID_COMMAND',
                message: 'The command could not be validated.',
              },
      }
    } finally {
      this.dispatching = false
    }
    for (const listener of [...this.listeners]) {
      this.counters.notifications += 1
      // Reentrant subscriber commands are new committed transactions. Subscribers
      // always read the latest snapshot; this dispatch still returns its own commit.
      try {
        listener()
      } catch {
        /* A subscriber failure cannot roll back committed state or starve other subscribers. */
      }
    }
    return { ok: true, state: next }
  }
}

export function createOfficeRuntime(options: OfficeRuntimeOptions = {}) {
  return new OfficeRuntime(options)
}
