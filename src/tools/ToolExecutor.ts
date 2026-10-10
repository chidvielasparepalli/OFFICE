import type { OfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeJson } from '../runtime/runtimeTypes'
import { ToolRegistry } from './ToolRegistry'
import { publicToolJson, redactToolText, toolId } from './toolValidation'
import {
  ToolFault,
  type ToolErrorData,
  type ToolExecutionResult,
  type ToolGrant,
  type ToolRequest,
} from './toolTypes'

interface ExecutionHandle {
  request: ToolRequest
  controller: AbortController
  promise: Promise<ToolExecutionResult>
  settled: boolean
  started: boolean
}

const active = (result: ToolExecutionResult) =>
  result.status === 'queued' || result.status === 'running'

/** Host service. Runtime owns all records; this map contains only in-flight cancellation handles. */
export class ToolExecutor {
  private readonly runtime: OfficeRuntime
  private readonly registry: ToolRegistry
  private readonly grants: Readonly<Record<string, ToolGrant>>
  private readonly handles = new Map<string, ExecutionHandle>()
  private readonly unsubscribe: () => void
  private disposed = false

  constructor(options: {
    runtime: OfficeRuntime
    registry: ToolRegistry
    grants: Readonly<Record<string, ToolGrant>>
  }) {
    this.runtime = options.runtime
    this.registry = options.registry
    this.grants = structuredClone(options.grants)
    if (Object.values(this.runtime.getSnapshot().toolExecutions).some(active))
      throw new ToolFault(
        'UNRESOLVED_EXECUTIONS',
        'Cancel or reconcile retained tool executions before starting an executor; side effects will not be replayed.',
      )
    this.unsubscribe = this.runtime.subscribe(() => {
      const state = this.runtime.getSnapshot()
      for (const [id, handle] of this.handles) {
        const execution = state.toolExecutions[id]
        if (state.connection !== 'local' || (execution && !active(execution)))
          handle.controller.abort(
            new ToolFault('CANCELLED', 'Execution is no longer active.'),
          )
      }
    })
  }

  execute(request: ToolRequest): Promise<ToolExecutionResult> {
    try {
      if (this.disposed)
        throw new ToolFault(
          'EXECUTOR_DISPOSED',
          'Tool executor has been disposed.',
        )
      for (const id of [
        request.executionId,
        request.agentId,
        request.taskId,
        request.toolId,
      ])
        toolId(id)
      const previous =
        this.runtime.getSnapshot().toolExecutions[request.executionId]
      const handle = this.handles.get(request.executionId)
      const identity = previous ?? handle?.request
      if (
        identity &&
        (identity.agentId !== request.agentId ||
          identity.taskId !== request.taskId ||
          identity.toolId !== request.toolId)
      )
        throw new ToolFault(
          'EXECUTION_ID_CONFLICT',
          'Execution ID belongs to a different request.',
        )
      // Idempotency is by execution ID: later calls never replace the original input.
      if (handle) return handle.promise
      if (previous) {
        if (active(previous))
          throw new ToolFault(
            'UNRESOLVED_EXECUTION',
            'Retained execution has no active host handle; cancel or reconcile it explicitly.',
          )
        return Promise.resolve(previous)
      }
      if (
        [...this.handles.values()].some(
          (item) => item.request.agentId === request.agentId,
        )
      )
        throw new ToolFault(
          'TOOL_ACTIVE',
          'This agent still has a tool execution being cleaned up.',
        )
      const next: ExecutionHandle = {
        request: { ...request, input: structuredClone(request.input) },
        controller: new AbortController(),
        promise: Promise.resolve(null as unknown as ToolExecutionResult),
        started: false,
        settled: false,
      }
      // Queue after installing the handle so synchronous runtime subscribers cannot launch it twice.
      next.promise = Promise.resolve()
        .then(() => this.run(next))
        .finally(() => {
          if (!next.started || next.settled)
            this.handles.delete(request.executionId)
        })
      this.handles.set(request.executionId, next)
      return next.promise
    } catch (error) {
      return Promise.reject(error)
    }
  }

  cancel(executionId: string): boolean {
    const handle = this.handles.get(executionId)
    const execution = this.runtime.getSnapshot().toolExecutions[executionId]
    if (execution && active(execution)) {
      this.command({
        type: 'cancelToolExecution',
        executionId,
        reason: 'Cancelled by the operator.',
      })
      return true
    }
    if (handle && !execution) {
      handle.controller.abort(
        new ToolFault('CANCELLED', 'Cancelled before execution.'),
      )
      return true
    }
    return false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    let failure: unknown
    for (const [id, handle] of this.handles) {
      try {
        this.cancel(id)
      } catch (error) {
        failure ??= error
      } finally {
        handle.controller.abort(
          new ToolFault('CANCELLED', 'Executor disposed.'),
        )
      }
    }
    this.unsubscribe()
    if (failure) throw failure
  }

