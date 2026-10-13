import { RealtimeStore } from '../realtime/RealtimeStore'
import type {
  RealtimeConnection,
  RealtimeObserver,
  RealtimeTransport,
} from '../realtime/realtimeTypes'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import type { RecruitmentSpec } from './recruitmentTypes'

export interface RecruitmentHostStatus {
  authenticated: boolean
  configured: boolean
  ceoId: string | null
  openaiAvailable: boolean
  modelId: string
}
export type RecruitmentAction =
  | { action: 'request'; spec: RecruitmentSpec }
  | { action: 'revise'; recruitmentId: string; spec: RecruitmentSpec }
  | {
      action: 'decide'
      recruitmentId: string
      version: number
      decision: 'approve' | 'reject' | 'changes'
      reason: string
    }
  | { action: 'start' | 'retry' | 'cancel'; recruitmentId: string }
  | { action: 'terminate'; employeeId: string; reason: string }
  | { action: 'employee-task'; employeeId: string; prompt: string }
  | { action: 'feedback'; command: RuntimeCommand }
  | { action: 'arrival'; recruitmentId: string; intentId: string }

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const MAX_MESSAGE = 4_000_000
const rejected = (): RuntimeResult => ({
  ok: false,
  error: {
    code: 'RECRUITMENT_TRANSPORT',
    message: 'The host has not accepted this scene acknowledgement.',
  },
})

