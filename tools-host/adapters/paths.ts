import * as fs from 'node:fs/promises'
import path from 'node:path'
import {
  assertTool,
  rootId,
  safeError,
  text,
  type HostRoots,
} from './shared.ts'

const protectedNames = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.azure',
  '.kube',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.gitconfig',
  'credentials',
  'id_rsa',
  'id_ed25519',
])

/** Portable subset also rejects Windows device paths and alternate data streams. */
export function relativePath(value: unknown, allowRoot = false): string {
  const input = text(value, 'Relative path', 1024)
  if (allowRoot && input === '.') return input
  assertTool(
    !path.posix.isAbsolute(input) &&
      !path.win32.isAbsolute(input) &&
      !input.includes(':') &&
      !input.startsWith('\\'),
    'PATH_DENIED',
    'Only relative workspace paths are allowed.',
  )
  const parts = input.split(/[\\/]/)
  assertTool(
    parts.every(
      (part) =>
        part !== '' &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/.test(part) &&
        ![...part].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part),
    ),
    'PATH_DENIED',
    'Traversal, ambiguous paths and device names are not allowed.',
  )
  assertTool(
    parts.every(
      (part) =>
        !protectedNames.has(part.toLowerCase()) &&
        !/^\.env(?:\.|$)/i.test(part) &&
        !/\.(pem|key)$/i.test(part),
    ),
    'PATH_DENIED',
    'Credential and repository-control paths are not available to filesystem tools.',
  )
  return parts.join(path.sep)
}

export function contained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
}

export async function resolveRoot(roots: HostRoots, id: string, write = false) {
  rootId(id)
  assertTool(
    Object.hasOwn(roots, id),
    'ROOT_DENIED',
    'The requested workspace root is not configured.',
  )
  const root = roots[id]
  assertTool(
    !write || root.writable === true,
    'READ_ONLY',
    'This workspace root is read-only.',
  )
  assertTool(
    path.isAbsolute(root.path),
    'INVALID_POLICY',
    'Configured host roots must be absolute.',
  )
  try {
    const canonical = await fs.realpath(root.path)
    assertTool(
      (await fs.stat(canonical)).isDirectory(),
      'INVALID_POLICY',
      'Configured host root must be a directory.',
    )
    return canonical
  } catch (error) {
    return safeError(error)
  }
}

export async function resolvePath(
  roots: HostRoots,
  id: string,
  relative: string,
  options: { write?: boolean; directory?: boolean; missing?: boolean } = {},
) {
  const normalized = relativePath(relative, options.directory)
  const root = await resolveRoot(roots, id, options.write)
  const parts = normalized === '.' ? [] : normalized.split(path.sep)
  let current = root
  try {
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index])
      const last = index === parts.length - 1
      let stat
      try {
        stat = await fs.lstat(current)
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' &&
          last &&
          options.missing
        )
          return { root, absolute: current }
        throw error
      }
      assertTool(
        !stat.isSymbolicLink(),
        'PATH_DENIED',
        'Symbolic links and directory junctions are not allowed.',
      )
      assertTool(
        contained(root, await fs.realpath(current)),
        'PATH_DENIED',
        'The resolved path escapes its workspace root.',
      )
      if (!last || options.directory)
        assertTool(
          stat.isDirectory(),
          'PATH_DENIED',
          'A directory was required.',
        )
      else
        assertTool(
          stat.isFile() && stat.nlink === 1,
          'PATH_DENIED',
          'Only ordinary files with one hard link are allowed.',
        )
    }
    assertTool(
      parts.length > 0 || options.directory,
      'PATH_DENIED',
      'A file path is required.',
    )
    return { root, absolute: current }
  } catch (error) {
    return safeError(error)
  }
}
