import { ArtifactService } from '../artifacts/ArtifactService'
import { InMemoryArtifactRepository } from '../artifacts/InMemoryArtifactRepository'
import {
  InMemoryArtifactStorage,
  hashArtifactBytes,
} from '../artifacts/ArtifactStorage'
import {
  ArtifactFault,
  type ArtifactContentReference,
} from '../artifacts/artifactTypes'
import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import { ManagerOrchestrator } from '../orchestration/ManagerOrchestrator'
import { DeterministicPlanner } from '../orchestration/planner'
import { QAEngine } from '../qa/QAEngine'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import { ToolFault, type Tool } from '../tools/toolTypes'
import { publicToolJson, toolObject } from '../tools/toolValidation'
import {
  DEVELOPMENT_AGENT_IDS,
  developmentRegistrations,
} from './runtimeFixtures'

export const ARTIFACT_PREVIEW = {
  ...DEVELOPMENT_AGENT_IDS,
  request: 'phase10-request',
  task: 'phase10-document-task',
  input: 'phase10-input-brief',
} as const
export type ArtifactPreviewMode =
  'repair' | 'simple' | 'pass' | 'multiple' | 'missing' | 'access'

/** Explicit DEV actions. Runtime state contains metadata; only storage holds bytes. */
export function createArtifactPreviewSession(
  mode: ArtifactPreviewMode = 'repair',
) {
  const ids = ARTIFACT_PREVIEW
  const storage = new InMemoryArtifactStorage()
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    artifactPolicy: {
      grants: [
        {
          agentId: ids.manager,
          scope: { kind: 'agent', id: ids.manager },
          permissions: ['import'],
        },
      ],
    },
  })
  const author = new InMemoryArtifactRepository(runtime, ids.workerA)
  const artifacts = new ArtifactService(author, storage)
  const reader = new InMemoryArtifactRepository(runtime, ids.workerB)
  let execution = 0
  let pending: {
    executionId: string
    content: ArtifactContentReference
  } | null = null
  let executor: ToolExecutor | null = null
  let engine: QAEngine | null = null
  const registry = new ToolRegistry()
  const writeTool: Tool<
    { content: string },
    {
      content: {
        storageId: string
        contentId: string
        byteLength: number
        mediaType: string
        sha256: string
      }
    }
  > = {
    id: 'development.artifact.write',
    name: 'Write immutable development document',
    description:
      'Stores bounded UTF-8 document bytes in session-only immutable content storage.',
    category: 'data',
    capabilities: ['development.document'],
    permissions: ['write'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 3000,
    metadata: { developmentOnly: true },
    inputSchema: {
      description: 'Bounded document text',
      parse(value) {
        const input = toolObject(value, ['content'])
        if (
          typeof input.content !== 'string' ||
          !input.content.trim() ||
          input.content.length > 4000
        )
          throw new ToolFault(
            'INVALID_INPUT',
            'Document must be bounded nonempty text.',
          )
        return { content: input.content }
      },
    },
    outputSchema: {
      description: 'Immutable content receipt',
      parse(value) {
        const output = toolObject(publicToolJson(value), ['content'])
        const reference = toolObject(output.content, [
          'storageId',
          'contentId',
          'byteLength',
          'mediaType',
          'sha256',
        ])
        if (
          typeof reference.storageId !== 'string' ||
          typeof reference.contentId !== 'string' ||
          typeof reference.byteLength !== 'number' ||
          typeof reference.mediaType !== 'string' ||
          typeof reference.sha256 !== 'string'
        )
          throw new ToolFault('INVALID_OUTPUT', 'Content receipt is invalid.')
        return {
          content: {
            storageId: reference.storageId,
            contentId: reference.contentId,
            byteLength: reference.byteLength,
            mediaType: reference.mediaType,
            sha256: reference.sha256,
          },
        }
      },
    },
    summarizeInput: (input) => ({ characters: input.content.length }),
    async execute(input, context) {
      context.signal.throwIfAborted()
      return {
        content: {
          ...(await storage.put(
            new Uint8Array(new TextEncoder().encode(input.content)),
            'text/markdown',
          )),
        },
      }
    },
  }
  const readTool: Tool<
    { artifact: { artifactId: string; version: number; sha256: string } },
    {
      artifact: { artifactId: string; version: number; sha256: string }
      content: string
    }
  > = {
    id: 'development.artifact.inspect',
    name: 'Inspect immutable artifact bytes',
    description:
      'Reads the exact authorized artifact version and calculates its actual byte hash.',
    category: 'validation',
    capabilities: ['development.verify'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 3000,
    metadata: { developmentOnly: true },
    inputSchema: {
      description: 'QA-reserved immutable artifact binding',
      parse(value) {
        const input = toolObject(value, ['artifact'])
        const binding = toolObject(input.artifact, [
          'artifactId',
          'version',
          'sha256',
        ])
        if (
          typeof binding.artifactId !== 'string' ||
          !Number.isInteger(binding.version) ||
          typeof binding.version !== 'number' ||
          typeof binding.sha256 !== 'string'
        )
          throw new ToolFault('INVALID_INPUT', 'Artifact binding is invalid.')
        return {
          artifact: {
            artifactId: binding.artifactId,
            version: binding.version,
            sha256: binding.sha256,
          },
        }
      },
    },
    outputSchema: {
      description: 'Actual inspected bytes and identity',
      parse(value) {
        const output = toolObject(publicToolJson(value), [
          'artifact',
          'content',
        ])
        const input = readTool.inputSchema.parse({ artifact: output.artifact })
        if (typeof output.content !== 'string' || output.content.length > 4000)
          throw new ToolFault('INVALID_OUTPUT', 'Inspection text is invalid.')
        return { ...input, content: output.content }
      },
    },
    summarizeInput: (input) => ({
      artifactId: input.artifact.artifactId,
      version: input.artifact.version,
    }),
    async execute(input, context) {
      context.signal.throwIfAborted()
      const repo = new InMemoryArtifactRepository(runtime, context.agentId)
      const item = repo.get(input.artifact.artifactId)
      if (!item) throw new ToolFault('NOT_FOUND', 'Artifact is unavailable.')
      const bytes = await new ArtifactService(repo, storage).read(
        item.artifactId,
      )
      return {
        artifact: {
          artifactId: item.artifactId,
          version: item.version,
          sha256: await hashArtifactBytes(bytes),
        },
        content: new TextDecoder().decode(bytes),
      }
    },
  }
  registry.register(writeTool)
  registry.register(readTool)
  const executionService = () =>
    (executor ??= new ToolExecutor({
      runtime,
      registry,
      grants: {
        [ids.workerA]: { toolIds: [writeTool.id], permissions: ['write'] },
        [ids.workerB]: { toolIds: [readTool.id], permissions: ['read'] },
      },
    }))
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: ids.manager,
    planner: new DeterministicPlanner((request) => ({
      requestId: request.requestId,
      planId: 'phase10-plan',
      objective: request.title,
      constraints: [...request.constraints],
      expectedOutputs: [],
      tasks: [
        {
          id: ids.task,
          title: 'Produce explicit local artifact outputs',
          description:
            'Write a bounded document through the registered tool, then register its immutable output explicitly.',
          priority: 'normal',
          status: 'queued',
          dependencyIds: [],
          requiredCapabilities: ['development.document'],
          preferredAgentId: ids.workerA,
          expectedOutputs:
            mode === 'simple' || mode === 'access'
              ? []
              : [
                  {
                    role: 'deliverable',
                    type: 'document',
                    count: mode === 'multiple' ? 2 : 1,
                  },
                ],
        },
      ],
    })),
  })
  function accepted(result: RuntimeResult) {
    if (!result.ok)
      throw new ArtifactFault(result.error.code, result.error.message)
    return result.state
  }
  const issue = (command: RuntimeCommand) => accepted(runtime.dispatch(command))
  function connect() {
    issue({ type: 'connect' })
    if (Object.keys(runtime.getSnapshot().agents).length) return
    for (const command of developmentRegistrations()) {
      if (command.type === 'selectAgent') continue
      issue(
        command.type === 'registerAgent'
          ? {
              ...command,
              agent: {
                ...command.agent,
                capabilities:
                  command.agent.id === ids.workerA
                    ? ['development.document']
                    : command.agent.id === ids.workerB
                      ? ['development.verify', 'qa']
                      : [],
              },
            }
          : command,
      )
    }
    manager.start()
  }
  async function begin() {
    accepted(
      manager.receiveRequest({
        requestId: ids.request,
        title: 'Explicit local artifact workflow',
        description:
          'Demonstrate immutable bytes, provenance, output expectations and actual QA.',
        requestedBy: 'development-operator',
        priority: 'normal',
        constraints: [
          'No external work, fabricated evidence or automatic execution.',
        ],
      }),
    )
    accepted(await manager.planRequest(ids.request))
    issue({ type: 'selectTask', taskId: ids.task })
  }
  function start() {
    const result = manager.dispatchReady(ids.request)
    if (!result.ok)
      throw new ArtifactFault(
        'DISPATCH_FAILED',
        'Artifact development task could not be assigned.',
      )
  }
  async function write(passing: boolean) {
    const taskId = runtime.getSnapshot().agents[ids.workerA]?.currentTaskId
    if (!taskId)
      throw new ArtifactFault(
        'TASK_REQUIRED',
        'Start the worker task before writing.',
      )
    const executionId = `phase10-write-${++execution}`
    const result = await executionService().execute({
      executionId,
      taskId,
      agentId: ids.workerA,
      toolId: writeTool.id,
      input: {
        content: passing
          ? '# Development artifact\n\n## Acceptance\nExplicit immutable output for local validation.'
          : '# Development artifact draft\n\nThe required section is absent.',
      },
    })
    if (result.status !== 'completed')
      throw new ArtifactFault('WRITE_FAILED', 'Document tool did not complete.')
    const output = writeTool.outputSchema.parse(result.output)
    pending = { executionId, content: output.content }
    return { executionId, content: output.content }
  }
  const outputs = () =>
    runtime.getSnapshot().tasks[ids.task]
      ? author
          .listByTask(ids.task)
          .filter((item) => item.role === 'output')
          .reverse()
      : []
  const latest = () =>
    outputs()
      .filter((item) => !item.supersededByArtifactId)
      .at(-1)
  const latestQA = () =>
    Object.values(runtime.getSnapshot().qaRequests)
      .filter((item) => item.taskId === ids.task)
      .at(-1)
  const repair = () =>
    Object.values(runtime.getSnapshot().repairRequests)
      .filter((item) => item.sourceTaskId === ids.task)
      .at(-1)
  function createOutput() {
    if (!pending)
      throw new ArtifactFault(
        'WRITE_REQUIRED',
        'Execute a document write first.',
      )
    const previous = latest()
    const replacing = !!previous && mode !== 'multiple'
    const source = { kind: 'tool' as const, executionId: pending.executionId }
    const content = pending.content
    const result = replacing
      ? artifacts.createVersion(previous.artifactId, previous.revision, {
          artifactId: `phase10-document-v${previous.version + 1}`,
          source,
          content,
          status: 'completed',
        })
      : artifacts.create({
          artifactId: `phase10-document-${mode === 'multiple' ? outputs().length + 1 : 'v1'}`,
          name: 'Development document',
          description: 'Explicit local output; no production business content.',
          type: 'document',
          role: 'output',
          outputRole: 'deliverable',
          taskId: ids.task,
          scope:
            mode === 'access'
              ? { kind: 'agent', id: ids.workerA }
              : { kind: 'task', id: ids.task },
          source,
          content,
          status: 'completed',
          metadata: { developmentOnly: true },
        })
    pending = null
    return result
  }
  function requestQA() {
    const item = latest()
    if (!item)
      throw new ArtifactFault('ARTIFACT_REQUIRED', 'Create the artifact first.')
    return accepted(
      manager.requestQA({
        qaId: `phase10-qa-${item.artifactId}`,
        taskId: ids.task,
        artifactId: item.artifactId,
        scope: 'Selected immutable artifact contains an Acceptance section',
        checks: [
          {
            checkId: 'acceptance-section',
            title: 'Acceptance section exists',
            type: 'requirement-compliance',
            required: true,
            severity: 'error',
            toolId: readTool.id,
            input: {},
            assertion: {
              kind: 'includes',
              path: ['content'],
              value: '## Acceptance',
            },
          },
        ],
        repairCapabilities: ['development.document'],
        maxRepairAttempts: 2,
      }),
    )
  }
  function finish() {
    const taskId = runtime.getSnapshot().agents[ids.workerA]?.currentTaskId
    if (!taskId)
      throw new ArtifactFault('TASK_REQUIRED', 'No active worker task.')
    return issue({ type: 'completeTask', taskId })
  }
  async function runQA() {
    const qa = Object.values(runtime.getSnapshot().qaRequests).find(
      (item) => item.taskId === ids.task && item.status === 'queued',
    )
    if (!qa)
      throw new ArtifactFault(
        'QA_REQUIRED',
        'Request a queued inspection first.',
      )
    engine ??= new QAEngine({ runtime, executor: executionService() })
    return engine.run(qa.qaId, ids.workerB)
  }
  function assignRepair() {
    const item = repair()
    if (!item)
      throw new ArtifactFault(
        'REPAIR_REQUIRED',
        'Run a failing inspection first.',
      )
    accepted(manager.assignRepair(item.repairId))
    return accepted(manager.startRepair(item.repairId))
  }
  function recheck() {
    const qa = latestQA(),
      item = latest()
    if (!qa || !item)
      throw new ArtifactFault(
        'QA_REQUIRED',
        'Repair and create a new artifact version first.',
      )
    return accepted(manager.recheckQA(qa.qaId, undefined, item.artifactId))
  }
  async function importInput() {
    const content = await storage.put(
      new Uint8Array(
        new TextEncoder().encode(
          'Explicit user-provided development brief: include an Acceptance section.',
        ),
      ),
      'text/plain',
    )
    const managerRepository = new InMemoryArtifactRepository(
      runtime,
      ids.manager,
    )
    const item = new ArtifactService(managerRepository, storage).create({
      artifactId: ids.input,
      name: 'Development input brief',
      description: 'Explicitly imported user input, not worker output.',
      type: 'document',
      role: 'input',
      scope: { kind: 'agent', id: ids.manager },
      source: { kind: 'user', reference: 'development-operator-brief' },
      content,
      status: 'completed',
    })
    managerRepository.linkInput(ids.task, item.artifactId)
    return item
  }
  function deniedRead() {
    const item = latest()
    if (!item)
      throw new ArtifactFault(
        'ARTIFACT_REQUIRED',
        'Create a private artifact first.',
      )
    return reader.get(item.artifactId)
  }
  return {
    runtime,
    manager,
    author,
    artifacts,
    storage,
    issue,
    connect,
    begin,
    start,
    write,
    createOutput,
    requestQA,
    finish,
    runQA,
    assignRepair,
    recheck,
    importInput,
    deniedRead,
    outputs,
    latest,
    latestQA,
    repair,
    hasPending: () => !!pending,
    dispose() {
      manager.dispose()
      executor?.dispose()
    },
  }
}
