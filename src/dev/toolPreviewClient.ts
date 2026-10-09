import type { RuntimeOfficePort } from '../components/RuntimeOffice'
import type {
  RuntimeCommand,
  RuntimeResult,
  RuntimeState,
} from '../runtime/runtimeTypes'
import type {
  ToolPreviewAction,
  ToolPreviewMessage,
  ToolPreviewSnapshot,
} from './toolPreviewProtocol'

const emptyState = (): RuntimeState =>
  Object.freeze({
    connection: 'disconnected',
    revision: 0,
    agents: {},
    tasks: {},
    workstations: {},
    departments: {},
    requests: {},
    plans: {},
    toolExecutions: {},
    events: [],
    activities: [],
    selectedAgentId: null,
    selectedTaskId: null,
  })
const failure = (message: string): RuntimeResult => ({
  ok: false,
  error: { code: 'HOST_TRANSPORT', message },
})

class HostCommandError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.code = code
  }
}

/** Read-only host snapshot cache. It contains no reducer, grants, adapter or execution logic. */
export class ToolPreviewClient implements RuntimeOfficePort {
  private state = emptyState()
  // Presentation liveness only. The authoritative host snapshot remains untouched.
  private disconnectedPresentation: RuntimeState | null = null
  private view: ToolPreviewSnapshot | null = null
  private listeners = new Set<() => void>()
  private controllers = new Set<AbortController>()
  private generation = 0
  private messages = 0
  private fetcher: typeof fetch
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher.bind(globalThis)
  }
  getSnapshot = () => this.disconnectedPresentation ?? this.state
  getPreview = () => this.view
  getMetrics = () => ({
    mode: 'host snapshot cache',
    messages: this.messages,
    subscribers: this.listeners.size,
  })
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private notify() {
    for (const listener of this.listeners) listener()
  }

  connect = async () => {
    this.dispose()
    this.state = emptyState()
    this.disconnectedPresentation = null
    this.view = null
    this.notify()
    return this.send('connect', {})
  }
  action = (action: ToolPreviewAction) => {
    if (!this.view)
      return Promise.reject(
        new HostCommandError(
          'SESSION_REQUIRED',
          'Connect to a host session before requesting an action.',
        ),
      )
    return this.send('action', action)
  }
  dispatch = async (command: RuntimeCommand): Promise<RuntimeResult> => {
    if (!this.view || this.getSnapshot().connection !== 'local')
      return failure('Host runtime is disconnected; no scene command was sent.')
    if (
      command.type !== 'selectAgent' &&
      command.type !== 'selectTask' &&
      command.type !== 'arrive' &&
      command.type !== 'rejectMovement'
    )
      return failure(
        'The scene may only send selection and discrete movement feedback to the host.',
      )
    try {
      await this.action({ action: 'feedback', command })
      return { ok: true, state: this.state }
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : 'Host feedback failed.',
      )
    }
  }
  dispose = () => {
    this.generation++
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
  private accept(snapshot: ToolPreviewSnapshot, connecting: boolean) {
    if (
      !snapshot ||
      typeof snapshot.sessionId !== 'string' ||
      !snapshot.state ||
      !Number.isSafeInteger(snapshot.state.revision) ||
      snapshot.state.revision < 0
    )
      throw new Error('Invalid host snapshot.')
    if (!connecting && snapshot.sessionId !== this.view?.sessionId) return
    if (
      this.view?.sessionId === snapshot.sessionId &&
      snapshot.state.revision < this.state.revision
    )
      return
    // Reuse the prior state for equal revisions; metadata can finish changing after a commit.
    const state =
      this.view?.sessionId === snapshot.sessionId &&
      snapshot.state.revision === this.state.revision
        ? this.state
        : Object.freeze(snapshot.state)
    this.view = Object.freeze({ ...snapshot, state })
    this.state = state
    if (this.disconnectedPresentation)
      this.disconnectedPresentation = Object.freeze({
        ...state,
        connection: 'disconnected',
      })
    this.notify()
  }
  private async send(
    endpoint: 'connect' | 'action',
    input: object,
  ): Promise<string> {
    const generation = this.generation
    const controller = new AbortController()
    this.controllers.add(controller)
    let receivedResult = false
    let message = ''
    try {
      const response = await this.fetcher(`/__tools-preview/${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Tools-Preview': '1',
          ...(this.view ? { 'X-Tools-Session': this.view.sessionId } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      if (!response.body)
        throw new Error('The host returned no snapshot stream.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      const line = (text: string) => {
        if (!text.trim()) return
        const item = JSON.parse(text) as ToolPreviewMessage
        if (generation !== this.generation) return
        this.messages++
        if (item.type === 'snapshot')
          this.accept(item.snapshot, endpoint === 'connect')
        else if (item.type === 'error')
          throw new HostCommandError(item.code, item.message)
        else if (item.type === 'result') {
          receivedResult = true
          message = item.message
          if (!item.ok)
            throw new HostCommandError('ACTION_REJECTED', item.message)
        } else throw new Error('Unexpected host message.')
      }
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        if (pending.length > 4_000_000)
          throw new Error('Host snapshot exceeded the transport limit.')
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          line(pending.slice(0, end))
          pending = pending.slice(end + 1)
        }
      }
      pending += decoder.decode()
      line(pending)
      if (generation !== this.generation)
        throw new Error('This session was replaced.')
      if (!response.ok || !receivedResult)
        throw new Error('Host action ended without a confirmed result.')
      if (
        endpoint === 'connect' ||
        ('action' in input && input.action === 'reconnect')
      ) {
        this.disconnectedPresentation = null
        this.notify()
      }
      return message
    } catch (error) {
      const invalidSession =
        error instanceof HostCommandError &&
        ['SESSION_CLOSED', 'SESSION_EXPIRED', 'SESSION_DENIED'].includes(
          error.code,
        )
      if (
        generation === this.generation &&
        this.view &&
        (!(error instanceof HostCommandError) || invalidSession)
      ) {
        this.disconnectedPresentation = Object.freeze({
          ...this.state,
          connection: 'disconnected',
        })
        this.notify()
        throw new Error(
          `${error instanceof Error ? error.message : 'Host transport failed.'} Transport disconnected; records are retained history. Reconnect to resynchronize.`,
        )
      }
      throw error
    } finally {
      controller.abort()
      this.controllers.delete(controller)
    }
  }
}
