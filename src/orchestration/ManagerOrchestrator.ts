import type { OfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeResult, RuntimeState } from '../runtime/runtimeTypes'
import { eligibleAgents } from './capabilityMatcher'
import type {
  ExecutionPlan,
  ExecutionResult,
  ManagerContext,
  OrchestrationIssue,
  Planner,
  PlanningContext,
  RequestInput,
} from './orchestrationTypes'

const terminal = new Set(['completed', 'failed', 'cancelled'])
const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }

function failure(code: string, message: string): RuntimeResult {
  return { ok: false, error: { code, message } }
}

function executionResult(
  plan: ExecutionPlan,
  state: RuntimeState,
): ExecutionResult {
  const tasks = plan.taskIds.map((id) => state.tasks[id]).filter(Boolean)
  const completedTaskIds = tasks
    .filter((task) => task.status === 'completed')
    .map((task) => task.id)
  const failedTaskIds = tasks
    .filter((task) => task.status === 'failed')
    .map((task) => task.id)
  const blockedTaskIds = tasks
    .filter((task) => task.status === 'blocked')
    .map((task) => task.id)
  return Object.freeze({
    requestId: plan.requestId,
    status: plan.status,
    completedTaskIds: Object.freeze(completedTaskIds),
    failedTaskIds: Object.freeze(failedTaskIds),
    blockedTaskIds: Object.freeze(blockedTaskIds),
    artifacts: Object.freeze([]),
    summary: `${completedTaskIds.length} of ${plan.taskIds.length} tasks recorded complete; ${failedTaskIds.length} failed; ${blockedTaskIds.length} blocked. No output artifacts have been supplied or verified.`,
  })
}

export interface DispatchResult {
  readonly ok: boolean
  readonly dispatchedTaskIds: readonly string[]
  readonly issues: readonly OrchestrationIssue[]
}

/** The dispatcher issues atomic runtime commands; it never owns task state. */
export class TaskDispatcher {
  private readonly runtime: OfficeRuntime
  private readonly managerId: string

  constructor(runtime: OfficeRuntime, managerId: string) {
    this.runtime = runtime
    this.managerId = managerId
  }

  dispatch(planId: string, taskId: string): RuntimeResult {
    const state = this.runtime.getSnapshot()
    const plan = state.plans[planId]
    const requirements = plan?.requirements[taskId]
    if (!plan || plan.managerId !== this.managerId || !requirements)
      return failure(
        'INVALID_ASSIGNMENT',
        'This task does not belong to the Manager plan.',
      )
    const agent = eligibleAgents(state, requirements, this.managerId)[0]
    if (!agent)
      return failure(
        'AGENT_UNAVAILABLE',
        'No available standard worker matches this task’s required capabilities and preferred assignment.',
      )
    return this.runtime.dispatch({
      type: 'dispatchPlanTask',
      managerId: this.managerId,
      planId,
      taskId,
      agentId: agent.id,
    })
  }
}

/** Command/event coordinator. All business records live in OfficeRuntime. */
export class ManagerOrchestrator {
  private readonly runtime: OfficeRuntime
  private readonly managerId: string
  private readonly planner: Planner
  private readonly dispatcher: TaskDispatcher
  private unsubscribe: (() => void) | null = null
  private cursor = 0
  private monitoring = false
  private counters = {
    plannerCalls: 0,
    monitorPasses: 0,
    dispatchAttempts: 0,
    monitorFailures: 0,
  }
  private monitorError: { code: string; message: string } | null = null
  private cachedContext: {
    state: RuntimeState
    requestId: string | undefined
    value: ManagerContext
  } | null = null

  constructor(options: {
    runtime: OfficeRuntime
    managerId: string
    planner: Planner
  }) {
    this.runtime = options.runtime
    this.managerId = options.managerId
    this.planner = options.planner
    this.dispatcher = new TaskDispatcher(options.runtime, options.managerId)
  }

  start() {
    if (this.unsubscribe) return
    this.cursor = 0
    this.unsubscribe = this.runtime.subscribe(this.monitor)
    this.monitor()
  }

  dispose() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  readonly getMetrics = () =>
    Object.freeze({ ...this.counters, monitorError: this.monitorError })

  receiveRequest(request: RequestInput): RuntimeResult {
    return this.runtime.dispatch({
      type: 'receiveRequest',
      managerId: this.managerId,
      request,
    })
  }

