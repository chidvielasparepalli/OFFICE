// @vitest-environment node
import { scryptSync } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealtimeProjection } from '../realtime/publication'
import type { RuntimeState } from '../../src/runtime/runtimeTypes'
import type { RecruitmentSpec } from '../../src/recruitment/recruitmentTypes'
import type { RealtimeSnapshot } from '../../src/realtime/realtimeTypes'
import { createRecruitmentPlugin, isRecruitmentLocalRequest } from './plugin'
import { RecruitmentService } from './RecruitmentService'

const password = 'synthetic-http-test-passphrase-only'
const providerSecret = 'SYNTHETIC_HOST_HTTP_PRIVATE_ONLY'
const salt = 'ac'.repeat(16)
const config = {
  version: 1,
  id: 'test-ceo',
  salt,
  passwordHash: scryptSync(password, Buffer.from(salt, 'hex'), 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex'),
}
const servers: ViteDevServer[] = []
const directories: string[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function host(
  configured = true,
  directoryName = '.office.local',
  publicAlias = false,
) {
  vi.stubEnv('OPENAI_API_KEY', providerSecret)
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-recruitment-http-'))
  directories.push(root)
  const local = path.join(root, directoryName)
  await mkdir(local)
  if (configured)
    await writeFile(path.join(local, 'ceo.json'), JSON.stringify(config))
  await writeFile(
    path.join(local, 'private.json'),
    JSON.stringify({ private: providerSecret }),
  )
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><title>Local test fixture</title>',
  )
  if (publicAlias) {
    const publicDirectory = path.join(root, 'public')
    await mkdir(publicDirectory)
    await symlink(
      local,
      path.join(publicDirectory, 'configuration-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  }
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [
      createRecruitmentPlugin(
        directoryName === '.office.local' ? {} : { directory: local },
      ),
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: {
        deny: ['.env', '.env.*', '**/tools-host/**', '**/.office.local/**'],
      },
    },
  })
  servers.push(server)
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string')
    throw new Error('Test HTTP server did not bind.')
  const url = `http://127.0.0.1:${address.port}`
  let cookie = ''
  const send = (
    route: string,
    body: unknown = {},
    headers: Record<string, string> = {},
  ) =>
    fetch(`${url}/__recruitment/${route}`, {
      method: 'POST',
      headers: {
        Origin: url,
        'Content-Type': 'application/json',
        'X-Office-Recruitment': '1',
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    })
  const login = async () => {
    const response = await send('login', { password })
    expect(response.status).toBe(200)
    cookie = response.headers.get('set-cookie')!.split(';')[0]!
    return cookie
  }
  const snapshot = async () => {
    const response = await send('snapshot')
    expect(response.status).toBe(200)
    return (await response.json()) as RealtimeSnapshot
  }
  return { server, root, local, url, send, login, snapshot }
}
const spec = (): RecruitmentSpec => ({
  name: 'Synthetic applicant',
  role: 'Repository reviewer',
  departmentId: 'engineering',
  mission: 'Review only an explicitly approved work sample.',
  responsibilities: ['Explain a bounded finding.'],
  skills: [
    {
      id: 'review',
      description: 'Explain approved scope.',
      mandatory: true,
      prompt: 'Explain approved scope.',
      expectedIncludes: ['approved scope'],
    },
  ],
  instructions: 'Use the supplied work sample only.',
  personality: 'Professional',
  providerId: 'openai',
  modelId: 'gpt-6-astra',
  toolIds: ['provider.invoke'],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: 'recruitment-manager',
  budgetMicros: 100000,
  maxOutputUnits: 128,
  adapterMode: 'mock-success',
})

describe('authenticated local recruitment HTTP boundary', () => {
  it('frames successful and rejected finite JSON with exact UTF-8 length while retaining the live stream', async () => {
    const api = await host()
    const framed = async (response: Response) => {
      const text = await response.text()
      expect(response.headers.get('content-length')).toBe(
        String(Buffer.byteLength(text, 'utf8')),
      )
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('transfer-encoding')).toBeNull()
      expect(response.headers.get('cache-control')).toContain('no-transform')
      return text
    }
    expect(JSON.parse(await framed(await api.send('status')))).toMatchObject({
      configured: true,
      authenticated: false,
    })
    const unauthorized = await api.send('snapshot')
    expect(unauthorized.status).toBe(401)
    expect(JSON.parse(await framed(unauthorized))).toMatchObject({ ok: false })
    await api.login()
    await framed(
      await api.send('action', {
        action: 'request',
        spec: { ...spec(), name: 'Synthetic café analyst λ' },
      }),
    )
    const snapshot = await framed(await api.send('snapshot'))
    expect(snapshot).toContain('Synthetic café analyst λ')
    expect(Buffer.byteLength(snapshot, 'utf8')).toBeGreaterThan(snapshot.length)
    const stream = await api.send('stream')
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toBe('application/x-ndjson')
    expect(stream.headers.get('content-length')).toBeNull()
    const reader = stream.body!.getReader()
    try {
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain('realtime-ready')
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
  }, 15000)

  it('rejects an oversized UTF-8 finite response before writing it and frames only a safe error', async () => {
    const api = await host()
    await api.login()
    const before = await api.snapshot()
    // Inject an invalid host result, not a large user payload, to exercise the final output boundary.
    vi.spyOn(RecruitmentService.prototype, 'request').mockReturnValueOnce(
      `${'λ'.repeat(2_000_000)}-a-b-c-d`,
    )
    const response = await api.send('action', {
      action: 'request',
      spec: spec(),
    })
    expect(response.status).toBe(400)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      code: 'RECRUITMENT_RESPONSE_TOO_LARGE',
    })
    expect(text).not.toContain('λ')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(1000)
    expect(response.headers.get('content-length')).toBe(
      String(Buffer.byteLength(text, 'utf8')),
    )
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect((await api.snapshot()).revision).toBe(before.revision)
  }, 15000)

  it('requires a configured CEO login and never accepts a browser role or forged session', async () => {
    const api = await host()
    expect(await (await api.send('status')).json()).toMatchObject({
      configured: true,
      authenticated: false,
      ceoId: null,
    })
    expect((await api.send('snapshot')).status).toBe(401)
    expect(
      (
        await api.send(
          'action',
          { action: 'request', spec: spec(), role: 'ceo' },
          { Cookie: `office_ceo_session=${'a'.repeat(43)}` },
        )
      ).status,
    ).toBe(401)
    const cookie = await api.login()
    expect(cookie.includes(password)).toBe(false)
    expect(await (await api.send('status')).json()).toMatchObject({
      authenticated: true,
      ceoId: 'test-ceo',
    })
    expect((await api.send('logout')).status).toBe(200)
    expect((await api.send('snapshot', {}, { Cookie: cookie })).status).toBe(
      401,
    )
  }, 15000)

  it('fails safely when CEO setup is absent and rejects incorrect sign-in without logging values', async () => {
    const missing = await host(false)
    expect(await (await missing.send('status')).json()).toMatchObject({
      configured: false,
      authenticated: false,
    })
    const denied = await missing.send('login', { password })
    expect(denied.status).toBe(400)
    expect((await denied.text()).includes(password)).toBe(false)
    const api = await host()
    for (let n = 0; n < 5; n += 1)
      expect((await api.send('login', { password: '' })).status).toBe(400)
    const limited = await api.send('login', { password })
    expect(await limited.json()).toMatchObject({
      ok: false,
      code: 'CEO_AUTH_RATE_LIMITED',
    })
  }, 15000)

  it('rejects foreign origins, forwarded authority, unsafe methods and malformed bodies', async () => {
    const api = await host()
    await api.login()
    const deniedHeaders: readonly Record<string, string>[] = [
      { Origin: 'https://untrusted.invalid' },
      { 'X-Office-Recruitment': '0' },
      { 'X-Forwarded-For': '127.0.0.1' },
      { Forwarded: 'for=127.0.0.1' },
      { 'Content-Type': 'text/plain' },
    ]
    for (const headers of deniedHeaders)
      expect(
        (await api.send('action', { action: 'request', spec: spec() }, headers))
          .status,
      ).toBe(400)
    expect((await fetch(`${api.url}/__recruitment/snapshot`)).status).toBe(400)
    expect(
      (
        await api.send('action', {
          action: 'request',
          spec: spec(),
          extra: 'x'.repeat(66000),
        })
      ).status,
    ).toBe(400)
    const state = await api.snapshot()
    expect(Object.keys(state.view.state.recruitments)).toHaveLength(0)
    const request = {
      headers: {
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'x-office-recruitment': '1',
      },
      socket: { remoteAddress: '192.168.1.20' },
    } as unknown as IncomingMessage
    expect(isRecruitmentLocalRequest(request, 5173)).toBe(false)
    expect(
      isRecruitmentLocalRequest(
        {
          ...request,
          socket: { remoteAddress: '127.0.0.1' },
          headers: { ...request.headers, host: 'untrusted.invalid:5173' },
        } as unknown as IncomingMessage,
        5173,
      ),
    ).toBe(false)
  }, 15000)

  it('requires the exact pending proposal version and records approval as the authenticated CEO', async () => {
    const api = await host()
    await api.login()
    const created = await api.send('action', {
      action: 'request',
      spec: spec(),
    })
    expect(created.status).toBe(200)
    const { recruitmentId } = (await created.json()) as {
      recruitmentId: string
    }
    expect(
      (await api.send('action', { action: 'start', recruitmentId })).status,
    ).toBe(400)
    expect(
      (
        await api.send('action', {
          action: 'decide',
          recruitmentId,
          version: 1,
          decision: 'approve',
          reason: 'Approved test scope.',
          actorId: 'forged-ceo',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.send('action', {
          action: 'decide',
          recruitmentId,
          version: 2,
          decision: 'approve',
          reason: 'Wrong version.',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api.send('action', {
          action: 'decide',
          recruitmentId,
          version: 1,
          decision: 'approve',
          reason: 'Approved test scope.',
        })
      ).status,
    ).toBe(200)
    const result = await api.snapshot()
    expect(result.view.state.recruitments[recruitmentId]).toMatchObject({
      state: 'approved',
      approvedVersion: 1,
      approvals: [{ actorId: 'test-ceo', version: 1, decision: 'approve' }],
    })
    expect(Object.keys(result.view.state.employees)).toHaveLength(0)
    expect(
      (
        await api.send('action', {
          action: 'feedback',
          command: {
            type: 'activateRecruitment',
            recruitmentId,
            actorId: 'recruitment-service',
          },
        })
      ).status,
    ).toBe(400)
  }, 15000)

  it('publishes personnel details only to the server-bound CEO projection and never returns secrets', async () => {
    const api = await host()
    await api.login()
    expect(
      (await api.send('action', { action: 'request', spec: spec() })).status,
    ).toBe(200)
    const snapshot = await api.snapshot()
    expect(Object.keys(snapshot.view.state.recruitments)).toHaveLength(1)
    const serialized = JSON.stringify(snapshot)
    for (const forbidden of [
      password,
      providerSecret,
      config.passwordHash,
      salt,
      'openai-host',
    ])
      expect(serialized.includes(forbidden)).toBe(false)
    const durable = JSON.parse(
      await readFile(path.join(api.local, 'runtime.json'), 'utf8'),
    ).snapshot as RuntimeState
    const workerView = createRealtimeProjection({
      principalAgentId: 'recruitment-manager',
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
    })(durable)
    expect(workerView.state.recruitments).toEqual({})
    expect(workerView.state.employees).toEqual({})
    const before = snapshot.revision
    const leaked = { ...spec(), mission: providerSecret }
    expect(
      (await api.send('action', { action: 'request', spec: leaked })).status,
    ).toBe(400)
    const after = await api.snapshot()
    expect(after.revision).toBe(before)
    expect(JSON.stringify(after).includes(providerSecret)).toBe(false)
  }, 15000)

  it('blocks local auth/runtime files via direct, raw, filesystem, encoded and case-varied paths', async () => {
    const api = await host()
    const root = api.root.replaceAll('\\', '/')
    for (const suffix of [
      '/.office.local/ceo.json',
      '/.office.local/private.json?raw',
      '/.office.local/private.json?url',
      '/%2eoffice.local/private.json',
      '/.office.local%2fprivate.json',
      '/.office.local%252fprivate.json',
      '/.office.local%5cprivate.json',
      '/.OFFICE.LOCAL/private.json',
      `/@fs/${root}/.office.local/private.json`,
      `/@fs/${root}/.office.local/ceo.json?raw`,
    ]) {
      const response = await fetch(api.url + suffix)
      expect(response.status, suffix).toBe(403)
      const body = await response.text()
      expect(body.includes(providerSecret)).toBe(false)
      expect(body.includes(config.passwordHash)).toBe(false)
    }
  }, 15000)

  it('keeps a trusted isolated test directory private without accepting a browser storage path', async () => {
    const api = await host(true, 'isolated-fixture.local')
    await api.login()
    const root = api.root.replaceAll('\\', '/')
    for (const suffix of [
      '/isolated-fixture.local/ceo.json',
      '/isolated-fixture.local%2fprivate.json?raw',
      `/@fs/${root}/isolated-fixture.local/private.json`,
    ]) {
      const response = await fetch(api.url + suffix)
      expect(response.status).toBe(403)
      expect((await response.text()).includes(providerSecret)).toBe(false)
    }
    expect(
      (await api.send('connect', { directory: 'another-directory' })).status,
    ).toBe(400)
    expect((await api.snapshot()).kind).toBe('snapshot')
  }, 15000)

  it('does not serve private configuration through a public directory junction alias', async () => {
    const api = await host(true, '.office.local', true)
    const response = await fetch(`${api.url}/configuration-alias/private.json`)
    const body = await response.text()
    expect(body.includes(providerSecret)).toBe(false)
    expect(response.status).toBe(403)
  }, 15000)
})
