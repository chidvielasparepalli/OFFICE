// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { createServer, type ViteDevServer } from 'vite'
import {
  createToolsPreviewPlugin,
  isLocalRequest,
  parsePreviewAction,
} from './plugin'
import type {
  ToolPreviewMessage,
  ToolPreviewSnapshot,
} from '../../src/dev/toolPreviewProtocol'
import { createSandbox } from './fixtures'
import { createPreviewSession } from './session'
import { ToolExecutor } from '../../src/tools/ToolExecutor'

const servers: ViteDevServer[] = []
const directories: string[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function host() {
  const root = await mkdtemp(path.join(tmpdir(), 'office-tool-preview-'))
  directories.push(root)
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [createToolsPreviewPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  servers.push(server)
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string')
    throw new Error('No test server port.')
  const url = `http://127.0.0.1:${address.port}`
  let session = ''
  const send = async (
    endpoint: string,
    input: unknown,
    headers: Record<string, string> = {},
    onSnapshot?: (snapshot: ToolPreviewSnapshot) => void,
  ) => {
    const response = await fetch(`${url}/__tools-preview/${endpoint}`, {
      method: 'POST',
      headers: {
        Origin: url,
        'Content-Type': 'application/json',
        'X-Tools-Preview': '1',
        'X-Tools-Session': session,
        ...headers,
      },
      body: JSON.stringify(input),
    })
    const messages: ToolPreviewMessage[] = []
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += decoder.decode(chunk.value, { stream: true })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!line.trim()) continue
        const message = JSON.parse(line) as ToolPreviewMessage
        messages.push(message)
        if (message.type === 'snapshot') onSnapshot?.(message.snapshot)
      }
    }
    const snapshots = messages
      .filter((message) => message.type === 'snapshot')
      .map((message) => message.snapshot)
    const snapshot = snapshots.at(-1)
    return { status: response.status, messages, snapshots, snapshot }
  }
  const connect = async () => {
    const response = await send('connect', {})
    session = response.snapshot!.sessionId
    return response.snapshot!
  }
  const action = (input: unknown) => send('action', input)
  return { root, url, send, connect, action }
}
function lastExecution(snapshot: ToolPreviewSnapshot) {
  return Object.values(snapshot.state.toolExecutions).at(-1)!
}