  async planRequest(requestId: string): Promise<RuntimeResult> {
    const started = this.runtime.dispatch({
      type: 'beginPlanning',
      managerId: this.managerId,
      requestId,
    })
    if (!started.ok) return started
    const state = this.runtime.getSnapshot()
    const request = state.requests[requestId]
    const attemptId = request?.planningAttemptId
    if (!attemptId)
      return failure(
        'STALE_PLAN',
        'Planning was interrupted before the proposal could be requested.',
      )
    const context: PlanningContext = Object.freeze({
      managerId: this.managerId,
      agents: Object.freeze(
        Object.values(state.agents).map((agent) =>
          Object.freeze({
            id: agent.id,
            name: agent.name,
            kind: agent.kind,
            capabilities: agent.capabilities,
            status: agent.status,
            managerId: agent.managerId,
          }),
        ),
      ),
      existingTaskIds: Object.freeze(Object.keys(state.tasks)),
    })
    this.counters.plannerCalls += 1
    let proposal: unknown
    try {
      proposal = await this.planner.plan(request, context)
    } catch {
      const rejected = this.rejectAttempt(
        requestId,
        attemptId,
        'The planner failed to return a structured proposal.',
      )
      return rejected.ok
        ? failure(
            'PLANNING_FAILED',
            'The planner failed to return a structured proposal.',
          )
        : rejected
    }
    const accepted = this.runtime.dispatch({
      type: 'acceptPlan',
      managerId: this.managerId,
      requestId,
      attemptId,
      proposal,
    })
    if (!accepted.ok) {
      const current = this.runtime.getSnapshot().requests[requestId]
      if (
        current?.status === 'planning' &&
        current.planningAttemptId === attemptId
      ) {
        const rejected = this.rejectAttempt(
          requestId,
          attemptId,
          accepted.error.message,
        )
        if (!rejected.ok) return rejected
      }
      return accepted
    }
    return { ok: true, state: this.runtime.getSnapshot() }
  }

  private rejectAttempt(
    requestId: string,
    attemptId: string,
    reason: string,
  ): RuntimeResult {
    const recorded = this.runtime.dispatch({
      type: 'rejectPlan',
      managerId: this.managerId,
      requestId,
      attemptId,
      reason,
    })
    if (!recorded.ok) this.monitorError = Object.freeze(recorded.error)
    return recorded
  }

  dispatchReady(requestId: string): DispatchResult {
    const before = this.runtime.getSnapshot()
    const request = before.requests[requestId]
    const plan = request?.planId ? before.plans[request.planId] : null
    if (!plan || plan.managerId !== this.managerId)
      return {
        ok: false,
        dispatchedTaskIds: [],
        issues: [
          {
            code: 'PLAN_REQUIRED',
            message: 'An accepted plan owned by this Manager is required.',
            taskId: null,
            agentId: null,
          },
        ],
      }
    const issues: OrchestrationIssue[] = []
    const dispatchedTaskIds: string[] = []
    const sync = this.synchronize(requestId)
    if (!sync.ok)
      return {
        ok: false,
        dispatchedTaskIds,
        issues: [{ ...sync.error, taskId: null, agentId: null }],
      }
    const taskIds = [...plan.taskIds].sort(
      (a, b) =>
        priorityOrder[before.tasks[a].priority] -
        priorityOrder[before.tasks[b].priority],
    )
    for (const taskId of taskIds) {
      const state = this.runtime.getSnapshot()
      const task = state.tasks[taskId]
      if (
        task.status !== 'queued' ||
        task.assignedAgentId !== null ||
        task.dependencyIds.some((id) => state.tasks[id]?.status !== 'completed')
      )
        continue
      this.counters.dispatchAttempts += 1
      const result = this.dispatcher.dispatch(plan.planId, taskId)
      if (result.ok) dispatchedTaskIds.push(taskId)
      else {
        const issue: OrchestrationIssue = {
          ...result.error,
          taskId,
          agentId: plan.requirements[taskId].preferredAgentId,
        }
        issues.push(issue)
        const recorded = this.runtime.dispatch({
          type: 'recordDispatchIssue',
          managerId: this.managerId,
          planId: plan.planId,
          issue,
        })
        if (!recorded.ok) {
          this.monitorError = Object.freeze(recorded.error)
          issues.push({ ...recorded.error, taskId, agentId: issue.agentId })
        }
      }
    }
    return { ok: issues.length === 0, dispatchedTaskIds, issues }
  }

