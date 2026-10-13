// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type ViteDevServer } from 'vite'
import { createToolsPreviewPlugin } from './plugin'
import { RealtimePreviewClient } from '../../src/dev/realtimePreviewClient'
import { ARTIFACT_PREVIEW as ids } from '../../src/dev/artifactFixtures'
import { seatedWorkstationAnchor } from '../../src/office/characterMotion'

const clients: RealtimePreviewClient[] = []
const servers: ViteDevServer[] = []
const directories: string[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  for (const server of servers.splice(0)) await server.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function host() {
  const root = await mkdtemp(path.join(tmpdir(), 'office-realtime-preview-'))
  directories.push(root)
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [createToolsPreviewPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  })
  servers.push(server)
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string')
    throw new Error('No local test port.')
  const origin = `http://127.0.0.1:${address.port}`
  const calls: string[] = []
  const fetcher: typeof fetch = (url, init) => {
    calls.push(String(url))
    return fetch(`${origin}${String(url)}`, {
      ...init,
      headers: { ...init?.headers, Origin: origin },
    })
  }
  const client = new RealtimePreviewClient(fetcher)
  clients.push(client)
  return { client, origin, calls }
}
describe('actual guarded persistent local HTTP stream', () => {
  it('delivers command-driven transactions, resyncs gaps and reconnects without recreating host business state', async () => {
    const { client, calls } = await host()
    await client.connect()
    expect(client.getConnection().status).toBe('connected')
    await client.action({ action: 'prepare' })
    await vi.waitFor(() =>
      expect(client.getSnapshot().tasks[ids.task]).toBeDefined(),
    )
    await client.action({ action: 'start' })
    await vi.waitFor(() =>
      expect(
        client.getSnapshot().agents[ids.workerA].destination,
      ).not.toBeNull(),
    )
    const worker = client.getSnapshot().agents[ids.workerA]
    const desk = client.getSnapshot().workstations[worker.workstationId!]
    client.disconnect()
    const retained = client.getSnapshot()
    expect(
      (
        await client.dispatch({
          type: 'arrive',
          agentId: worker.id,
          intentId: worker.destination!.id,
          position: seatedWorkstationAnchor(desk),
          headingRadians: desk.headingRadians,
        })
      ).ok,
    ).toBe(false)
    expect(client.getMetrics().pendingSpatialFeedback).toBe(1)
    await client.action({ action: 'progress' })
    expect(client.getSnapshot()).toBe(retained)
    await client.reconnect()
    await vi.waitFor(() =>
      expect(client.getSnapshot().agents[worker.id].destination).toBeNull(),
    )
    expect(client.getSnapshot().tasks[ids.task].progressPercent).toBe(10)
    await vi.waitFor(() =>
      expect(client.getMetrics().pendingSpatialFeedback).toBe(0),
    )
    await client.action({ action: 'duplicate' })
    await client.action({ action: 'stale' })
    await client.action({ action: 'gap' })
    await vi.waitFor(() => expect(client.store.getMetrics().gaps).toBe(1))
    await vi.waitFor(() =>
      expect(client.getConnection().status).toBe('connected'),
    )
    expect(client.store.getMetrics().duplicates).toBeGreaterThanOrEqual(2)
    expect(client.store.getMetrics().stale).toBeGreaterThanOrEqual(1)
    await client.action({ action: 'drop' })
    await vi.waitFor(() => expect(client.store.getMetrics().reconnects).toBe(1))
    await vi.waitFor(() =>
      expect(client.getConnection().status).toBe('connected'),
    )
    expect(client.getSnapshot().tasks[ids.task].progressPercent).toBe(10)
    expect(calls.filter((url) => url.endsWith('/connect'))).toHaveLength(1)
    const count = calls.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(calls).toHaveLength(count)
  }, 15000)
  it('rejects foreign origins, session guesses, browser audience selection and arbitrary actions', async () => {
    const { client, origin } = await host()
    await client.connect()
    const post = (
      endpoint: string,
      value: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${origin}/__tools-preview/${endpoint}`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Tools-Preview': '1',
          ...headers,
        },
        body: JSON.stringify(value),
      })
    expect((await post('stream', {})).status).toBe(403)
    expect(
      (await post('snapshot', {}, { 'X-Tools-Session': 'not-the-session' }))
        .status,
    ).toBe(403)
    expect(
      (
        await post(
          'connect',
          { mode: 'realtime' },
          { Origin: 'https://unrelated.invalid' },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await post('connect', {
          mode: 'realtime',
          principalAgentId: ids.workerA,
        })
      ).status,
    ).toBe(400)
    expect(
      (await client.dispatch({ type: 'completeTask', taskId: ids.task })).ok,
    ).toBe(false)
    expect(client.getSnapshot().tasks[ids.task]).toBeUndefined()
  }, 15000)
})
