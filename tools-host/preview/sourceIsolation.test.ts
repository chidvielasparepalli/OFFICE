// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import path from 'node:path'
import { mkdir, writeFile, unlink } from 'node:fs/promises'

describe('development host source isolation', () => {
  it('blocks direct, raw, filesystem and bundled-config host sources while retaining Vite sensitive-file defaults', async () => {
    const root = process.cwd()
    const probe = path.join(
      root,
      'node_modules/.vite-temp/phase11-deny-probe.mjs',
    )
    await mkdir(path.dirname(probe), { recursive: true })
    await writeFile(probe, 'export const hostOnlyProbe = true;')
    const server = await createServer({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      cacheDir: path.join(root, 'node_modules/.vite-source-isolation'),
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 },
    })
    try {
      const deny = server.config.server.fs.deny
      for (const pattern of [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/tools-host/**',
        '**/node_modules/.vite-temp/**',
      ])
        expect(deny).toContain(pattern)
      await server.listen()
      const address = server.httpServer!.address()
      if (!address || typeof address === 'string')
        throw new Error('Missing local port.')
      const base = `http://127.0.0.1:${address.port}`
      for (const suffix of [
        '/tools-host/preview/providerSession.ts',
        '/tools-host/preview/providerSession.ts?raw',
        '/tools-host/preview/realtimeSession.ts',
        '/tools-host/realtime/publication.ts?raw',
        `/@fs/${root.replaceAll('\\', '/')}/tools-host/preview/realtimeStream.ts`,
        `/@fs/${root.replaceAll('\\', '/')}/tools-host/providers/SecretStore.ts`,
        '/node_modules/.vite-temp/phase11-deny-probe.mjs',
      ]) {
        const response = await fetch(base + suffix)
        expect(response.status, suffix).toBe(403)
        expect(
          (await response.text()).includes('phase11-host-only-synthetic-value'),
        ).toBe(false)
      }
    } finally {
      await server.close()
      await unlink(probe)
    }
  }, 15000)
})
