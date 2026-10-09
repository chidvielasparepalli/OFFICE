import type { RuntimeState, RuntimeTaskPriority } from '../runtime/runtimeTypes'
import { meetsCapabilities } from './capabilityMatcher'
import type {
  ManagerRequest,
  PlanProposal,
  PlanTaskProposal,
} from './orchestrationTypes'

export type PlanValidationResult =
  | { readonly ok: true; readonly proposal: Readonly<PlanProposal> }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

class PlanFault extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function requirePlan(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new PlanFault(code, message)
}

function record(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  requirePlan(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_PLAN',
    `${label} must be an object.`,
  )
  const prototype = Object.getPrototypeOf(value)
  const ownKeys = Reflect.ownKeys(value)
  requirePlan(
    (prototype === Object.prototype || prototype === null) &&
      ownKeys.length === keys.length &&
      ownKeys.every(
        (key) =>
          typeof key === 'string' &&
          keys.includes(key) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
      ),
    'INVALID_PLAN',
    `${label} must contain exactly: ${keys.join(', ')}.`,
  )
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  requirePlan(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_PLAN',
    `${label} must be nonempty text.`,
  )
  return value
}

function id(value: unknown, label: string): string {
  const result = text(value, label)
  requirePlan(
    !/\s/u.test(result) &&
      !Array.from(result).some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
      }) &&
      !['__proto__', 'prototype', 'constructor'].includes(result),
    'INVALID_PLAN_ID',
    `${label} must not contain whitespace, control characters or a reserved record key.`,
  )
  return result
}

function strings(value: unknown, label: string): readonly string[] {
  requirePlan(
    Array.isArray(value),
    'INVALID_PLAN',
    `${label} must be an array.`,
  )
  // Array.from also visits sparse slots, which must not silently bypass validation.
  return Object.freeze(Array.from(value, (item) => text(item, label)))
}

function identifiers(value: unknown, label: string): readonly string[] {
  const values = strings(value, label).map((item) => id(item, label))
  requirePlan(
    new Set(values).size === values.length,
    'INVALID_PLAN_DEPENDENCY',
    `${label} must not contain duplicate IDs.`,
  )
  return Object.freeze(values)
}

function availableId(value: string, state: RuntimeState) {
  requirePlan(
    !Object.hasOwn(state.tasks, value) && !Object.hasOwn(state.plans, value),
    'PLAN_ID_COLLISION',
    `ID ${value} already belongs to a runtime task or plan.`,
  )
}

/** Validate unknown planner output without mutating the proposal or the runtime. */
export function validatePlanProposal(
  input: unknown,
  request: Readonly<ManagerRequest>,
  state: RuntimeState,
): PlanValidationResult {
  try {
    const source = record(
      input,
      [
        'planId',
        'requestId',
        'objective',
        'tasks',
        'constraints',
        'expectedOutputs',
      ],
      'Plan',
    )
    const planId = id(source.planId, 'Plan ID')
    const requestId = id(source.requestId, 'Request ID')
    requirePlan(
      requestId === request.requestId,
      'PLAN_REQUEST_MISMATCH',
      'The plan must belong to the request being planned.',
    )
    availableId(planId, state)
    const objective = text(source.objective, 'Plan objective')
    const constraints = strings(source.constraints, 'Plan constraints')
    requirePlan(
      request.constraints.every((constraint) =>
        constraints.includes(constraint),
      ),
      'PLAN_CONSTRAINT_MISSING',
      'The plan must retain every request constraint exactly.',
    )
    const expectedOutputs = strings(source.expectedOutputs, 'Expected outputs')
    requirePlan(
      Array.isArray(source.tasks) && source.tasks.length > 0,
      'INVALID_PLAN',
      'A plan must contain at least one task.',
    )
    const tasks = new Map<string, Readonly<PlanTaskProposal>>()
    for (const inputTask of source.tasks) {
      const task = record(
        inputTask,
        [
          'id',
          'title',
          'description',
          'priority',
          'status',
          'dependencyIds',
          'requiredCapabilities',
          'preferredAgentId',
        ],
        'Task',
      )
      const taskId = id(task.id, 'Task ID')
      availableId(taskId, state)
      requirePlan(
        taskId !== planId && !tasks.has(taskId),
        'PLAN_ID_COLLISION',
        `Task ID ${taskId} is already used in this proposal.`,
      )
      requirePlan(
        task.status === 'queued',
        'INVALID_PLAN_STATUS',
        `Proposed task ${taskId} must start queued.`,
      )
      requirePlan(
        ['low', 'normal', 'high', 'urgent'].includes(task.priority as string),
        'INVALID_PLAN_PRIORITY',
        `Task ${taskId} has an unknown priority.`,
      )
      const requiredCapabilities = strings(
        task.requiredCapabilities,
        'Required capabilities',
      )
      const preferredAgentId =
        task.preferredAgentId === null
          ? null
          : id(task.preferredAgentId, 'Preferred agent ID')
      if (preferredAgentId !== null) {
        const agent = Object.hasOwn(state.agents, preferredAgentId)
          ? state.agents[preferredAgentId]
          : undefined
        requirePlan(
          agent &&
            meetsCapabilities(
              agent,
              { capabilities: requiredCapabilities, preferredAgentId },
              request.managerId,
            ),
          'INVALID_PREFERRED_AGENT',
          `Preferred agent ${preferredAgentId} must be a capable standard worker owned by this Manager or unowned.`,
        )
      }
      tasks.set(
        taskId,
        Object.freeze({
          id: taskId,
          title: text(task.title, 'Task title'),
          description: text(task.description, 'Task description'),
          priority: task.priority as RuntimeTaskPriority,
          status: 'queued',
          dependencyIds: identifiers(task.dependencyIds, 'Task dependencies'),
          requiredCapabilities,
          preferredAgentId,
        }),
      )
    }
    const ordered: Readonly<PlanTaskProposal>[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()
    function visit(taskId: string) {
      requirePlan(
        !visiting.has(taskId),
        'PLAN_DEPENDENCY_CYCLE',
        'Plan dependencies must not contain a cycle.',
      )
      if (visited.has(taskId)) return
      const task = tasks.get(taskId)
      requirePlan(
        task,
        'INVALID_PLAN_DEPENDENCY',
        `Dependency ${taskId} must refer to a task in this proposal.`,
      )
      visiting.add(taskId)
      for (const dependency of task.dependencyIds) visit(dependency)
      visiting.delete(taskId)
      visited.add(taskId)
      ordered.push(task)
    }
    for (const taskId of tasks.keys()) visit(taskId)
    return {
      ok: true,
      proposal: Object.freeze({
        planId,
        requestId,
        objective,
        tasks: Object.freeze(ordered),
        constraints,
        expectedOutputs,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof PlanFault
          ? { code: error.code, message: error.message }
          : {
              code: 'INVALID_PLAN',
              message: 'The plan could not be validated.',
            },
    }
  }
}
