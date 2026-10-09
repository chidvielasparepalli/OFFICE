import { existsSync } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { requireSuccess, runProcess } from '../adapters/process'
import type { RuntimeCommand } from '../../src/runtime/runtimeTypes'
import type {
  ManagerRequest,
  PlanProposal,
} from '../../src/orchestration/orchestrationTypes'
import type { ToolPreviewScenario } from '../../src/dev/toolPreviewProtocol'

export const IDS = {
  manager: 'phase7-manager',
  research: 'phase7-researcher',
  coding: 'phase7-coder',
} as const

export function registrations(): RuntimeCommand[] {
  const desks = [
    {
      id: 'phase7-desk-a',
      departmentId: 'engineering',
      position: [-11, 0, 0.72] as const,
      headingRadians: 0,
    },
    {
      id: 'phase7-desk-b',
      departmentId: 'quality',
      position: [-11, 0, 10.72] as const,
      headingRadians: 0,
    },
    {
      id: 'phase7-desk-manager',
      departmentId: 'executive',
      position: [0, 0, -10.18] as const,
      headingRadians: 0,
    },
  ]
  return [
    ...['engineering', 'quality', 'executive'].map((id): RuntimeCommand => ({
      type: 'registerDepartment',
      department: {
        id,
        name: id,
        description: 'Explicit local tools development fixture.',
      },
    })),
    ...desks.map((workstation): RuntimeCommand => ({
      type: 'registerWorkstation',
      workstation,
    })),
    {
      type: 'registerAgent',
      agent: {
        id: IDS.manager,
        name: 'Development Manager',
        role: 'Host request owner',
        departmentId: 'executive',
        kind: 'manager',
        status: 'waiting',
        workstationId: desks[2].id,
        position: [0, 0, -10.91],
        headingRadians: 0,
      },
    },
    {
      type: 'registerAgent',
      agent: {
        id: IDS.research,
        name: 'Development Research Worker',
        role: 'Explicit fixture research',
        departmentId: 'engineering',
        kind: 'standard-worker',
        capabilities: ['research.search'],
        status: 'queued',
        managerId: IDS.manager,
        workstationId: desks[0].id,
        position: [0, 0, 0],
        headingRadians: 0,
      },
    },
    {
      type: 'registerAgent',
      agent: {
        id: IDS.coding,
        name: 'Development Coding Worker',
        role: 'Sandbox file, terminal and Git tools',
        departmentId: 'quality',
        kind: 'standard-worker',
        capabilities: [
          'filesystem.read',
          'filesystem.write',
          'terminal.run',
          'git.inspect',
          'git.add',
          'git.commit',
        ],
        status: 'sleeping',
        managerId: IDS.manager,
        workstationId: desks[1].id,
        position: [-11, 0, 9.99],
        headingRadians: 0,
      },
    },
    { type: 'selectAgent', agentId: IDS.manager },
  ]
}

export function scenarioPlan(
  request: Readonly<ManagerRequest>,
  scenario: ToolPreviewScenario,
): PlanProposal {
  const researcher = scenario === 'research' || scenario === 'denied'
  return {
    planId: `${request.requestId}:plan`,
    requestId: request.requestId,
    objective: request.title,
    constraints: [...request.constraints],
    expectedOutputs: [],
    tasks: [
      {
        id: `${request.requestId}:task`,
        title: `Development ${scenario} tool task`,
        description:
          'Execute only the explicit host-controlled development tool actions. Completion requires a separate user command.',
        priority: 'normal',
        status: 'queued',
        dependencyIds: [],
        requiredCapabilities: [
          researcher ? 'research.search' : 'filesystem.read',
        ],
        preferredAgentId: researcher ? IDS.research : IDS.coding,
      },
    ],
  }
}

/** Only newly created, ignored fixture directories are ever passed to adapters. */
export async function createSandbox(projectRoot: string, sessionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(sessionId))
    throw new Error('Invalid disposable session ID.')
  const project = await realpath(projectRoot)
  const parent = path.join(project, '.tools-preview.local')
  await mkdir(parent).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  if (
    (await lstat(parent)).isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    throw new Error(
      'The disposable sandbox parent must be a real directory inside the project.',
    )
  const sandbox = path.join(parent, sessionId)
  await mkdir(sandbox)
  if (
    (await lstat(sandbox)).isSymbolicLink() ||
    (await realpath(sandbox)) !== sandbox
  )
    throw new Error(
      'The disposable sandbox must not redirect outside the project.',
    )
  await writeFile(
    path.join(sandbox, 'readme.txt'),
    'OFFICE tools preview: disposable development fixture.\n',
    { flag: 'wx' },
  )
  const gitName = process.platform === 'win32' ? 'git.exe' : 'git'
  const candidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((folder) => path.join(folder, gitName))
  if (process.platform === 'win32')
    candidates.push('C:/Program Files/Git/cmd/git.exe')
  const git = candidates.find(
    (candidate) => path.isAbsolute(candidate) && existsSync(candidate),
  )
  if (!git)
    throw new Error(
      'Git executable is required for the disposable tools preview.',
    )
  // Bootstrap uses the same isolated process boundary as runtime tools. In
  // particular, a Git installation's templates must not introduce helpers.
  const template = await mkdtemp(
    path.join(tmpdir(), 'office-preview-git-template-'),
  )
  const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const args = [
    '--no-pager',
    '--literal-pathspecs',
    '-c',
    `core.hooksPath=${template}`,
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
    'user.name=OFFICE Development Fixture',
    '-c',
    'user.email=fixture@example.invalid',
  ]
  const run = async (command: readonly string[]) =>
    requireSuccess(
      await runProcess({
        executable: git,
        args: [...args, ...command],
        cwd: sandbox,
        signal: new AbortController().signal,
        timeoutMs: 5000,
        maxOutputBytes: 64 * 1024,
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
        },
      }),
    )
  try {
    await run(['init', '--quiet', `--template=${template}`])
    await run(['add', '--', 'readme.txt'])
    await run([
      'commit',
      '--quiet',
      '--no-verify',
      '--no-gpg-sign',
      '-m',
      'Initialize disposable development fixture',
    ])
  } finally {
    await rmdir(template)
  }
  await writeFile(
    path.join(sandbox, 'readme.txt'),
    'OFFICE tools preview: disposable development fixture.\nExplicit staged-change demonstration.\n',
  )
  return { sandbox, git }
}
