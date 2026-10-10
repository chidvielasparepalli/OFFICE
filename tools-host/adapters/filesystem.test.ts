// @vitest-environment node
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemTools } from './filesystem.ts'
import { context, sandbox } from './testSupport.ts'

let space: Awaited<ReturnType<typeof sandbox>>
let root: string, outside: string
beforeEach(async () => {
  space = await sandbox()
  root = path.join(space.directory, 'workspace')
  outside = path.join(space.directory, 'outside')
  await fs.mkdir(root)
  await fs.mkdir(outside)
  await fs.writeFile(path.join(root, 'input.txt'), 'Actual fixture content')
  await fs.writeFile(path.join(outside, 'private.txt'), 'Outside fixture')
})
afterEach(async () => {
  await space.cleanup()
})
const tools = (writable = true, maxBytes = 65536) =>
  createFilesystemTools({
    roots: { workspace: { path: root, writable } },
    maxBytes,
  })

describe('controlled filesystem adapters', () => {
  it('reads and atomically replaces real UTF-8 files with bounded validated output', async () => {
    const [read, write] = tools()
    const result = await read.execute(
      { rootId: 'workspace', path: 'input.txt' },
      context(),
    )
    expect(read.outputSchema.parse(result)).toMatchObject({
      content: 'Actual fixture content',
      bytes: 22,
    })
    const written = await write.execute(
      { rootId: 'workspace', path: 'input.txt', content: 'Updated text' },
      context(),
    )
    expect(write.outputSchema.parse(written).bytes).toBe(12)
    expect(await fs.readFile(path.join(root, 'input.txt'), 'utf8')).toBe(
      'Updated text',
    )
    expect(await fs.readdir(root)).toEqual(['input.txt'])
    expect(
      write.summarizeInput({
        rootId: 'workspace',
        path: 'input.txt',
        content: 'Private input text',
      }),
    ).not.toHaveProperty('content')
    expect(write.allowedKinds).toEqual(['standard-worker'])
    expect(read.allowedKinds).toContain('manager')
  })
  it('creates only an explicitly named file in an existing directory', async () => {
    const [, write] = tools()
    await write.execute(
      { rootId: 'workspace', path: 'new.txt', content: 'New' },
      context(),
    )
    expect(await fs.readFile(path.join(root, 'new.txt'), 'utf8')).toBe('New')
    await expect(
      write.execute(
        { rootId: 'workspace', path: 'missing/new.txt', content: 'No' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })
  it.each([
    '../outside/private.txt',
    'folder/../../private.txt',
    'C:\\outside.txt',
    'C:outside.txt',
    '/tmp/outside',
    '\\\\server\\share\\file',
    'input.txt:stream',
    'NUL.txt',
    'folder/CON',
    '.env',
    '.env.production',
    '.git/config',
    '.ssh/id_rsa',
    'folder/secret.pem',
    'input.txt.',
    'folder//file',
  ])(
    'denies ambiguous or protected path %s before side effects',
    async (value) => {
      const [read, write] = tools()
      expect(() =>
        read.inputSchema.parse({ rootId: 'workspace', path: value }),
      ).toThrow()
      await expect(
        write.execute(
          { rootId: 'workspace', path: value, content: 'Denied' },
          context(),
        ),
      ).rejects.toHaveProperty('code')
      expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe(
        'Outside fixture',
      )
    },
  )
  it('enforces configured roots, read-only policy and missing-file errors', async () => {
    const [read, write] = tools(false)
    await expect(
      read.execute({ rootId: 'unknown', path: 'input.txt' }, context()),
    ).rejects.toMatchObject({ code: 'ROOT_DENIED' })
    await expect(
      read.execute({ rootId: 'workspace', path: 'missing.txt' }, context()),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
    await expect(
      write.execute(
        { rootId: 'workspace', path: 'input.txt', content: 'Denied' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(await fs.readFile(path.join(root, 'input.txt'), 'utf8')).toBe(
      'Actual fixture content',
    )
  })
  it('rejects a directory junction/symlink escape for read and write', async () => {
    await fs.symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const [read, write] = tools()
    await expect(
      read.execute(
        { rootId: 'workspace', path: 'escape/private.txt' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    await expect(
      write.execute(
        { rootId: 'workspace', path: 'escape/new.txt', content: 'Denied' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    expect(await fs.readdir(outside)).toEqual(['private.txt'])
  })
  it('rejects a hard link to an outside file without modifying either link', async () => {
    await fs.link(
      path.join(outside, 'private.txt'),
      path.join(root, 'link.txt'),
    )
    const [read, write] = tools()
    await expect(
      read.execute({ rootId: 'workspace', path: 'link.txt' }, context()),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    await expect(
      write.execute(
        { rootId: 'workspace', path: 'link.txt', content: 'Denied' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    expect(await fs.readFile(path.join(outside, 'private.txt'), 'utf8')).toBe(
      'Outside fixture',
    )
  })
  it('rejects oversized reads/writes and malformed UTF-8 without inventing a result', async () => {
    const [read, write] = tools(true, 8)
    await expect(
      read.execute({ rootId: 'workspace', path: 'input.txt' }, context()),
    ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' })
    expect(() =>
      write.inputSchema.parse({
        rootId: 'workspace',
        path: 'new.txt',
        content: '€€€',
      }),
    ).toThrow()
    await fs.writeFile(path.join(root, 'binary.txt'), Buffer.from([0xff]))
    await expect(
      read.execute({ rootId: 'workspace', path: 'binary.txt' }, context()),
    ).rejects.toMatchObject({ code: 'INVALID_TEXT' })
    expect(await fs.readdir(root)).not.toContain('new.txt')
  })
  it('rejects pre-cancelled writes and extra executable-like arguments without touching disk', async () => {
    const [, write] = tools()
    const cancellation = new AbortController()
    cancellation.abort()
    await expect(
      write.execute(
        { rootId: 'workspace', path: 'new.txt', content: 'Denied' },
        context(cancellation.signal),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(() =>
      write.inputSchema.parse({
        rootId: 'workspace',
        path: 'new.txt',
        content: 'Denied',
        recursive: true,
      }),
    ).toThrow()
    expect(await fs.readdir(root)).toEqual(['input.txt'])
  })
})
