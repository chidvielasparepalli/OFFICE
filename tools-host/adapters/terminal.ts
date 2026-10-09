import type { Tool } from '../../src/tools/toolTypes.ts'
import { relativePath, resolvePath } from './paths.ts'
import {
  processOutput,
  requireSuccess,
  runProcess,
  type ProcessOutput,
  type ProcessPolicy,
} from './process.ts'
import {
  abort,
  assertTool,
  boundedInteger,
  object,
  rootId,
  schema,
  type HostRoots,
} from './shared.ts'

export interface TerminalCommand {
  readonly executable: string
  readonly args: readonly string[]
  /** Private host deadline; never accepted in caller input or above the tool limit. */
  readonly timeoutMs?: number
}
export interface TerminalPolicy extends ProcessPolicy {
  readonly roots: HostRoots
  readonly commands: Readonly<Record<string, Readonly<TerminalCommand>>>
}
type TerminalInput = { rootId: string; cwd: string; commandId: string }

export function createTerminalTool(
  policy: TerminalPolicy,
): Tool<TerminalInput, ProcessOutput> {
  const timeoutMs = boundedInteger(policy.timeoutMs, 10000, 120000)
  const maxOutputBytes = boundedInteger(
    policy.maxOutputBytes,
    64 * 1024,
    1024 * 1024,
  )
  const commands = new Map(
    Object.entries(policy.commands).map(([id, command]) => [
      id,
      {
        executable: command.executable,
        args: [...command.args],
        timeoutMs:
          command.timeoutMs === undefined
            ? timeoutMs
            : boundedInteger(command.timeoutMs, 0, timeoutMs),
      },
    ]),
  )
  const tool: Tool<TerminalInput, ProcessOutput> = {
    id: 'terminal.run',
    name: 'Run permitted command',
    description:
      'Run one fixed host-configured command in an explicit permitted working directory.',
    category: 'terminal',
    capabilities: ['terminal.run'],
    permissions: ['execute'],
    allowedKinds: ['standard-worker'],
    timeoutMs,
    metadata: { hostOnly: true, shell: false, maxOutputBytes },
    inputSchema: schema(
      'Configured command ID, named root and relative working directory; no command text, arguments or environment.',
      (value) => {
        const source = object(value, ['rootId', 'cwd', 'commandId'])
        const commandId = rootId(source.commandId)
        assertTool(
          commands.has(commandId),
          'COMMAND_DENIED',
          'The command is not in the host allowlist.',
        )
        return {
          rootId: rootId(source.rootId),
          cwd: relativePath(source.cwd, true),
          commandId,
        }
      },
    ),
    outputSchema: schema(
      'Bounded stdout, stderr and integer exit code.',
      (value) => processOutput(value, maxOutputBytes),
    ),
    summarizeInput: ({ rootId, commandId }) => ({ rootId, commandId }),
    async execute(raw, context) {
      const input = tool.inputSchema.parse(raw)
      abort(context.signal)
      const cwd = await resolvePath(policy.roots, input.rootId, input.cwd, {
        directory: true,
      })
      const command = commands.get(input.commandId)!
      return requireSuccess(
        await runProcess({
          ...command,
          cwd: cwd.absolute,
          signal: context.signal,
          maxOutputBytes,
        }),
      )
    },
  }
  return tool
}