  cancelRequest(requestId: string, reason: string): RuntimeResult {
    const result = this.runtime.dispatch({
      type: 'cancelRequest',
      managerId: this.managerId,
      requestId,
      reason,
    })
    if (result.ok) this.monitorError = null
    return result
  }

  synchronize(requestId: string): RuntimeResult {
    const request = this.runtime.getSnapshot().requests[requestId]
    if (!request?.planId || request.managerId !== this.managerId)
      return failure(
        'PLAN_REQUIRED',
        'An accepted plan owned by this Manager is required.',
      )
    const result = this.runtime.dispatch({
      type: 'synchronizePlan',
      managerId: this.managerId,
      planId: request.planId,
    })
    this.monitorError = result.ok ? null : Object.freeze(result.error)
    return result
  }

  private readonly monitor = () => {
    if (this.monitoring) return
    this.monitoring = true
    try {
      let state = this.runtime.getSnapshot()
      while (this.cursor < state.events.length) {
        const events = state.events.slice(this.cursor)
        // Advance before publishing derived status; synchronous notifications can reenter.
        this.cursor = state.events.length
        if (
          state.connection === 'local' &&
          events.some(
            (event) =>
              event.type.startsWith('TASK_') ||
              event.type.startsWith('AGENT_') ||
              event.type === 'PLAN_ACCEPTED' ||
              event.type === 'RUNTIME_CONNECTED',
          )
        ) {
          for (const plan of Object.values(state.plans)) {
            if (plan.managerId !== this.managerId || terminal.has(plan.status))
              continue
            this.counters.monitorPasses += 1
            const result = this.runtime.dispatch({
              type: 'synchronizePlan',
              managerId: this.managerId,
              planId: plan.planId,
            })
            if (!result.ok) {
              this.counters.monitorFailures += 1
              this.monitorError = Object.freeze(result.error)
            } else this.monitorError = null
          }
        }
        state = this.runtime.getSnapshot()
      }
    } finally {
      this.monitoring = false
    }
  }

  getContext(requestId?: string): ManagerContext {
    const state = this.runtime.getSnapshot()
    if (
      this.cachedContext?.state === state &&
      this.cachedContext.requestId === requestId
    )
      return this.cachedContext.value
    const owned = Object.values(state.requests).filter(
      (request) => request.managerId === this.managerId,
    )
    const currentTaskId = state.agents[this.managerId]?.currentTaskId
    const candidate = requestId
      ? state.requests[requestId]
      : (owned.find(
          (request) =>
            request.coordinationTaskId === currentTaskId &&
            !terminal.has(request.status),
        ) ??
        owned.find((request) => !terminal.has(request.status)) ??
        owned.at(-1))
    const request = candidate?.managerId === this.managerId ? candidate : null
    const plan = request?.planId ? state.plans[request.planId] : null
    const tasks = plan
      ? plan.taskIds.map((id) => state.tasks[id]).filter(Boolean)
      : []
    const taskIds = new Set(tasks.map((task) => task.id))
    if (request?.coordinationTaskId) taskIds.add(request.coordinationTaskId)
    const activeTasks = tasks.filter((task) => !terminal.has(task.status))
    const activeIds = new Set(
      activeTasks
        .map((task) => task.assignedAgentId)
        .filter((id): id is string => id !== null),
    )
    const value: ManagerContext = Object.freeze({
      manager:
        state.agents[this.managerId]?.kind === 'manager'
          ? state.agents[this.managerId]
          : null,
      request: request ?? null,
      plan: plan ?? null,
      activeTasks: Object.freeze(activeTasks),
      blockedTasks: Object.freeze(
        tasks.filter((task) => task.status === 'blocked'),
      ),
      completedTasks: Object.freeze(
        tasks.filter((task) => task.status === 'completed'),
      ),
      activeAgents: Object.freeze([...activeIds].map((id) => state.agents[id])),
      dependencies: Object.freeze(
        Object.fromEntries(tasks.map((task) => [task.id, task.dependencyIds])),
      ),
      events: Object.freeze(
        state.events.filter(
          (event) =>
            (event.taskId !== null && taskIds.has(event.taskId)) ||
            (request !== null && event.payload.requestId === request.requestId),
        ),
      ),
      result: plan ? executionResult(plan, state) : null,
    })
    this.cachedContext = { state, requestId, value }
    return value
  }
}
