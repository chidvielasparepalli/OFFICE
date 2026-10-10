import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type {
  ToolPreviewAction,
  ToolPreviewMessage,
} from '../../src/dev/toolPreviewProtocol'
import { ToolFault } from '../../src/tools/toolTypes'
import { createPreviewSession, type PreviewSession } from './session'

const PREFIX = '/__tools-preview/'
const MAX_BODY_BYTES = 16_384
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ToolFault(
      'INVALID_REQUEST',
      'Unexpected request fields are not accepted.',
    )
}
function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/** Validate a small command grammar; no browser-controlled tool input or authority exists. */
export function parsePreviewAction(value: unknown): ToolPreviewAction {
  if (!object(value) || !text(value.action))
    throw new ToolFault('INVALID_REQUEST', 'An explicit action is required.')
  if (value.action === 'prepare') {
    fields(value, ['action', 'scenario'])
    if (
      typeof value.scenario !== 'string' ||
      !['research', 'coding', 'git', 'denied', 'timeout'].includes(
        value.scenario,
      )
    )
      throw new ToolFault('INVALID_REQUEST', 'Unknown scenario.')
  } else if (value.action === 'execute') {
    fields(value, ['action', 'operation'])
    if (
      typeof value.operation !== 'string' ||
      ![
        'research',
        'read',
        'terminal',
        'git-status',
        'git-diff',
        'git-add',
        'git-commit',
        'denied',
        'timeout',
        'cancellable',
      ].includes(value.operation)
    )
      throw new ToolFault('INVALID_REQUEST', 'Unknown operation.')
  } else if (value.action === 'feedback') {
    fields(value, ['action', 'command'])
    const command = value.command
    if (!object(command))
      throw new ToolFault('INVALID_REQUEST', 'Missing scene feedback.')
    if (command.type === 'selectAgent' || command.type === 'selectTask') {
      const key = command.type === 'selectAgent' ? 'agentId' : 'taskId'
      fields(command, ['type', key])
      if (command[key] !== null && !text(command[key]))
        throw new ToolFault('INVALID_REQUEST', 'Invalid selection.')
    } else if (command.type === 'arrive' || command.type === 'rejectMovement') {
      fields(
        command,
        command.type === 'arrive'
          ? ['type', 'agentId', 'intentId', 'position', 'headingRadians']
          : ['type', 'agentId', 'intentId', 'reason'],
      )
      if (!text(command.agentId) || !text(command.intentId))
        throw new ToolFault('INVALID_REQUEST', 'Invalid movement identity.')
      if (
        command.type === 'arrive' &&
        (!Array.isArray(command.position) ||
          command.position.length !== 3 ||
          !command.position.every(
            (number) =>
              typeof number === 'number' &&
              Number.isFinite(number) &&
              Math.abs(number) < 100,
          ) ||
          typeof command.headingRadians !== 'number' ||
          !Number.isFinite(command.headingRadians))
      )
        throw new ToolFault('INVALID_REQUEST', 'Invalid spatial coordinates.')
      if (command.type === 'rejectMovement' && !text(command.reason, 1000))
        throw new ToolFault('INVALID_REQUEST', 'Invalid movement diagnostic.')
    } else
      throw new ToolFault(
        'COMMAND_DENIED',
        'Only selection and discrete spatial feedback are accepted.',
      )
  } else {
    fields(value, ['action'])
    if (
      !['complete', 'resume', 'cancel', 'disconnect', 'reconnect'].includes(
        value.action,
      )
    )
      throw new ToolFault('INVALID_REQUEST', 'Unknown action.')
  }
  return value as unknown as ToolPreviewAction
}

export function isLocalRequest(
  request: IncomingMessage,
  port: number,
): boolean {
  const host = request.headers.host
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  const address = request.socket.remoteAddress
  return (
    !!host &&
    allowed.includes(host) &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') &&
    request.headers.origin === `http://${host}` &&
    request.headers['x-tools-preview'] === '1' &&
    !request.headers.forwarded &&
    !request.headers['x-forwarded-host']
  )
}
async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ToolFault('INVALID_REQUEST', 'JSON content type is required.')
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES)
    throw new ToolFault('PAYLOAD_LIMIT', 'Request body is too large.')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES)
      throw new ToolFault('PAYLOAD_LIMIT', 'Request body is too large.')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new ToolFault(
      'INVALID_REQUEST',
      'Request body must contain valid JSON.',
    )
  }
}
function fail(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
) {
  if (!response.headersSent) {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/x-ndjson')
    response.setHeader('Cache-Control', 'no-store')
  }
  response.end(`${JSON.stringify({ type: 'error', code, message })}\n`)
}

