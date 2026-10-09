import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Tool, ToolContext } from '../../src/tools/toolTypes.ts'
import { contained, relativePath, resolvePath, resolveRoot } from './paths.ts'
import {
  processOutput,
  requireSuccess,
  runProcess,
  type ProcessPolicy,
} from './process.ts'
import {
  abort,
  assertTool,
  boundedInteger,
  object,
  rootId,
  safeError,
  schema,
  text,
  type HostRoots,
} from './shared.ts'

export interface GitPolicy extends ProcessPolicy {
  readonly roots: HostRoots
  readonly executable: string
  readonly author: { readonly name: string; readonly email: string }
}
type InspectInput = {
  rootId: string
  operation: 'status' | 'diff' | 'log' | 'branch'
  paths?: readonly string[]
}
type AddInput = { rootId: string; paths: readonly string[] }
type CommitInput = AddInput & { message: string }
type GitOutput = {
  operation: string
  exitCode: number
  stdout: string
  stderr: string
  commit: string | null
}

function paths(value: unknown): readonly string[] {
  assertTool(
    Array.isArray(value) && value.length > 0 && value.length <= 32,
    'INVALID_INPUT',
    'Select between one and 32 explicit file paths.',
  )
  const result = Array.from(value, (item) => relativePath(item))
  const keys = result.map((item) =>
    process.platform === 'win32' ? item.toLowerCase() : item,
  )
  assertTool(
    new Set(keys).size === result.length,
    'INVALID_INPUT',
    'Selected paths must be unique.',
  )
  return Object.freeze(result)
}

