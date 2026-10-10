import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolContext } from '../../src/tools/toolTypes.ts'
import { contained } from './paths.ts'

export const exec = promisify(execFile)
export const context = (
  signal = new AbortController().signal,
): ToolContext => ({
  executionId: 'test-execution',
  agentId: 'test-worker',
  taskId: 'test-task',
  signal,
})

export async function sandbox() {
  const base = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(base, 'office-adapters-test-'))
  return {
    directory,
    async cleanup() {
      const absolute = path.resolve(directory)
      if (
        !contained(base, absolute) ||
        !path.basename(absolute).startsWith('office-adapters-test-') ||
        absolute === base
      )
        throw new Error('Unsafe test cleanup target')
      await fs.rm(absolute, { recursive: true, force: true })
    },
  }
}

export async function gitExecutable() {
  for (const candidate of process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files\\Git\\bin\\git.exe',
      ]
    : ['/usr/bin/git', '/usr/local/bin/git'])
    if (
      await fs.stat(candidate).then(
        (stat) => stat.isFile(),
        () => false,
      )
    )
      return candidate
  throw new Error(
    'Native Git is required for the host adapter integration tests.',
  )
}