/** configureServer only: absent from Vite production preview and generated client assets. */
export function createToolsPreviewPlugin(): Plugin {
  let session: PreviewSession | null = null
  let connecting = false
  let lastUse = 0
  let closed = false
  let creating: Promise<PreviewSession> | null = null
  let closing: Promise<void> | null = null
  const close = () => {
    if (closing) return closing
    closed = true
    closing = (async () => {
      await session?.dispose()
      const pending = await creating?.catch(() => null)
      await pending?.dispose()
      session = null
    })()
    return closing
  }
  return {
    name: 'office-development-tools-preview',
    apply: 'serve',
    closeBundle: close,
    configureServer(server) {
      server.httpServer?.once('close', () => {
        void close()
      })
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(PREFIX)) {
          next()
          return
        }
        void (async () => {
          const address = server.httpServer?.address()
          if (
            !address ||
            typeof address === 'string' ||
            !isLocalRequest(request, address.port)
          ) {
            fail(
              response,
              403,
              'ORIGIN_DENIED',
              'Only the local same-origin development preview may send commands.',
            )
            return
          }
          if (request.method !== 'POST') {
            fail(response, 405, 'METHOD_DENIED', 'Use an explicit POST action.')
            return
          }
          const data = await body(request)
          if (request.url === `${PREFIX}connect`) {
            if (!object(data) || Object.keys(data).length)
              throw new ToolFault(
                'INVALID_REQUEST',
                'Connect takes no browser-supplied configuration.',
              )
            if (connecting)
              throw new ToolFault(
                'BUSY',
                'A development session is already being created.',
              )
            connecting = true
            try {
              creating = createPreviewSession(server.config.root)
              const created = await creating
              if (closed || response.destroyed) {
                await created.dispose()
                throw new ToolFault(
                  'SESSION_CLOSED',
                  'Connection ended before the session was ready.',
                )
              }
              await session?.dispose()
              if (closed || response.destroyed) {
                await created.dispose()
                throw new ToolFault(
                  'SESSION_CLOSED',
                  'Connection ended before the session was ready.',
                )
              }
              session = created
              lastUse = Date.now()
              response.setHeader('Content-Type', 'application/x-ndjson')
              response.setHeader('Cache-Control', 'no-store')
              response.end(
                `${JSON.stringify({ type: 'snapshot', snapshot: created.snapshot() })}\n${JSON.stringify({ type: 'result', ok: true, message: 'Connected to a new disposable host session.' })}\n`,
              )
            } finally {
              connecting = false
              creating = null
            }
            return
          }
          if (request.url !== `${PREFIX}action`)
            throw new ToolFault(
              'UNKNOWN_ENDPOINT',
              'Unknown development endpoint.',
            )
          if (
            !session ||
            request.headers['x-tools-session'] !== session.sessionId
          ) {
            fail(
              response,
              403,
              'SESSION_DENIED',
              'Connect to your own development session first.',
            )
            return
          }
          if (Date.now() - lastUse > 30 * 60_000) {
            await session.dispose()
            session = null
            throw new ToolFault(
              'SESSION_EXPIRED',
              'The idle development session expired. Connect again.',
            )
          }
          lastUse = Date.now()
          const action = parsePreviewAction(data)
          const current = session
          response.setHeader('Content-Type', 'application/x-ndjson')
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          const write = (message: ToolPreviewMessage) => {
            if (!response.destroyed && !response.writableEnded)
              response.write(`${JSON.stringify(message)}\n`)
          }
          const unsubscribe = current.runtime.subscribe(() =>
            write({ type: 'snapshot', snapshot: current.snapshot() }),
          )
          let complete = false
          response.once('close', () => {
            unsubscribe()
            if (!complete && action.action === 'execute')
              current.cancelRunning()
          })
          try {
            write({ type: 'snapshot', snapshot: current.snapshot() })
            const message = await current.action(action)
            write({ type: 'snapshot', snapshot: current.snapshot() })
            write({ type: 'result', ok: true, message })
          } finally {
            complete = true
            unsubscribe()
          }
          response.end()
        })().catch((error: unknown) =>
          fail(
            response,
            400,
            error instanceof ToolFault ? error.code : 'HOST_ERROR',
            error instanceof ToolFault
              ? error.message
              : 'The host could not complete the development action.',
          ),
        )
      })
    },
  }
}