export function createGitTools(
  policy: GitPolicy,
): readonly [
  Tool<InspectInput, GitOutput>,
  Tool<AddInput, GitOutput>,
  Tool<CommitInput, GitOutput>,
] {
  const timeoutMs = boundedInteger(policy.timeoutMs, 10000, 120000)
  const maxOutputBytes = boundedInteger(
    policy.maxOutputBytes,
    64 * 1024,
    1024 * 1024,
  )
  const authorName = text(policy.author.name, 'Configured Git author name', 120)
  const authorEmail = text(
    policy.author.email,
    'Configured Git author email',
    200,
  )
  assertTool(
    !/[\r\n<>]/.test(authorName) && /^[^\s<>@]+@[^\s<>@]+$/.test(authorEmail),
    'INVALID_POLICY',
    'A fixed valid Git author identity is required.',
  )
  const locks = new Map<string, Promise<void>>()
  const outputSchema = schema<GitOutput>(
    'Bounded Git command output and optional resulting commit ID.',
    (value) => {
      const source = object(value, [
        'operation',
        'exitCode',
        'stdout',
        'stderr',
        'commit',
      ])
      const output = processOutput(
        {
          exitCode: source.exitCode,
          stdout: source.stdout,
          stderr: source.stderr,
        },
        maxOutputBytes,
      )
      assertTool(
        ['status', 'diff', 'log', 'branch', 'add', 'commit'].includes(
          source.operation as string,
        ) &&
          (source.commit === null ||
            (typeof source.commit === 'string' &&
              /^[a-f0-9]{40,64}$/.test(source.commit))),
        'INVALID_OUTPUT',
        'Git output contains invalid operation or commit metadata.',
      )
      return {
        ...output,
        operation: source.operation as string,
        commit: source.commit as string | null,
      }
    },
  )
  const common = {
    category: 'git' as const,
    timeoutMs,
    outputSchema,
    metadata: { hostOnly: true, pushAvailable: false, maxOutputBytes },
  }

  async function execute(
    rootId: string,
    operation: GitOutput['operation'],
    selectedPaths: readonly string[],
    context: ToolContext,
    message?: string,
  ): Promise<GitOutput> {
    abort(context.signal)
    const write = operation === 'add' || operation === 'commit'
    const root = await resolveRoot(policy.roots, rootId, write)
    const previous = locks.get(root) ?? Promise.resolve()
    let release!: () => void
    const lock = new Promise<void>((resolve) => {
      release = resolve
    })
    locks.set(root, lock)
    await previous
    let hooks: string | undefined
    try {
      abort(context.signal)
      const gitDir = path.join(root, '.git')
      const gitStat = await fs.lstat(gitDir)
      assertTool(
        gitStat.isDirectory() &&
          !gitStat.isSymbolicLink() &&
          contained(root, await fs.realpath(gitDir)),
        'GIT_ROOT_DENIED',
        'Only a standalone repository inside the configured root is permitted.',
      )
      for (const name of ['config', 'HEAD', 'index', 'objects', 'refs']) {
        const filename = path.join(gitDir, name)
        const stat = await fs
          .lstat(filename)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
        if (stat)
          assertTool(
            !stat.isSymbolicLink() &&
              (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)),
            'GIT_ROOT_DENIED',
            'Linked Git metadata is not permitted.',
          )
      }
      const configPath = path.join(gitDir, 'config')
      assertTool(
        (await fs.stat(configPath)).size <= 65536,
        'GIT_CONFIG_DENIED',
        'Repository configuration exceeds its safety limit.',
      )
      const configText = await fs.readFile(configPath, 'utf8')
      assertTool(
        !/^\s*\[\s*(?:include|includeif|filter)(?:[.\s"\]])/im.test(
          configText,
        ) && !/^\s*(?:promisor|partialclone)\s*=/im.test(configText),
        'GIT_CONFIG_DENIED',
        'External includes, custom filters and partial-clone configuration are denied before launching Git.',
      )
      for (const name of [
        'commondir',
        'config.worktree',
        path.join('objects', 'info', 'alternates'),
      ])
        assertTool(
          !(await fs.lstat(path.join(gitDir, name)).then(
            () => true,
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return false
              throw error
            },
          )),
          'GIT_ROOT_DENIED',
          'External or shared Git storage is not permitted.',
        )
      hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'office-git-hooks-'))
      const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const base = [
        '--no-pager',
        '--literal-pathspecs',
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'gc.auto=0',
        '-c',
        'maintenance.auto=false',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'credential.helper=',
        '-c',
        `core.attributesFile=${nullFile}`,
        '-c',
        'diff.external=',
        '-c',
        'core.pager=',
        '-c',
        'core.editor=false',
        '-c',
        `user.name=${authorName}`,
        '-c',
        `user.email=${authorEmail}`,
      ]
      const run = (args: readonly string[]) =>
        runProcess({
          executable: policy.executable,
          args: [...base, ...args],
          cwd: root,
          signal: context.signal,
          timeoutMs,
          maxOutputBytes,
          env: {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_SYSTEM: nullFile,
            GIT_CONFIG_GLOBAL: nullFile,
            GIT_ATTR_NOSYSTEM: '1',
            GIT_NO_LAZY_FETCH: '1',
            GIT_ALLOW_PROTOCOL: '',
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: '',
            SSH_ASKPASS: '',
            GIT_OPTIONAL_LOCKS: write ? '1' : '0',
          },
        })
      const config = requireSuccess(
        await run(['config', '--local', '--no-includes', '--list']),
      )
      assertTool(
        !config.stdout
          .split(/\r?\n/)
          .some(
            (line) =>
              /^(filter|include|includeif)\./i.test(line) ||
              /^(?:extensions\.partialclone|remote\..*\.promisor)=/i.test(line),
          ),
        'GIT_CONFIG_DENIED',
        'Repositories with external configuration includes or custom filters are not permitted.',
      )
      const top = requireSuccess(
        await run(['rev-parse', '--show-toplevel']),
      ).stdout.trim()
      assertTool(
        path.relative(root, await fs.realpath(top)) === '',
        'GIT_ROOT_DENIED',
        'The repository top level must equal its configured root.',
      )
      for (const selected of selectedPaths)
        await resolvePath(policy.roots, rootId, selected, { write })
      let args: string[]
      if (operation === 'status')
        args = [
          'status',
          '--porcelain=v1',
          '--untracked-files=normal',
          '--ignore-submodules=all',
        ]
      else if (operation === 'diff')
        args = [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--ignore-submodules=all',
          '--',
          ...selectedPaths,
        ]
      else if (operation === 'log')
        args = ['log', '--max-count=10', '--format=%h %s']
      else if (operation === 'branch') args = ['branch', '--show-current']
      else if (operation === 'add') args = ['add', '--', ...selectedPaths]
      else {
        const staged = requireSuccess(
          await run([
            'diff',
            '--cached',
            '--name-only',
            '-z',
            '--no-ext-diff',
            '--no-textconv',
            '--ignore-submodules=all',
          ]),
        )
          .stdout.split('\0')
          .filter(Boolean)
        const canonical = (item: string) =>
          process.platform === 'win32'
            ? item.replaceAll('\\', '/').toLowerCase()
            : item
        const selected = selectedPaths.map(canonical).sort()
        assertTool(
          staged.length > 0 &&
            JSON.stringify(staged.map(canonical).sort()) ===
              JSON.stringify(selected),
          'GIT_STAGING_DENIED',
          'Commit requires exactly the selected files to be staged, with no unrelated staged changes.',
        )
        args = ['commit', '--no-verify', '--no-gpg-sign', '--message', message!]
      }
      abort(context.signal)
      const output = requireSuccess(await run(args))
      const commit =
        operation === 'commit'
          ? requireSuccess(await run(['rev-parse', 'HEAD'])).stdout.trim()
          : null
      return { operation, ...output, commit }
    } catch (error) {
      return safeError(error)
    } finally {
      if (hooks) await fs.rmdir(hooks).catch(() => {})
      release()
      if (locks.get(root) === lock) locks.delete(root)
    }
  }

  const inspect: Tool<InspectInput, GitOutput> = {
    ...common,
    id: 'git.inspect',
    name: 'Inspect permitted repository',
    description:
      'Read status, selected-file diff, recent log or current branch without external Git helpers.',
    capabilities: ['git.inspect'],
    permissions: ['read', 'git'],
    allowedKinds: ['standard-worker', 'manager'],
    inputSchema: schema(
      'Named repository root and safe inspection operation; diff requires explicit file paths.',
      (value) => {
        const source = object(value, ['rootId', 'operation'], ['paths'])
        assertTool(
          ['status', 'diff', 'log', 'branch'].includes(
            source.operation as string,
          ),
          'INVALID_INPUT',
          'Git inspection operation is not allowed.',
        )
        if (source.operation === 'diff')
          return {
            rootId: rootId(source.rootId),
            operation: 'diff',
            paths: paths(source.paths),
          }
        assertTool(
          source.paths === undefined,
          'INVALID_INPUT',
          'Only diff accepts selected paths.',
        )
        return {
          rootId: rootId(source.rootId),
          operation: source.operation as InspectInput['operation'],
        }
      },
    ),
    summarizeInput: (input) => ({
      rootId: input.rootId,
      operation: input.operation,
      pathCount: input.paths?.length ?? 0,
    }),
    execute(raw, context) {
      const input = inspect.inputSchema.parse(raw)
      return execute(input.rootId, input.operation, input.paths ?? [], context)
    },
  }
  const add: Tool<AddInput, GitOutput> = {
    ...common,
    id: 'git.add',
    name: 'Stage explicit workspace files',
    description:
      'Stage only selected ordinary files in a writable configured repository.',
    capabilities: ['git.add'],
    permissions: ['write', 'git'],
    allowedKinds: ['standard-worker'],
    inputSchema: schema(
      'Named writable repository and explicit file paths.',
      (value) => {
        const source = object(value, ['rootId', 'paths'])
        return { rootId: rootId(source.rootId), paths: paths(source.paths) }
      },
    ),
    summarizeInput: (input) => ({
      rootId: input.rootId,
      operation: 'add',
      pathCount: input.paths.length,
    }),
    execute(raw, context) {
      const input = add.inputSchema.parse(raw)
      return execute(input.rootId, 'add', input.paths, context)
    },
  }
  const commit: Tool<CommitInput, GitOutput> = {
    ...common,
    id: 'git.commit',
    name: 'Commit explicit staged files',
    description:
      'Create a local commit for exactly the approved staged files, without hooks, signing or push.',
    capabilities: ['git.commit'],
    permissions: ['write', 'git'],
    allowedKinds: ['standard-worker'],
    inputSchema: schema(
      'Named writable repository, explicit staged paths and bounded commit message.',
      (value) => {
        const source = object(value, ['rootId', 'paths', 'message'])
        return {
          rootId: rootId(source.rootId),
          paths: paths(source.paths),
          message: text(source.message, 'Commit message', 1000),
        }
      },
    ),
    summarizeInput: (input) => ({
      rootId: input.rootId,
      operation: 'commit',
      pathCount: input.paths.length,
    }),
    execute(raw, context) {
      const input = commit.inputSchema.parse(raw)
      return execute(
        input.rootId,
        'commit',
        input.paths,
        context,
        input.message,
      )
    },
  }
  return Object.freeze([inspect, add, commit])
}
