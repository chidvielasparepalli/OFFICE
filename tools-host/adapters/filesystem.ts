import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { ToolFault, type Tool } from '../../src/tools/toolTypes.ts'
import { relativePath, resolvePath } from './paths.ts'
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

export interface FilesystemPolicy {
  readonly roots: HostRoots
  readonly maxBytes?: number
}
type ReadInput = { rootId: string; path: string }
type WriteInput = ReadInput & { content: string }
type Digest = { bytes: number; sha256: string }
type ReadOutput = Digest & { content: string }

function digest(buffer: Buffer): Digest {
  return {
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}
function digestOutput(value: unknown): Digest {
  const source = object(value, ['bytes', 'sha256'])
  assertTool(
    Number.isSafeInteger(source.bytes) &&
      (source.bytes as number) >= 0 &&
      typeof source.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(source.sha256),
    'INVALID_OUTPUT',
    'File result must contain its byte count and SHA-256 digest.',
  )
  return { bytes: source.bytes as number, sha256: source.sha256 }
}

export function createFilesystemTools(
  policy: FilesystemPolicy,
): readonly [Tool<ReadInput, ReadOutput>, Tool<WriteInput, Digest>] {
  const maxBytes = boundedInteger(policy.maxBytes, 64 * 1024, 1024 * 1024)
  const input = (value: unknown, write = false) => {
    const source = object(
      value,
      write ? ['rootId', 'path', 'content'] : ['rootId', 'path'],
    )
    return { rootId: rootId(source.rootId), path: relativePath(source.path) }
  }
  const common = {
    category: 'filesystem' as const,
    timeoutMs: 5000,
    metadata: { hostOnly: true, maxBytes },
  }
  const read: Tool<ReadInput, ReadOutput> = {
    ...common,
    id: 'filesystem.read',
    name: 'Read workspace text',
    description: 'Read a bounded UTF-8 file from a configured workspace.',
    capabilities: ['filesystem.read'],
    permissions: ['read'],
    allowedKinds: ['standard-worker', 'manager'],
    inputSchema: schema('Named root and relative regular-file path.', (value) =>
      input(value),
    ),
    outputSchema: schema(
      'Bounded UTF-8 text, byte count and digest.',
      (value) => {
        const source = object(value, ['content', 'bytes', 'sha256'])
        const content = text(source.content, 'File output', maxBytes, true)
        const result = digestOutput({
          bytes: source.bytes,
          sha256: source.sha256,
        })
        assertTool(
          Buffer.byteLength(content) === result.bytes &&
            result.bytes <= maxBytes,
          'INVALID_OUTPUT',
          'File output exceeds its byte contract.',
        )
        return { content, ...result }
      },
    ),
    summarizeInput: ({ rootId: id }) => ({ rootId: id, operation: 'read' }),
    async execute(raw, context) {
      const request = read.inputSchema.parse(raw)
      abort(context.signal)
      try {
        const resolved = await resolvePath(
          policy.roots,
          request.rootId,
          request.path,
        )
        const handle = await fs.open(
          resolved.absolute,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        )
        try {
          const stat = await handle.stat()
          assertTool(
            stat.isFile() && stat.nlink === 1,
            'PATH_DENIED',
            'Only an ordinary unlinked file is readable.',
          )
          assertTool(
            stat.size <= maxBytes,
            'OUTPUT_LIMIT',
            'File exceeds the configured read limit.',
          )
          const chunks: Buffer[] = []
          let bytes = 0
          while (bytes <= maxBytes) {
            abort(context.signal)
            const chunk = Buffer.alloc(Math.min(16384, maxBytes + 1 - bytes))
            const read = await handle.read(chunk, 0, chunk.length, bytes)
            if (read.bytesRead === 0) break
            bytes += read.bytesRead
            chunks.push(chunk.subarray(0, read.bytesRead))
          }
          assertTool(
            bytes <= maxBytes,
            'OUTPUT_LIMIT',
            'File exceeds the configured read limit.',
          )
          const buffer = Buffer.concat(chunks)
          let content: string
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
          } catch {
            throw new ToolFault(
              'INVALID_TEXT',
              'Only valid UTF-8 text files are supported.',
            )
          }
          abort(context.signal)
          return { content, ...digest(buffer) }
        } finally {
          await handle.close()
        }
      } catch (error) {
        return safeError(error)
      }
    },
  }
  const write: Tool<WriteInput, Digest> = {
    ...common,
    id: 'filesystem.write',
    name: 'Write workspace text',
    description:
      'Atomically write a bounded UTF-8 file in an existing permitted directory.',
    capabilities: ['filesystem.write'],
    permissions: ['write'],
    allowedKinds: ['standard-worker'],
    inputSchema: schema(
      'Named writable root, relative file path and bounded text.',
      (value) => {
        const fields = input(value, true)
        const source = value as Record<string, unknown>
        const content = text(source.content, 'File content', maxBytes, true)
        assertTool(
          Buffer.byteLength(content) <= maxBytes,
          'INPUT_LIMIT',
          'Content exceeds the configured byte limit.',
        )
        return { ...fields, content }
      },
    ),
    outputSchema: schema(
      'Written byte count and SHA-256 digest.',
      digestOutput,
    ),
    summarizeInput: ({ rootId: id, content }) => ({
      rootId: id,
      operation: 'write',
      bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    }),
    async execute(raw, context) {
      const request = write.inputSchema.parse(raw)
      abort(context.signal)
      let temporary: string | undefined
      try {
        const resolved = await resolvePath(
          policy.roots,
          request.rootId,
          request.path,
          { write: true, missing: true },
        )
        const buffer = Buffer.from(request.content)
        temporary = path.join(
          path.dirname(resolved.absolute),
          `.office-write-${randomUUID()}`,
        )
        const handle = await fs.open(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        )
        try {
          abort(context.signal)
          await handle.writeFile(buffer)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await resolvePath(policy.roots, request.rootId, request.path, {
          write: true,
          missing: true,
        })
        abort(context.signal)
        await fs.rename(temporary, resolved.absolute)
        temporary = undefined
        return digest(buffer)
      } catch (error) {
        return safeError(error)
      } finally {
        if (temporary) await fs.unlink(temporary).catch(() => {})
      }
    },
  }
  return Object.freeze([read, write])
}
