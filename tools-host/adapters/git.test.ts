// @vitest-environment node
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGitTools } from './git.ts'
import { context, exec, gitExecutable, sandbox } from './testSupport.ts'

let space: Awaited<ReturnType<typeof sandbox>>, git: string
const raw = (args: string[]) =>
  exec(
    git,
    [
      '-c',
      'user.name=Adapter Tests',
      '-c',
      'user.email=adapter-tests@example.invalid',
      '-c',
      'commit.gpgSign=false',
      ...args,
    ],
    { cwd: space.directory, windowsHide: true },
  )
beforeEach(async () => {
  space = await sandbox()
  git = await gitExecutable()
  await raw(['init', '--initial-branch=main'])
  await fs.writeFile(
    path.join(space.directory, 'readme.txt'),
    'Initial content\n',
  )
  await raw(['add', '--', 'readme.txt'])
  await raw(['commit', '-m', 'Initial test fixture'])
})
afterEach(async () => {
  await space.cleanup()
})
const tools = (writable = true) =>
  createGitTools({
    roots: { repo: { path: space.directory, writable } },
    executable: git,
    author: { name: 'Office Test Worker', email: 'worker@example.invalid' },
  })

describe('controlled Git adapters', () => {
  it('inspects actual repository state and commits only explicitly staged permitted files', async () => {
    const [inspect, add, commit] = tools()
    await fs.writeFile(
      path.join(space.directory, 'readme.txt'),
      'Real changed content\n',
    )
    expect(
      (
        await inspect.execute(
          { rootId: 'repo', operation: 'status' },
          context(),
        )
      ).stdout,
    ).toContain('readme.txt')
    const diff = await inspect.execute(
      { rootId: 'repo', operation: 'diff', paths: ['readme.txt'] },
      context(),
    )
    expect(inspect.outputSchema.parse(diff).stdout).toContain(
      '+Real changed content',
    )
    expect(
      (
        await inspect.execute(
          { rootId: 'repo', operation: 'branch' },
          context(),
        )
      ).stdout.trim(),
    ).toBe('main')
    expect(
      (await inspect.execute({ rootId: 'repo', operation: 'log' }, context()))
        .stdout,
    ).toContain('Initial test fixture')
    await add.execute({ rootId: 'repo', paths: ['readme.txt'] }, context())
    const result = await commit.execute(
      {
        rootId: 'repo',
        paths: ['readme.txt'],
        message: 'Explicit local commit',
      },
      context(),
    )
    expect(commit.outputSchema.parse(result).commit).toMatch(
      /^[a-f0-9]{40,64}$/,
    )
    expect(
      (await raw(['log', '-1', '--format=%an <%ae> %s'])).stdout.trim(),
    ).toBe('Office Test Worker <worker@example.invalid> Explicit local commit')
    expect(
      (
        await inspect.execute(
          { rootId: 'repo', operation: 'status' },
          context(),
        )
      ).stdout,
    ).toBe('')
    expect(add.allowedKinds).toEqual(['standard-worker'])
    expect(commit.allowedKinds).toEqual(['standard-worker'])
    expect(inspect.allowedKinds).toContain('manager')
  })
  it('rejects write grants on read-only roots and exposes no push or destructive operation', async () => {
    const [inspect, add, commit] = tools(false)
    await expect(
      add.execute({ rootId: 'repo', paths: ['readme.txt'] }, context()),
    ).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(
      commit.execute(
        { rootId: 'repo', paths: ['readme.txt'], message: 'Denied' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'READ_ONLY' })
    for (const operation of ['push', 'reset', 'rebase', 'clean', 'checkout'])
      expect(() =>
        inspect.inputSchema.parse({ rootId: 'repo', operation }),
      ).toThrow()
    expect(() =>
      add.inputSchema.parse({ rootId: 'repo', paths: ['.git/config'] }),
    ).toThrow()
    expect(() =>
      add.inputSchema.parse({ rootId: 'repo', paths: ['../escape'] }),
    ).toThrow()
    expect(() =>
      inspect.inputSchema.parse({ rootId: 'repo', operation: 'diff' }),
    ).toThrow()
    expect(() =>
      commit.inputSchema.parse({
        rootId: 'repo',
        paths: ['readme.txt'],
        message: 'Text',
        amend: true,
      }),
    ).toThrow()
  })
  it('does not include unrelated staged files or unstaged-only files in a commit', async () => {
    const [, add, commit] = tools()
    const before = (await raw(['rev-parse', 'HEAD'])).stdout.trim()
    await fs.writeFile(path.join(space.directory, 'readme.txt'), 'Changed\n')
    await expect(
      commit.execute(
        { rootId: 'repo', paths: ['readme.txt'], message: 'Denied unstaged' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'GIT_STAGING_DENIED' })
    await fs.writeFile(path.join(space.directory, 'other.txt'), 'Other\n')
    await add.execute(
      { rootId: 'repo', paths: ['readme.txt', 'other.txt'] },
      context(),
    )
    await expect(
      commit.execute(
        { rootId: 'repo', paths: ['readme.txt'], message: 'Denied unrelated' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'GIT_STAGING_DENIED' })
    expect((await raw(['rev-parse', 'HEAD'])).stdout.trim()).toBe(before)
  })
  it('disables pre-commit hooks, fsmonitor hooks, external diffs and text conversion', async () => {
    const [inspect, add, commit] = tools()
    const marker = path.join(space.directory, 'helper-ran.txt')
    const script = path.join(space.directory, '.git', 'hostile-helper')
    await fs.writeFile(script, '#!/bin/sh\nprintf helper > helper-ran.txt\n', {
      mode: 0o755,
    })
    await fs.copyFile(
      script,
      path.join(space.directory, '.git', 'hooks', 'pre-commit'),
    )
    await fs.chmod(
      path.join(space.directory, '.git', 'hooks', 'pre-commit'),
      0o755,
    )
    await raw(['config', 'core.fsmonitor', script.replaceAll('\\', '/')])
    await raw(['config', 'diff.external', script.replaceAll('\\', '/')])
    await raw(['config', 'diff.hostile.textconv', script.replaceAll('\\', '/')])
    await fs.writeFile(
      path.join(space.directory, '.gitattributes'),
      'readme.txt diff=hostile\n',
    )
    await fs.writeFile(
      path.join(space.directory, 'readme.txt'),
      'Changed content\n',
    )
    await inspect.execute({ rootId: 'repo', operation: 'status' }, context())
    expect(
      (
        await inspect.execute(
          { rootId: 'repo', operation: 'diff', paths: ['readme.txt'] },
          context(),
        )
      ).stdout,
    ).toContain('Changed content')
    await add.execute({ rootId: 'repo', paths: ['readme.txt'] }, context())
    await commit.execute(
      {
        rootId: 'repo',
        paths: ['readme.txt'],
        message: 'Hook-free local commit',
      },
      context(),
    )
    expect(
      await fs.stat(marker).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
  it('rejects custom clean/process filters before staging invokes them', async () => {
    const [, add] = tools()
    await raw([
      'config',
      'filter.hostile.clean',
      'echo FILTER_RAN > filter-ran.txt',
    ])
    await raw([
      'config',
      'filter.hostile.process',
      'echo FILTER_RAN > filter-ran.txt',
    ])
    await fs.writeFile(
      path.join(space.directory, '.gitattributes'),
      'readme.txt filter=hostile\n',
    )
    await fs.writeFile(path.join(space.directory, 'readme.txt'), 'Changed\n')
    await expect(
      add.execute({ rootId: 'repo', paths: ['readme.txt'] }, context()),
    ).rejects.toMatchObject({ code: 'GIT_CONFIG_DENIED' })
    expect(
      await fs.stat(path.join(space.directory, 'filter-ran.txt')).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
  it('rejects external config includes and shared object storage', async () => {
    const [inspect] = tools()
    await raw(['config', 'include.path', '../outside.config'])
    await expect(
      inspect.execute({ rootId: 'repo', operation: 'status' }, context()),
    ).rejects.toMatchObject({ code: 'GIT_CONFIG_DENIED' })
    await raw(['config', '--unset', 'include.path'])
    await fs.mkdir(path.join(space.directory, '.git', 'objects', 'info'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(space.directory, '.git', 'objects', 'info', 'alternates'),
      '../outside-objects\n',
    )
    await expect(
      inspect.execute({ rootId: 'repo', operation: 'status' }, context()),
    ).rejects.toMatchObject({ code: 'GIT_ROOT_DENIED' })
  })
  it('rejects linked selected files and cancellation before mutation', async () => {
    const [, add] = tools()
    await fs.link(
      path.join(space.directory, 'readme.txt'),
      path.join(space.directory, 'linked.txt'),
    )
    await expect(
      add.execute({ rootId: 'repo', paths: ['linked.txt'] }, context()),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    const cancellation = new AbortController()
    cancellation.abort()
    await expect(
      add.execute(
        { rootId: 'repo', paths: ['readme.txt'] },
        context(cancellation.signal),
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect((await raw(['diff', '--cached', '--name-only'])).stdout).toBe('')
  })
  it.each(['remote.origin.promisor', 'extensions.partialClone'])(
    'rejects lazy-fetch repository configuration %s',
    async (key) => {
      const [inspect] = tools()
      await raw(['config', key, key.endsWith('promisor') ? 'true' : 'origin'])
      await expect(
        inspect.execute({ rootId: 'repo', operation: 'status' }, context()),
      ).rejects.toMatchObject({ code: 'GIT_CONFIG_DENIED' })
    },
  )
})