describe('development host authority', () => {
  it('does not dispatch another task while an adapter still owns a cleanup lease', async () => {
    const api = await host()
    await api.connect()
    const lease = vi
      .spyOn(ToolExecutor.prototype, 'getMetrics')
      .mockReturnValue({ activeExecutions: 1 })
    const result = await api.action({ action: 'prepare', scenario: 'research' })
    expect(result.messages).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'BUSY' }),
    )
    expect(Object.keys(result.snapshot!.state.tasks)).toHaveLength(0)
    lease.mockRestore()
  }, 15000)
  it('rejects remote/foreign origins, forwarded authority, and browser grants or arbitrary commands', async () => {
    const request = {
      headers: {
        host: '127.0.0.1:5173',
        origin: 'http://127.0.0.1:5173',
        'x-tools-preview': '1',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage
    expect(isLocalRequest(request, 5173)).toBe(true)
    expect(
      isLocalRequest(
        {
          ...request,
          socket: { remoteAddress: '192.168.1.10' },
        } as unknown as IncomingMessage,
        5173,
      ),
    ).toBe(false)
    expect(
      isLocalRequest(
        {
          ...request,
          headers: { ...request.headers, origin: 'https://evil.invalid' },
        } as IncomingMessage,
        5173,
      ),
    ).toBe(false)
    expect(
      isLocalRequest(
        {
          ...request,
          headers: { ...request.headers, 'x-forwarded-host': 'localhost' },
        } as unknown as IncomingMessage,
        5173,
      ),
    ).toBe(false)
    for (const input of [
      { action: 'execute', operation: 'terminal', grants: ['execute'] },
      { action: 'prepare', scenario: ['research'] },
      { action: 'execute', operation: ['terminal'] },
      {
        action: 'execute',
        operation: 'terminal',
        input: { executable: 'cmd' },
      },
      {
        action: 'feedback',
        command: { type: 'completeTask', taskId: 'forged' },
      },
      {
        action: 'feedback',
        command: { type: 'selectAgent', agentId: null, kind: 'manager' },
      },
      {
        action: 'feedback',
        command: {
          type: 'arrive',
          agentId: 'x',
          intentId: 'y',
          position: [0, NaN, 0],
          headingRadians: 0,
        },
      },
    ])
      expect(() => parsePreviewAction(input)).toThrow()
    const api = await host()
    expect(
      (await api.send('connect', {}, { Origin: 'https://evil.invalid' }))
        .status,
    ).toBe(403)
    expect(
      (await api.send('connect', { roots: { fixture: 'C:/' } })).status,
    ).toBe(400)
    expect(
      (await api.send('connect', { padding: 'x'.repeat(17000) })).messages,
    ).toContainEqual(expect.objectContaining({ code: 'PAYLOAD_LIMIT' }))
    expect((await api.action({ action: 'complete' })).status).toBe(403)
  }, 15000)

  it('runs fixture research through the Manager and host audit without completing the task', async () => {
    const api = await host()
    await api.connect()
    const prepared = await api.action({
      action: 'prepare',
      scenario: 'research',
    })
    expect(
      prepared.snapshot!.state.tasks[prepared.snapshot!.taskId!].status,
    ).toBe('in_progress')
    const response = await api.action({
      action: 'execute',
      operation: 'research',
    })
    expect(response.status).toBe(200)
    const execution = lastExecution(response.snapshot!)
    expect(execution).toMatchObject({
      status: 'completed',
      toolId: 'research.search',
      permission: { allowed: true },
      output: { mode: 'fixture' },
    })
    expect(
      response.snapshots.some((snapshot) =>
        Object.values(snapshot.state.toolExecutions).some(
          (item) => item.status === 'running',
        ),
      ),
    ).toBe(true)
    expect(
      response.snapshot!.state.tasks[response.snapshot!.taskId!],
    ).toMatchObject({ status: 'in_progress', progressPercent: 0 })
    const completed = await api.action({ action: 'complete' })
    expect(
      completed.snapshot!.state.tasks[completed.snapshot!.taskId!].status,
    ).toBe('completed')
    expect(Object.values(completed.snapshot!.state.plans).at(-1)!.status).toBe(
      'completed',
    )
  }, 15000)

  it('runs real scoped read/terminal/Git operations only in its disposable repository', async () => {
    const api = await host()
    const connected = await api.connect()
    await api.action({ action: 'prepare', scenario: 'coding' })
    const read = await api.action({ action: 'execute', operation: 'read' })
    expect(lastExecution(read.snapshot!).output).toMatchObject({
      content: expect.stringContaining('disposable development fixture'),
    })
    const terminal = await api.action({
      action: 'execute',
      operation: 'terminal',
    })
    expect(lastExecution(terminal.snapshot!)).toMatchObject({
      status: 'completed',
      output: { exitCode: 0, stdout: expect.stringMatching(/^v\d+/) },
    })
    await api.action({ action: 'complete' })
    await api.action({ action: 'prepare', scenario: 'git' })
    for (const operation of [
      'git-status',
      'git-diff',
      'git-add',
      'git-commit',
    ]) {
      const result = await api.action({ action: 'execute', operation })
      expect(
        lastExecution(result.snapshot!).status,
        JSON.stringify(result.messages.at(-1)),
      ).toBe('completed')
      if (operation === 'git-commit')
        expect(lastExecution(result.snapshot!).output).toMatchObject({
          commit: expect.stringMatching(/^[a-f0-9]{40}$/),
        })
    }
    expect(
      await readFile(
        path.join(
          api.root,
          '.tools-preview.local',
          connected.sessionId,
          'readme.txt',
        ),
        'utf8',
      ),
    ).toContain('Explicit staged-change demonstration')
  }, 15000)

  it('audits denied access, real timeout, cancellation, stale sessions and invalid arrival', async () => {
    const api = await host()
    const first = await api.connect()
    const prepared = await api.action({ action: 'prepare', scenario: 'denied' })
    const actor = prepared.snapshot!.state.agents['phase7-researcher']
    const invalid = await api.action({
      action: 'feedback',
      command: {
        type: 'arrive',
        agentId: actor.id,
        intentId: actor.destination!.id,
        position: [0, 0, 50],
        headingRadians: 0,
      },
    })
    expect(invalid.messages).toContainEqual(
      expect.objectContaining({ code: 'INVALID_ARRIVAL' }),
    )
    const denied = await api.action({ action: 'execute', operation: 'denied' })
    expect(lastExecution(denied.snapshot!)).toMatchObject({
      status: 'failed',
      startedAt: null,
      permission: { allowed: false },
    })
    expect(denied.snapshot!.state.tasks[denied.snapshot!.taskId!].status).toBe(
      'blocked',
    )
    await api.action({ action: 'cancel' })
    await api.action({ action: 'prepare', scenario: 'timeout' })
    const timeout = await api.action({
      action: 'execute',
      operation: 'timeout',
    })
    expect(lastExecution(timeout.snapshot!)).toMatchObject({
      status: 'failed',
      error: { code: 'TIMEOUT' },
    })
    expect(
      timeout.snapshot!.state.tasks[timeout.snapshot!.taskId!].progressPercent,
    ).toBe(0)
    await api.action({ action: 'resume' })
    let running!: () => void
    const started = new Promise<void>((resolve) => {
      running = resolve
    })
    const executing = api.send(
      'action',
      { action: 'execute', operation: 'cancellable' },
      {},
      (snapshot) => {
        if (lastExecution(snapshot)?.status === 'running') running()
      },
    )
    await Promise.race([
      started,
      executing.then((result) => {
        throw new Error(
          `Execution ended before its running event: ${JSON.stringify(result.messages.at(-1))}`,
        )
      }),
    ])
    await api.action({ action: 'cancel' })
    const cancelled = await executing
    expect(
      lastExecution(cancelled.snapshot!).status,
      JSON.stringify(cancelled.messages.at(-1)),
    ).toBe('cancelled')
    await api.connect()
    expect(
      (
        await api.send(
          'action',
          { action: 'complete' },
          { 'X-Tools-Session': first.sessionId },
        )
      ).status,
    ).toBe(403)
  }, 15000)

  it('refuses a redirected sandbox parent before writing any file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-preview-root-'))
    const outside = await mkdtemp(
      path.join(tmpdir(), 'office-preview-outside-'),
    )
    directories.push(root, outside)
    await symlink(
      outside,
      path.join(root, '.tools-preview.local'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      createSandbox(root, '12345678-1234-1234-1234-123456789abc'),
    ).rejects.toThrow('real directory')
    expect(await readdir(outside)).toEqual([])
  })

  it('awaits cancellation of a real process when disposing a session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'office-preview-close-'))
    directories.push(root)
    const session = await createPreviewSession(root)
    await session.action({ action: 'prepare', scenario: 'timeout' })
    const started = new Promise<void>((resolve) => {
      const unsubscribe = session.runtime.subscribe(() => {
        if (
          Object.values(session.runtime.getSnapshot().toolExecutions).some(
            (execution) => execution.status === 'running',
          )
        ) {
          unsubscribe()
          resolve()
        }
      })
    })
    const execution = session.action({
      action: 'execute',
      operation: 'cancellable',
    })
    await started
    await session.dispose()
    await execution
    expect(lastExecution(session.snapshot()).status).toBe('cancelled')
    expect(session.runtime.getMetrics().subscribers).toBe(0)
  }, 15000)
})
