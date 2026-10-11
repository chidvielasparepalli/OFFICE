import type { OfficeRuntime } from '../runtime/officeRuntime'
import type { ToolExecutor } from '../tools/ToolExecutor'
import { QAFault, type QARequest, type QARequestInput } from './qaTypes'

/** Runtime owns QA history. This service only coordinates explicit tool invocations. */
export class QAEngine {
  private readonly options: { runtime: OfficeRuntime; executor: ToolExecutor }
  private readonly inflight = new Map<
    string,
    { verifierAgentId: string; promise: Promise<QARequest> }
  >()

  constructor(options: { runtime: OfficeRuntime; executor: ToolExecutor }) {
    this.options = options
  }

  request(input: QARequestInput): QARequest {
    const before = this.options.runtime.getSnapshot().qaRequests
    const result = this.options.runtime.dispatch({
      type: 'requestQA',
      request: input,
    })
    if (!result.ok) throw new QAFault(result.error.code, result.error.message)
    const request = Object.values(result.state.qaRequests).find(
      (qa) => !Object.hasOwn(before, qa.qaId),
    )
    if (!request)
      throw new QAFault('QA_NOT_CREATED', 'No QA request was created.')
    return request
  }

  run(qaId: string, verifierAgentId: string): Promise<QARequest> {
    const active = this.inflight.get(qaId)
    if (active)
      return active.verifierAgentId === verifierAgentId
        ? active.promise
        : Promise.reject(
            new QAFault(
              'QA_VERIFIER_CONFLICT',
              'QA already has a different verifier.',
            ),
          )
    const promise = Promise.resolve()
      .then(() => this.execute(qaId, verifierAgentId))
      .finally(() => this.inflight.delete(qaId))
    this.inflight.set(qaId, { verifierAgentId, promise })
    return promise
  }

  private current(qaId: string): QARequest {
    const requests = this.options.runtime.getSnapshot().qaRequests
    if (!Object.hasOwn(requests, qaId))
      throw new QAFault('QA_NOT_FOUND', 'QA request does not exist.')
    return requests[qaId]
  }

  private async execute(
    qaId: string,
    verifierAgentId: string,
  ): Promise<QARequest> {
    const { runtime, executor } = this.options
    const previous = this.current(qaId)
    if (!['queued', 'running'].includes(previous.status)) return previous
    const started = runtime.dispatch({ type: 'startQA', qaId, verifierAgentId })
    if (!started.ok)
      throw new QAFault(started.error.code, started.error.message)
    const request = this.current(qaId)
    for (const check of request.checks) {
      if (
        runtime.getSnapshot().connection !== 'local' ||
        this.current(qaId).status !== 'running'
      )
        return this.current(qaId)
      try {
        await executor.execute({
          executionId: request.executionIds[check.checkId],
          agentId: verifierAgentId,
          taskId: request.inspectionTaskId!,
          toolId: check.toolId,
          input: check.input,
        })
      } catch {
        // Missing evidence blocks QA; never turn an executor exception into success.
        break
      }
    }
    if (
      runtime.getSnapshot().connection !== 'local' ||
      this.current(qaId).status !== 'running'
    )
      return this.current(qaId)
    const completed = runtime.dispatch({ type: 'completeQA', qaId })
    if (!completed.ok)
      throw new QAFault(completed.error.code, completed.error.message)
    return this.current(qaId)
  }
}
