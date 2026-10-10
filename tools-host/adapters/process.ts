import { spawn } from 'node:child_process'
import path from 'node:path'
import { ToolFault } from '../../src/tools/toolTypes.ts'
import { abort, assertTool, boundedInteger, object, text } from './shared.ts'

export type ProcessOutput = { exitCode: number; stdout: string; stderr: string }
export interface ProcessPolicy {
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

export function isolatedEnvironment(): NodeJS.ProcessEnv {
  // Windows may synthesize an inherited PATH when the variable is omitted.
  const env: NodeJS.ProcessEnv = {
    PATH: '',
    LANG: 'C.UTF-8',
    LC_ALL: 'C',
    NO_COLOR: '1',
  }
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP'])
    if (process.env[key]) env[key] = process.env[key]
  return env
}

export function processOutput(value: unknown, maxBytes: number): ProcessOutput {
  const source = object(value, ['exitCode', 'stdout', 'stderr'])
  assertTool(
    Number.isSafeInteger(source.exitCode),
    'INVALID_OUTPUT',
    'Process exit code must be an integer.',
  )
  const stdout = text(source.stdout, 'Standard output', maxBytes, true)
  const stderr = text(source.stderr, 'Standard error', maxBytes, true)
  assertTool(
    Buffer.byteLength(stdout) + Buffer.byteLength(stderr) <= maxBytes,
    'INVALID_OUTPUT',
    'Process output exceeds its byte limit.',
  )
  return { exitCode: source.exitCode as number, stdout, stderr }
}

export function requireSuccess(output: ProcessOutput) {
  if (output.exitCode !== 0)
    throw new ToolFault(
      'PROCESS_EXIT',
      `Process exited with code ${output.exitCode}.`,
    )
  return output
}

/** Host-owned executable/arguments only. This is a policy boundary, not an OS sandbox. */
export async function runProcess(
  options: ProcessPolicy & {
    executable: string
    args: readonly string[]
    cwd: string
    signal: AbortSignal
    env?: NodeJS.ProcessEnv
  },
): Promise<ProcessOutput> {
  abort(options.signal)
  assertTool(
    path.isAbsolute(options.executable) &&
      !/\.(bat|cmd|ps1)$/i.test(options.executable) &&
      !/^(cmd|powershell|pwsh|bash|sh|zsh|dash|csh|wscript|cscript)(?:\.exe)?$/i.test(
        path.basename(options.executable),
      ),
    'INVALID_POLICY',
    'A trusted absolute native executable is required.',
  )
  assertTool(
    options.args.every(
      (argument) => typeof argument === 'string' && !argument.includes('\0'),
    ),
    'INVALID_POLICY',
    'Configured arguments must be plain strings.',
  )
  const timeoutMs = boundedInteger(options.timeoutMs, 10000, 120000)
  const maxOutputBytes = boundedInteger(
    options.maxOutputBytes,
    64 * 1024,
    1024 * 1024,
  )
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...isolatedEnvironment(), ...options.env },
    })
    const stdout: Buffer[] = [],
      stderr: Buffer[] = []
    let bytes = 0
    let failure: ToolFault | null = null
    let closed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = (fault: ToolFault) => {
      if (closed || failure) return
      failure = fault
      if (!child.pid) return
      if (process.platform === 'win32') {
        // taskkill receives only the PID allocated by this adapter, never caller text.
        const killer = spawn(
          path.join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'taskkill.exe',
          ),
          ['/PID', String(child.pid), '/T', '/F'],
          {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
            env: isolatedEnvironment(),
          },
        )
        killer.on('error', () => child.kill('SIGKILL'))
        killer.on('close', () => {
          if (!closed) child.kill('SIGKILL')
        })
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
      killTimer = setTimeout(() => {
        if (!closed) child.kill('SIGKILL')
      }, 1000)
      killTimer.unref()
    }
    const capture = (target: Buffer[], chunk: Buffer) => {
      if (failure) return
      bytes += chunk.length
      if (bytes > maxOutputBytes)
        terminate(
          new ToolFault(
            'OUTPUT_LIMIT',
            'Process output exceeded the configured byte limit.',
          ),
        )
      else target.push(chunk)
    }
    const onAbort = () =>
      terminate(new ToolFault('CANCELLED', 'Execution was cancelled.'))
    const timer = setTimeout(
      () =>
        terminate(
          new ToolFault(
            'TIMEOUT',
            'Process exceeded the configured execution time.',
          ),
        ),
      timeoutMs,
    )
    options.signal.addEventListener('abort', onAbort, { once: true })
    if (options.signal.aborted) onAbort()
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk))
    child.on('error', () => {
      failure ??= new ToolFault(
        'PROCESS_START_FAILED',
        'The configured process could not be started.',
      )
    })
    child.on('close', (code) => {
      closed = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal.removeEventListener('abort', onAbort)
      if (failure) reject(failure)
      else if (code === null)
        reject(
          new ToolFault(
            'PROCESS_EXIT',
            'Process terminated without an exit code.',
          ),
        )
      else
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
    })
  })
}