  getMetrics() {
    return { activeExecutions: this.handles.size }
  }

  private command(command: RuntimeCommand) {
    const result = this.runtime.dispatch(command)
    if (!result.ok) throw new ToolFault(result.error.code, result.error.message)
  }

  private async run(handle: ExecutionHandle): Promise<ToolExecutionResult> {
    const { request, controller } = handle
    const { executionId, agentId, taskId, toolId: id } = request
    const agent = this.runtime.getSnapshot().agents[agentId]
    if (!agent)
      throw new ToolFault('AGENT_NOT_FOUND', 'Tool agent does not exist.')
    const grant = Object.hasOwn(this.grants, agentId)
      ? this.grants[agentId]
      : undefined
    const permission = this.registry.checkCapability(id, agent, grant)
    const tool = this.registry.lookup(id)
    let input: ReturnType<NonNullable<typeof tool>['parseInput']> = null
    let inputSummary: RuntimeJson = null
    let invalidInput: ToolErrorData | null = null
    if (permission.allowed && tool) {
      try {
        input = tool.parseInput(request.input)
        inputSummary = publicToolJson(tool.summarizeInput(input), 4096)
      } catch (error) {
        invalidInput = this.error(error, 'INVALID_INPUT')
      }
    }
    this.command({
      type: 'requestToolExecution',
      executionId,
      agentId,
      taskId,
      toolId: id,
      inputSummary,
      permission,
      metadata: { category: tool?.category ?? 'unknown' },
    })
    const current = () => this.runtime.getSnapshot().toolExecutions[executionId]
    if (!active(current())) return current()
    if (controller.signal.aborted) {
      this.command({
        type: 'cancelToolExecution',
        executionId,
        reason: 'Cancelled before execution.',
      })
      return current()
    }
    if (invalidInput) {
      this.command({
        type: 'failToolExecution',
        executionId,
        error: invalidInput,
      })
      return current()
    }
    if (!tool || !permission.allowed)
      throw new ToolFault('PERMISSION_DENIED', 'Tool permission was denied.')
    this.command({ type: 'startToolExecution', executionId })
    // A subscriber may have cancelled/blocked the task as the start event committed.
    if (!active(current()) || controller.signal.aborted) return current()
    const timer = setTimeout(
      () =>
        controller.abort(
          new ToolFault(
            'TIMEOUT',
            'Tool exceeded its host-configured time limit.',
          ),
        ),
      tool.timeoutMs,
    )
    let removeAbortListener = () => {}
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    try {
      handle.started = true
      const executing = Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted()
          return tool.execute(input, {
            executionId,
            agentId,
            taskId,
            signal: controller.signal,
          })
        })
        .finally(() => {
          handle.settled = true
          this.handles.delete(executionId)
        })
      const interrupted = new Promise<never>((_resolve, reject) => {
        const abort = () => {
          // Cooperating adapters close children before resolving. Keep a lease if a broken adapter ignores abort.
          // Windows termination has a 1s forced-kill fallback; allow its close event to arrive.
          cleanupTimer = setTimeout(
            () => reject(controller.signal.reason),
            2000,
          )
        }
        controller.signal.addEventListener('abort', abort, { once: true })
        removeAbortListener = () =>
          controller.signal.removeEventListener('abort', abort)
        if (controller.signal.aborted) abort()
      })
      const output = await Promise.race([executing, interrupted])
      controller.signal.throwIfAborted()
      const validated = publicToolJson(tool.parseOutput(output))
      if (active(current()))
        this.command({
          type: 'completeToolExecution',
          executionId,
          output: validated,
        })
    } catch (error) {
      if (active(current()))
        this.command({
          type: 'failToolExecution',
          executionId,
          error: this.error(
            controller.signal.aborted ? controller.signal.reason : error,
            'TOOL_FAILED',
          ),
        })
    } finally {
      clearTimeout(timer)
      if (cleanupTimer) clearTimeout(cleanupTimer)
      removeAbortListener()
    }
    return current()
  }

  private error(error: unknown, fallback: string): ToolErrorData {
    const safeMessage = 'Tool execution could not be validated or completed.'
    if (!(error instanceof ToolFault))
      return { code: fallback, message: safeMessage }
    const code = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/u.test(error.code)
      ? error.code
      : fallback
    const message = redactToolText(error.message)
      // oxlint-disable-next-line no-control-regex -- Runtime audit text must exclude controls.
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .trim()
      .slice(0, 512)
    return { code, message: message || safeMessage }
  }
}
