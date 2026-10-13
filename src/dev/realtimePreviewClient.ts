import { RealtimeStore } from '../realtime/RealtimeStore'
import type {
  RealtimeConnection,
  RealtimeObserver,
  RealtimeTransport,
} from '../realtime/realtimeTypes'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import type {
  RealtimePreviewAction,
  RealtimePreviewHello,
} from './realtimePreviewProtocol'

const PREFIX = '/__tools-preview/'
const MAX_MESSAGE = 4_000_000
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const failure = (message: string): RuntimeResult => ({
  ok: false,
  error: { code: 'HOST_TRANSPORT', message },
})

/** Guarded local adapter only; no authority, tool input, secret or business mutation is supplied by the browser. */
export class RealtimePreviewTransport implements RealtimeTransport {
  private sessionId: string | null = null
  private streamId: string | null = null
  private fetcher: typeof fetch
  private controllers = new Set<AbortController>()
  private connections = new Map<AbortController, () => void>()
  private readonly timeoutMs: number
  constructor(fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
    this.fetcher = fetcher.bind(globalThis)
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new Error('Invalid transport timeout.')
    this.timeoutMs = timeoutMs
  }
  private async boundedOne(
    endpoint: string,
    input: unknown,
    parent?: AbortSignal,
  ) {
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = () => controller.abort()
    const timer = setTimeout(abort, this.timeoutMs)
    parent?.addEventListener('abort', abort, { once: true })
    if (parent?.aborted) controller.abort()
    try {
      return await this.one(endpoint, input, controller.signal)
    } finally {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
      this.controllers.delete(controller)
    }
  }
  private async post(endpoint: string, input: unknown, signal?: AbortSignal) {
    const response = await this.fetcher(`${PREFIX}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tools-Preview': '1',
        ...(this.sessionId ? { 'X-Tools-Session': this.sessionId } : {}),
      },
      body: JSON.stringify(input),
      signal,
    })
    if (!response.ok || !response.body)
      throw new Error(
        'The local host rejected the development transport request.',
      )
    return response
  }
  private async one(
    endpoint: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.post(endpoint, input, signal)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        if (text.length > MAX_MESSAGE)
          throw new Error(
            'The host response exceeded the bounded message limit.',
          )
      }
      text += decoder.decode()
      const value: unknown = JSON.parse(text.trim())
      if (object(value) && value.type === 'error')
        throw new Error('The host rejected the named development operation.')
      return value
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  async connect(observer: RealtimeObserver): Promise<RealtimeConnection> {
    const controller = new AbortController()
    this.controllers.add(controller)
    let ended = false
    const close = () => {
      ended = true
      controller.abort()
      this.controllers.delete(controller)
      this.connections.delete(controller)
    }
    this.connections.set(controller, close)
    const setupTimer = setTimeout(close, this.timeoutMs)
    try {
      if (!this.sessionId) {
        const hello = await this.one(
          'connect',
          { mode: 'realtime' },
          controller.signal,
        )
        controller.signal.throwIfAborted()
        if (
          !object(hello) ||
          hello.type !== 'realtime-ready' ||
          typeof hello.sessionId !== 'string' ||
          typeof hello.streamId !== 'string'
        )
          throw new Error('The host did not establish a realtime session.')
        this.sessionId = hello.sessionId
        this.streamId = hello.streamId
      }
      const response = await this.post('stream', {}, controller.signal)
      controller.signal.throwIfAborted()
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let ready!: (hello: RealtimePreviewHello) => void
      let rejectReady!: (error: Error) => void
      let awaitingHello = true
      const helloPromise = new Promise<RealtimePreviewHello>(
        (resolve, reject) => {
          ready = resolve
          rejectReady = reject
        },
      )
      void (async () => {
        try {
          while (!ended) {
            const { value, done } = await reader.read()
            if (done) break
            pending += decoder.decode(value, { stream: true })
            if (pending.length > MAX_MESSAGE)
              throw new Error(
                'The realtime message exceeds the bounded transport limit.',
              )
            let end: number
            while ((end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end)
              pending = pending.slice(end + 1)
              if (!line.trim()) continue
              const value: unknown = JSON.parse(line)
              if (awaitingHello) {
                if (
                  !object(value) ||
                  value.type !== 'realtime-ready' ||
                  value.streamId !== this.streamId ||
                  value.sessionId !== this.sessionId
                )
                  throw new Error('The stream identity changed unexpectedly.')
                ready(value as unknown as RealtimePreviewHello)
                awaitingHello = false
              } else observer.message(value)
            }
          }
          if (pending.trim())
            throw new Error('The stream ended with a partial message.')
          rejectReady(
            new Error('The stream ended before subscription was ready.'),
          )
        } catch {
          rejectReady(new Error('The local realtime stream could not be read.'))
        } finally {
          this.controllers.delete(controller)
          this.connections.delete(controller)
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
          if (!ended) observer.closed()
        }
      })()
      const hello = await helloPromise
      return {
        streamId: hello.streamId,
        requestSnapshot: () =>
          this.boundedOne('snapshot', {}, controller.signal),
        close,
      }
    } catch (error) {
      close()
      throw error
    } finally {
      clearTimeout(setupTimer)
    }
  }
  async action(input: RealtimePreviewAction) {
    if (!this.sessionId)
      throw new Error('Connect to the local host before sending an action.')
    const result = await this.boundedOne('action', input)
    if (
      !object(result) ||
      result.type !== 'result' ||
      result.ok !== true ||
      typeof result.message !== 'string'
    )
      throw new Error('The host did not acknowledge the action.')
    return result.message
  }
  closeConnections() {
    for (const close of [...this.connections.values()]) close()
  }
  reset() {
    this.closeConnections()
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    this.sessionId = null
    this.streamId = null
  }
}

type SpatialFeedback = Extract<
  RuntimeCommand,
  { type: 'arrive' | 'rejectMovement' }
>

/** Only the shared RealtimeStore projects state. This wrapper sends exact-ID scene feedback to the host. */
export class RealtimePreviewClient {
  readonly transport: RealtimePreviewTransport
  readonly store: RealtimeStore
  private pending = new Map<string, SpatialFeedback>()
  private inFlight = new Set<string>()
  private unsubscribe: () => void
  constructor(fetcher: typeof fetch = fetch) {
    this.transport = new RealtimePreviewTransport(fetcher)
    this.store = new RealtimeStore(this.transport, {
      reconnectDelayMs: 250,
      maxReconnectAttempts: 3,
    })
    this.unsubscribe = this.store.subscribe(() => this.flushFeedback())
  }
  getSnapshot = () => this.store.getSnapshot()
  getView = () => this.store.getView()
  getConnection = () => this.store.getConnection()
  subscribe = (listener: () => void) => this.store.subscribe(listener)
  getMetrics = () => ({
    projection: this.store.getMetrics(),
    pendingSpatialFeedback: this.pending.size,
  })
  connect = () => this.store.connect()
  disconnect = () => {
    this.store.disconnect()
    this.transport.closeConnections()
  }
  reconnect = () => {
    this.transport.closeConnections()
    return this.store.reconnect()
  }
  resume = () => this.store.resume()
  action = (input: RealtimePreviewAction) => this.transport.action(input)
  async reset() {
    this.disconnect()
    this.transport.reset()
    this.pending.clear()
    await this.store.connect()
  }
  canAccessArtifact = (
    _agentId: string,
    artifactId: string,
    permission: 'read' | 'modify' | 'archive',
  ) => permission === 'read' && !!this.getSnapshot().artifacts[artifactId]
  dispatch = async (command: RuntimeCommand): Promise<RuntimeResult> => {
    if (
      !['selectAgent', 'selectTask', 'arrive', 'rejectMovement'].includes(
        command.type,
      )
    )
      return failure('The 3D layer cannot send business commands.')
    const feedback = command as Extract<
      RuntimeCommand,
      { type: 'selectAgent' | 'selectTask' | 'arrive' | 'rejectMovement' }
    >
    const spatial =
      feedback.type === 'arrive' || feedback.type === 'rejectMovement'
    if (spatial) {
      if (this.pending.size >= 100 && !this.pending.has(feedback.agentId))
        return failure('The bounded feedback queue is full.')
      this.pending.set(feedback.agentId, feedback)
    }
    if (this.store.getConnection().status !== 'connected')
      return failure(
        'Realtime is disconnected; spatial feedback is retained for authoritative resynchronization.',
      )
    if (spatial) return this.sendSpatial(feedback)
    try {
      await this.transport.action({ action: 'feedback', command: feedback })
      return { ok: true, state: this.getSnapshot() }
    } catch {
      return failure('Selection could not be delivered to the host.')
    }
  }
  private async sendSpatial(command: SpatialFeedback): Promise<RuntimeResult> {
    if (this.inFlight.has(command.agentId))
      return failure('The exact spatial feedback is already in flight.')
    this.inFlight.add(command.agentId)
    try {
      if (
        this.getSnapshot().agents[command.agentId]?.destination?.id !==
        command.intentId
      ) {
        this.pending.delete(command.agentId)
        return failure(
          'The resynchronized host no longer has this movement intent.',
        )
      }
      await this.transport.action({ action: 'feedback', command })
      if (this.pending.get(command.agentId) === command)
        this.pending.delete(command.agentId)
      return { ok: true, state: this.getSnapshot() }
    } catch {
      return failure(
        'Spatial feedback awaits a connected authoritative snapshot.',
      )
    } finally {
      this.inFlight.delete(command.agentId)
    }
  }
  private flushFeedback() {
    if (this.store.getConnection().status !== 'connected') return
    for (const command of this.pending.values()) {
      if (
        this.getSnapshot().agents[command.agentId]?.destination?.id !==
        command.intentId
      )
        this.pending.delete(command.agentId)
      else if (!this.inFlight.has(command.agentId))
        void this.sendSpatial(command)
    }
  }
  dispose() {
    this.unsubscribe()
    this.store.dispose()
    this.transport.reset()
    this.pending.clear()
  }
}
