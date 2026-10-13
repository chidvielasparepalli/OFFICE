import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { memoryObject } from '../../src/memory/memoryPolicy'
import { RealtimePublisher } from '../../src/realtime/RealtimePublisher'
import { createRealtimeProjection } from '../realtime/publication'
import { openRealtimeStream } from '../preview/realtimeStream'
import { parsePreviewAction } from '../preview/plugin'
import { ToolFault } from '../../src/tools/toolTypes'
import type { RecruitmentSpec } from '../../src/recruitment/recruitmentTypes'
import { CeoAuth } from './CeoAuth'
import { LocalRuntimeRepository } from './LocalRuntimeRepository'
import { RecruitmentService, RECRUITMENT_MANAGER } from './RecruitmentService'
import { RECRUITMENT_MODEL } from './OpenAIResponsesAdapter'

const PREFIX = '/__recruitment/'
const MAX_FINITE_RESPONSE_BYTES = 4_000_000
const denied = () =>
  new ToolFault(
    'RECRUITMENT_REQUEST_DENIED',
    'The request is not authorized or valid.',
  )
function privateFileRequest(
  url: string,
  root: string,
  publicDirectory: string,
  directory: string,
) {
  let pathname = url.split(/[?#]/u)[0] ?? ''
  // Deny before Vite transforms imports or normalizes encoded separators / Windows path aliases.
  for (let count = 0; count < 4; count += 1) {
    try {
      const decoded = decodeURIComponent(pathname)
      if (decoded === pathname) break
      pathname = decoded
    } catch {
      return true
    }
  }
  pathname = pathname.replaceAll('\\', '/')
  const requested = pathname.startsWith('/@fs/')
    ? [pathname.slice(5)]
    : [
        path.resolve(root, `.${pathname}`),
        ...(publicDirectory
          ? [path.resolve(publicDirectory, `.${pathname}`)]
          : []),
      ]
  let privateDirectory = directory
  try {
    privateDirectory = realpathSync.native(directory)
  } catch {
    /* The protected directory may not be provisioned yet. */
  }
  const within = (candidate: string) => {
    return [directory, privateDirectory].some((protectedRoot) => {
      const relative = path.relative(protectedRoot, candidate)
      return (
        relative === '' ||
        (!path.isAbsolute(relative) &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`))
      )
    })
  }
  return requested.some((candidate) => {
    if (within(path.resolve(candidate))) return true
    try {
      return within(realpathSync.native(candidate))
    } catch {
      return false
    }
  })
}
export function isRecruitmentLocalRequest(
  request: IncomingMessage,
  port: number,
) {
  const host = request.headers.host
  return (
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      request.socket.remoteAddress ?? '',
    ) &&
    [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(
      host ?? '',
    ) &&
    request.headers.origin === `http://${host}` &&
    request.headers['x-office-recruitment'] === '1' &&
    !request.headers.forwarded &&
    !request.headers['x-forwarded-host'] &&
    !request.headers['x-forwarded-for']
  )
}
async function readBody(request: IncomingMessage) {
  if (
    !request.headers['content-type']?.startsWith('application/json') ||
    Number(request.headers['content-length'] ?? 0) > 65536
  )
    throw denied()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > 65536) throw denied()
    chunks.push(data)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw denied()
  }
}
export async function recruitmentAction(
  service: RecruitmentService,
  value: unknown,
) {
  const action = memoryObject(value, [
    'action',
    'spec',
    'recruitmentId',
    'version',
    'decision',
    'reason',
    'employeeId',
    'command',
    'intentId',
    'prompt',
  ]).action
  const allowed: Record<string, readonly string[]> = {
    request: ['spec'],
    revise: ['recruitmentId', 'spec'],
    decide: ['recruitmentId', 'version', 'decision', 'reason'],
    start: ['recruitmentId'],
    retry: ['recruitmentId'],
    cancel: ['recruitmentId'],
    terminate: ['employeeId', 'reason'],
    feedback: ['command'],
    arrival: ['recruitmentId', 'intentId'],
    'employee-task': ['employeeId', 'prompt'],
  }
  if (typeof action !== 'string' || !Object.hasOwn(allowed, action))
    throw denied()
  const input = memoryObject(value, ['action', ...allowed[action]])
  service.public(input, 40000)
  const text = (key: string, max = 200) => {
    const result = input[key]
    if (typeof result !== 'string' || !result.trim() || result.length > max)
      throw denied()
    return result
  }
  switch (action) {
    case 'request':
      return { recruitmentId: service.request(input.spec as RecruitmentSpec) }
    case 'revise':
      service.revise(text('recruitmentId'), input.spec as RecruitmentSpec)
      break
    case 'decide': {
      if (
        !Number.isSafeInteger(input.version) ||
        !['approve', 'reject', 'changes'].includes(String(input.decision))
      )
        throw denied()
      service.decide(
        text('recruitmentId'),
        input.version as number,
        input.decision as 'approve' | 'reject' | 'changes',
        text('reason', 2000),
      )
      break
    }
    case 'start':
      service.start(text('recruitmentId'))
      break
    case 'retry':
      service.retry(text('recruitmentId'))
      break
    case 'cancel':
      service.cancel(text('recruitmentId'))
      break
    case 'terminate':
      service.terminate(text('employeeId'), text('reason', 2000))
      break
    case 'arrival':
      service.arrival(text('recruitmentId'), text('intentId'))
      break
    case 'employee-task':
      await service.employeeTask(text('employeeId'), text('prompt', 8000))
      break
    case 'feedback': {
      const parsed = parsePreviewAction(value)
      if (parsed.action !== 'feedback') throw denied()
      service.feedback(parsed.command)
      break
    }
  }
  return {}
}

/** Same Vite host boundary as Phase 7; no extra server framework or browser-held authority. */
export function createRecruitmentPlugin(
  options: { readonly directory?: string } = {},
): Plugin {
  return {
    name: 'office-local-recruitment',
    apply: 'serve',
    configureServer(server) {
      const directory = path.resolve(
        options.directory ?? path.join(server.config.root, '.office.local'),
      )
      let auth: CeoAuth | null = null
      let repository: LocalRuntimeRepository | null = null
      let service: RecruitmentService | null = null
      let publisher: RealtimePublisher | null = null
      const streamId = randomUUID()
      const closers = new Set<() => void>()
      const closeStreams = () => {
        for (const close of [...closers]) close()
        closers.clear()
      }
      const loadAuth = () => {
        auth ??= CeoAuth.fromDirectory(directory)
        return auth
      }
      const host = (ceoId: string) => {
        if (!service) {
          repository = new LocalRuntimeRepository({ directory })
          try {
            service = new RecruitmentService({
              repository,
              ceoId,
              credential: process.env.OPENAI_API_KEY,
              ...(process.env.OFFICE_PROVIDER_BUDGET_MICROS
                ? {
                    globalBudgetMicros: Number(
                      process.env.OFFICE_PROVIDER_BUDGET_MICROS,
                    ),
                  }
                : {}),
            })
            publisher = new RealtimePublisher({
              runtime: service.runtime,
              streamId,
              project: createRealtimeProjection({
                principalAgentId: RECRUITMENT_MANAGER,
                recruitmentCeo: true,
                memoryPolicy: { grants: [] },
                artifactPolicy: { grants: [] },
                assertPublic: service.public.bind(service),
              }),
            })
          } catch (error) {
            repository.close()
            repository = null
            service = null
            throw error
          }
        }
        return service
      }
      server.httpServer?.once('close', () => {
        closeStreams()
        publisher?.dispose()
        void service?.close().finally(() => repository?.close())
      })
      server.middlewares.use(async (request, response, next) => {
        if (
          privateFileRequest(
            request.url ?? '',
            server.config.root,
            server.config.publicDir,
            directory,
          )
        ) {
          response.statusCode = 403
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Content-Type', 'text/plain')
          response.end('Private host data is not public.')
          return
        }
        if (!request.url?.startsWith(PREFIX)) return next()
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader('Content-Type', 'application/json')
        const send = (value: unknown) => {
          const body = Buffer.from(JSON.stringify(value), 'utf8')
          if (body.byteLength > MAX_FINITE_RESPONSE_BYTES)
            throw new ToolFault(
              'RECRUITMENT_RESPONSE_TOO_LARGE',
              'The finite recruitment response exceeds its safe size limit.',
            )
          // Finite JSON has a bounded native browser body consumer; streams use separate framing.
          response.setHeader('Cache-Control', 'no-store, no-transform')
          response.removeHeader('Content-Encoding')
          response.removeHeader('Transfer-Encoding')
          response.setHeader('Content-Length', body.byteLength)
          return response.end(body)
        }
        try {
          const address = server.httpServer?.address()
          if (
            request.method !== 'POST' ||
            !address ||
            typeof address === 'string' ||
            !isRecruitmentLocalRequest(request, address.port)
          )
            throw denied()
          const route = request.url.slice(PREFIX.length)
          const body = await readBody(request)
          if (route === 'status') {
            memoryObject(body, [])
            let configured = false
            try {
              loadAuth()
              configured = true
            } catch {
              /* Host account has not been provisioned. */
            }
            const principal = auth?.authenticate(request.headers.cookie)
            return send({
              configured,
              authenticated: !!principal,
              ceoId: principal?.id ?? null,
              openaiAvailable: !!process.env.OPENAI_API_KEY,
              modelId: RECRUITMENT_MODEL,
            })
          }
          if (route === 'login') {
            const input = memoryObject(body, ['password'])
            if (typeof input.password !== 'string') throw denied()
            const result = await loadAuth().login(
              input.password,
              request.socket.remoteAddress ?? 'local',
            )
            response.setHeader('Set-Cookie', result.setCookie)
            return send({ ok: true })
          }
          const principal = loadAuth().authenticate(request.headers.cookie)
          if (!principal) {
            response.statusCode = 401
            throw denied()
          }
          if (route === 'logout') {
            memoryObject(body, [])
            response.setHeader(
              'Set-Cookie',
              loadAuth().logout(request.headers.cookie),
            )
            closeStreams()
            return send({ ok: true })
          }
          const current = host(principal.id)
          if (route === 'action') {
            const result = await recruitmentAction(current, body)
            return send({ ok: true, ...result })
          }
          memoryObject(body, [])
          if (route === 'connect')
            return send({ type: 'realtime-ready', streamId })
          if (route === 'snapshot') return send(publisher!.snapshot())
          if (route === 'stream') {
            if (closers.size >= 8) throw denied()
            return openRealtimeStream(
              {
                streamId,
                subscribe: (message, closed) => {
                  const stop = () => {
                    closed()
                    closers.delete(stop)
                  }
                  closers.add(stop)
                  const unsubscribe = publisher!.subscribe((envelope) => {
                    if (!auth?.authenticate(request.headers.cookie)) stop()
                    else message(envelope)
                  }, stop)
                  return () => {
                    unsubscribe()
                    closers.delete(stop)
                  }
                },
              },
              response,
            )
          }
          throw denied()
        } catch (error) {
          if (response.headersSent) {
            if (!response.writableEnded) response.end()
            return
          }
          if (response.statusCode < 400) response.statusCode = 400
          const code =
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string' &&
            /^[A-Z_]{1,80}$/u.test(error.code)
              ? error.code
              : 'RECRUITMENT_UNAVAILABLE'
          send({
            ok: false,
            code,
            message:
              'The recruitment request could not be completed. Check authentication, configuration and the recorded recruitment status.',
          })
        }
      })
    },
  }
}
