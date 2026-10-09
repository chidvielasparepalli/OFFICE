// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createSandbox } from './fixtures'
import { createGitTools } from '../adapters/git'
import { context, sandbox } from '../adapters/testSupport'

const sandboxes: Awaited<ReturnType<typeof sandbox>>[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const item of sandboxes.splice(0)) await item.cleanup()
})

describe('disposable repository bootstrap', () => {
  it('ignores ambient Git configuration, redirection and templates while creating a real inspectable commit', async () => {
    const owned = await sandbox()
    sandboxes.push(owned)
    const poisonedTemplate = path.join(owned.directory, 'ambient-template')
    await mkdir(poisonedTemplate)
    await writeFile(
      path.join(poisonedTemplate, 'foreign-template.txt'),
      'Must not enter the new repository.',
    )
    const outsideIndex = path.join(owned.directory, 'ambient-index')
    const ambientTrace = path.join(owned.directory, 'ambient-trace')
    const ambientConfig = path.join(owned.directory, 'ambient-config')
    await writeFile(
      ambientConfig,
      `[init]\n\ttemplateDir = "${poisonedTemplate.replaceAll('\\', '/')}"\n[filter "unsafe"]\n\tclean = false\n`,
    )
    for (const [key, value] of Object.entries({
      GIT_CONFIG_GLOBAL: ambientConfig,
      GIT_CONFIG_SYSTEM: ambientConfig,
      GIT_TEMPLATE_DIR: poisonedTemplate,
      GIT_INDEX_FILE: outsideIndex,
      GIT_TRACE: ambientTrace,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.bare',
      GIT_CONFIG_VALUE_0: 'true',
    }))
      vi.stubEnv(key, value)

    const created = await createSandbox(
      owned.directory,
      '12345678-1234-1234-1234-123456789abc',
    )
    expect(
      await readFile(path.join(created.sandbox, 'readme.txt'), 'utf8'),
    ).toContain('Explicit staged-change demonstration.')
    for (const filename of [
      outsideIndex,
      ambientTrace,
      path.join(created.sandbox, '.git', 'foreign-template.txt'),
      path.join(created.sandbox, '.git', 'hooks'),
    ])
      await expect(access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
    const [inspect] = createGitTools({
      roots: { fixture: { path: created.sandbox } },
      executable: created.git,
      author: { name: 'Fixture test', email: 'fixture@example.invalid' },
    })
    const result = await inspect.execute(
      { rootId: 'fixture', operation: 'log' },
      context(),
    )
    expect(result.stdout).toMatch(
      /^[a-f0-9]+ Initialize disposable development fixture\s*$/,
    )
    expect(result.exitCode).toBe(0)
  }, 15000)
})
