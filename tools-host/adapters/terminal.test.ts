// @vitest-environment node
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTerminalTool } from './terminal.ts'
import { context, sandbox } from './testSupport.ts'

let space: Awaited<ReturnType<typeof sandbox>>
beforeEach(async () => {
  space = await sandbox()
})
afterEach(async () => {
  await space.cleanup()
})
const tool = (script: string, timeoutMs = 3000, maxOutputBytes = 65536) =>
  createTerminalTool({
    roots: { workspace: { path: space.directory } },
    commands: { fixed: { executable: process.execPath, args: ['-e', script] } },
    timeoutMs,
    maxOutputBytes,
  })
const input = { rootId: 'workspace', cwd: '.', commandId: 'fixed' }

describe('controlled terminal adapter', () => {
  it('runs only a fixed native argument vector and captures actual output/exit code', async () => {
    const terminal = tool(
      "process.stdout.write('actual output');process.stderr.write('warning')",
    )
    const output = await terminal.execute(input, context())
    expect(terminal.outputSchema.parse(output)).toEqual({
      exitCode: 0,
      stdout: 'actual output',
      stderr: 'warning',
    })
    expect(terminal.allowedKinds).toEqual(['standard-worker'])
  })
  it('rejects unknown commands, extra argv/env/shell and escaped working directories before launch', async () => {
    const terminal = tool("require('node:fs').writeFileSync('ran.txt','yes')")
    for (const denied of [
      { ...input, commandId: 'rm' },
      { ...input, commandId: 'fixed;rm' },
      { ...input, argv: ['--eval', 'bad'] },
      { ...input, env: { SECRET: 'value' } },
      { ...input, shell: true },
      { ...input, timeoutMs: 120000 },
      { ...input, cwd: '..' },
    ])
      expect(() => terminal.inputSchema.parse(denied)).toThrow()
    await expect(
      terminal.execute({ ...input, rootId: 'missing' }, context()),
    ).rejects.toMatchObject({ code: 'ROOT_DENIED' })
    expect(await fs.readdir(space.directory)).toEqual([])
  })
  it('does not inherit credential-like environment or executable search paths', async () => {
    const previous = process.env.OFFICE_ADAPTER_TEST_SECRET
    process.env.OFFICE_ADAPTER_TEST_SECRET = 'test-only-do-not-inherit'
    try {
      const output = await tool(
        'process.stdout.write(JSON.stringify({secret:process.env.OFFICE_ADAPTER_TEST_SECRET??null,path:process.env.PATH??null,home:process.env.HOME??null}))',
      ).execute(input, context())
      expect(JSON.parse(output.stdout)).toEqual({
        secret: null,
        path: '',
        home: null,
      })
    } finally {
      if (previous === undefined) delete process.env.OFFICE_ADAPTER_TEST_SECRET
      else process.env.OFFICE_ADAPTER_TEST_SECRET = previous
    }
  })
  it('fails on nonzero exit, oversized output and a real process timeout', async () => {
    await expect(
      tool('process.exit(7)').execute(input, context()),
    ).rejects.toMatchObject({
      code: 'PROCESS_EXIT',
      message: 'Process exited with code 7.',
    })
    await expect(
      tool("process.stdout.write('x'.repeat(4096))", 3000, 128).execute(
        input,
        context(),
      ),
    ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' })
    await expect(
      tool('setTimeout(()=>{},10000)', 100).execute(input, context()),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
  it('applies a shorter private profile deadline while omitted deadlines retain the overall limit', async () => {
    const terminal = createTerminalTool({
      roots: { workspace: { path: space.directory } },
      timeoutMs: 3000,
      commands: {
        fixed: {
          executable: process.execPath,
          args: ['-e', 'setTimeout(()=>process.stdout.write("too late"),500)'],
          timeoutMs: 100,
        },
        default: {
          executable: process.execPath,
          args: ['-e', 'setTimeout(()=>process.stdout.write("finished"),250)'],
        },
      },
    })
    expect(terminal.timeoutMs).toBe(3000)
    await expect(terminal.execute(input, context())).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    expect(
      await terminal.execute({ ...input, commandId: 'default' }, context()),
    ).toMatchObject({ exitCode: 0, stdout: 'finished' })
  })
  it('rejects invalid or over-limit host profile deadlines before any process launches', async () => {
    for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 3001])
      expect(() =>
        createTerminalTool({
          roots: { workspace: { path: space.directory } },
          timeoutMs: 3000,
          commands: {
            fixed: { executable: process.execPath, args: [], timeoutMs },
          },
        }),
      ).toThrow('positive bounded integer')
    expect(await fs.readdir(space.directory)).toEqual([])
  })
  it('rejects shell executables even in a misconfigured host profile', async () => {
    const terminal = createTerminalTool({
      roots: { workspace: { path: space.directory } },
      commands: {
        fixed: {
          executable: path.join(space.directory, 'cmd.exe'),
          args: ['/c', 'echo denied'],
        },
      },
    })
    await expect(terminal.execute(input, context())).rejects.toMatchObject({
      code: 'INVALID_POLICY',
    })
  })
  it('cancels an actual running child and waits until it no longer exists', async () => {
    const terminal = tool(
      "require('node:fs').writeFileSync('pid.txt',String(process.pid));setTimeout(()=>{},10000)",
    )
    const cancellation = new AbortController()
    const pending = terminal.execute(input, context(cancellation.signal))
    const failed = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    let pid = 0
    for (let attempt = 0; attempt < 200 && !pid; attempt++) {
      pid = Number(
        await fs
          .readFile(path.join(space.directory, 'pid.txt'), 'utf8')
          .catch(() => '0'),
      )
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    cancellation.abort()
    await failed
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it.skipIf(process.platform !== 'win32')(
    'terminates an owned Windows child process tree on cancellation',
    async () => {
      const terminal = tool(
        "const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('tree.txt',JSON.stringify([process.pid,child.pid]));setTimeout(()=>{},10000)",
      )
      const cancellation = new AbortController()
      const pending = terminal.execute(input, context(cancellation.signal))
      const failed = expect(pending).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      let pids: number[] = []
      for (let attempt = 0; attempt < 200 && !pids.length; attempt++) {
        const recorded = await fs
          .readFile(path.join(space.directory, 'tree.txt'), 'utf8')
          .catch(() => '')
        if (recorded) pids = JSON.parse(recorded)
        else await new Promise((resolve) => setTimeout(resolve, 10))
      }
      cancellation.abort()
      await failed
      expect(pids).toHaveLength(2)
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
    },
  )
  it('does not start a pre-cancelled command and rejects linked working directories', async () => {
    const cancellation = new AbortController()
    cancellation.abort()
    const terminal = tool("require('node:fs').writeFileSync('ran.txt','yes')")
    await expect(
      terminal.execute(input, context(cancellation.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    const outside = path.join(space.directory, 'outside')
    await fs.mkdir(outside)
    await fs.symlink(
      outside,
      path.join(space.directory, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      terminal.execute({ ...input, cwd: 'linked' }, context()),
    ).rejects.toMatchObject({ code: 'PATH_DENIED' })
    expect(await fs.readdir(outside)).toEqual([])
  })
})