/** Cookie-authenticated transport. No browser-supplied actor or permission grants exist. */
export class RecruitmentTransport implements RealtimeTransport {
  private readonly fetcher: typeof fetch
  private readonly controllers = new Set<AbortController>()
  constructor(fetcher: typeof fetch = fetch, privateTimeout = 10_000) {
    this.fetcher = fetcher.bind(globalThis)
    if (
      !Number.isFinite(privateTimeout) ||
      privateTimeout < 1 ||
      privateTimeout > 60_000
    )
      throw new Error('Invalid transport timeout.')
    this.timeout = privateTimeout
  }
  private readonly timeout: number
  private async post(endpoint: string, input: unknown, signal: AbortSignal) {
    const response = await this.fetcher(`/__recruitment/${endpoint}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Office-Recruitment': '1',
      },
      body: JSON.stringify(input),
      signal,
    })
    if (!response.ok || !response.body)
      throw new Error(
        'Recruitment request was denied or the authenticated host is unavailable.',
      )
    return response
  }
  async request(
    endpoint: 'login' | 'logout' | 'status' | 'connect' | 'snapshot' | 'action',
    input: unknown = {},
    parent?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = () => controller.abort()
    parent?.addEventListener('abort', abort, { once: true })
    if (parent?.aborted) abort()
    const timeout =
      endpoint === 'action' && record(input) && input.action === 'employee-task'
        ? 130_000
        : this.timeout
    const timer = setTimeout(abort, timeout)
    try {
      const response = await this.post(endpoint, input, controller.signal)
      const declared = response.headers.get('Content-Length')
      if (
        declared === null ||
        !/^(0|[1-9]\d*)$/u.test(declared) ||
        Number(declared) > MAX_MESSAGE ||
        response.headers.has('Content-Encoding') ||
        response.headers.has('Transfer-Encoding')
      ) {
        await response.body!.cancel().catch(() => undefined)
        throw new Error('Recruitment response has unsafe size or framing.')
      }
      // The local host supplies exact uncompressed HTTP framing. Native body
      // consumption avoids Chromium cancelling completed manual-reader fetches.
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength !== Number(declared))
        throw new Error(
          'Recruitment response does not match its declared size.',
        )
      let result: unknown
      try {
        result = JSON.parse(text)
      } catch {
        throw new Error('The recruitment host returned an invalid response.')
      }
      if (record(result) && (result.ok === false || result.type === 'error'))
        throw new Error(
          'The host rejected this recruitment operation; no successful transition was recorded.',
        )
      return result
    } finally {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
      this.controllers.delete(controller)
    }
  }
  async connect(observer: RealtimeObserver): Promise<RealtimeConnection> {
    const controller = new AbortController()
    this.controllers.add(controller)
    let closed = false
    const close = () => {
      closed = true
      controller.abort()
      this.controllers.delete(controller)
    }
    const timer = setTimeout(close, this.timeout)
    try {
      const hello = await this.request('connect', {}, controller.signal)
      if (
        !record(hello) ||
        hello.type !== 'realtime-ready' ||
        typeof hello.streamId !== 'string'
      )
        throw new Error('Recruitment stream identity is unavailable.')
      const response = await this.post('stream', {}, controller.signal)
      controller.signal.throwIfAborted()
      const reader = response.body!.getReader(),
        decoder = new TextDecoder()
      let ready!: () => void, fail!: (error: Error) => void
      const readyPromise = new Promise<void>((resolve, reject) => {
        ready = resolve
        fail = reject
      })
      void (async () => {
        let pending = '',
          awaiting = true
        try {
          while (!closed) {
            const { value, done } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            if (pending.length > MAX_MESSAGE)
              throw new Error('Bounded stream exceeded.')
            let end: number
            while ((end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end)
              pending = pending.slice(end + 1)
              if (!line.trim()) continue
              const message: unknown = JSON.parse(line)
              if (awaiting) {
                if (
                  !record(message) ||
                  message.type !== 'realtime-ready' ||
                  message.streamId !== hello.streamId
                )
                  throw new Error('Stream identity mismatch.')
                awaiting = false
                ready()
              } else observer.message(message)
            }
          }
          fail(new Error('Recruitment stream closed before it was ready.'))
        } catch {
          fail(new Error('Recruitment stream could not be read.'))
        } finally {
          this.controllers.delete(controller)
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
          if (!closed) observer.closed()
        }
      })()
      await readyPromise
      return {
        streamId: hello.streamId,
        close,
        requestSnapshot: () => this.request('snapshot', {}, controller.signal),
      }
    } catch (error) {
      close()
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  close() {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}

/** Reuses the Phase 12 cache. Only authenticated host events supply business state. */
export class RecruitmentClient {
  readonly transport: RecruitmentTransport
  private store: RealtimeStore
  private unsubscribe: () => void
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Map<string, RecruitmentAction>()
  private readonly inFlight = new Set<string>()
  constructor(fetcher: typeof fetch = fetch) {
    this.transport = new RecruitmentTransport(fetcher)
    this.store = new RealtimeStore(this.transport)
    this.unsubscribe = this.store.subscribe(this.changed)
  }
  private changed = () => {
    for (const listener of this.listeners) listener()
    if (this.getConnection().status === 'connected')
      for (const [id, action] of this.pending) {
        if (!this.current(action)) this.pending.delete(id)
        else if (!this.inFlight.has(id)) void this.sendFeedback(id, action)
      }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.store.getSnapshot()
  getConnection = () => this.store.getConnection()
  getMetrics = () => this.store.getMetrics()
  connect = () => this.store.connect()
  resume = () => this.store.resume()
  disconnect = () => {
    this.store.disconnect()
    this.transport.close()
  }
  async status(): Promise<RecruitmentHostStatus> {
    const value = await this.transport.request('status')
    if (
      !record(value) ||
      typeof value.authenticated !== 'boolean' ||
      typeof value.configured !== 'boolean' ||
      typeof value.openaiAvailable !== 'boolean' ||
      typeof value.modelId !== 'string' ||
      (value.ceoId !== null && typeof value.ceoId !== 'string')
    )
      throw new Error('Recruitment host status is unavailable.')
    return value as unknown as RecruitmentHostStatus
  }
  login = async (password: string) => {
    await this.transport.request('login', { password })
    return this.status()
  }
  async logout() {
    try {
      await this.transport.request('logout')
    } finally {
      this.disconnect()
      this.unsubscribe()
      this.store.dispose()
      this.pending.clear()
      this.store = new RealtimeStore(this.transport)
      this.unsubscribe = this.store.subscribe(this.changed)
      this.changed()
    }
  }
  action = async (action: RecruitmentAction) => {
    const result = await this.transport.request('action', action)
    if (!record(result) || result.ok !== true)
      throw new Error('The host has not confirmed this recruitment action.')
  }
  private current(action: RecruitmentAction) {
    if (action.action === 'arrival')
      return (
        this.getSnapshot().recruitments[action.recruitmentId]?.scene
          ?.intentId === action.intentId
      )
    if (
      action.action === 'feedback' &&
      (action.command.type === 'arrive' ||
        action.command.type === 'rejectMovement')
    )
      return (
        this.getSnapshot().agents[action.command.agentId]?.destination?.id ===
        action.command.intentId
      )
    return false
  }
  private async sendFeedback(
    id: string,
    action: RecruitmentAction,
  ): Promise<RuntimeResult> {
    if (this.inFlight.has(id)) return rejected()
    this.inFlight.add(id)
    try {
      if (!this.current(action)) {
        this.pending.delete(id)
        return rejected()
      }
      await this.action(action)
      if (this.pending.get(id) === action) this.pending.delete(id)
      return { ok: true, state: this.getSnapshot() }
    } catch {
      return rejected()
    } finally {
      this.inFlight.delete(id)
    }
  }
  private queue(id: string, action: RecruitmentAction) {
    if (this.pending.size >= 100 && !this.pending.has(id))
      return Promise.resolve(rejected())
    this.pending.set(id, action)
    return this.getConnection().status === 'connected'
      ? this.sendFeedback(id, action)
      : Promise.resolve(rejected())
  }
  arrival = (recruitmentId: string, intentId: string) =>
    this.queue(`candidate:${recruitmentId}`, {
      action: 'arrival',
      recruitmentId,
      intentId,
    })
  dispatch = async (command: RuntimeCommand): Promise<RuntimeResult> => {
    if (command.type === 'arrive' || command.type === 'rejectMovement')
      return this.queue(command.agentId, { action: 'feedback', command })
    if (command.type !== 'selectAgent' && command.type !== 'selectTask')
      return rejected()
    try {
      await this.action({ action: 'feedback', command })
      return { ok: true, state: this.getSnapshot() }
    } catch {
      return rejected()
    }
  }
  canAccessArtifact = (
    _agentId: string,
    artifactId: string,
    permission: string,
  ) => permission === 'read' && !!this.getSnapshot().artifacts[artifactId]
  dispose() {
    this.disconnect()
    this.unsubscribe()
    this.store.dispose()
    this.listeners.clear()
    this.pending.clear()
  }
}
