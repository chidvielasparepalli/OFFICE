import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand, RuntimeResult } from '../runtime/runtimeTypes'
import { ManagerOrchestrator } from '../orchestration/ManagerOrchestrator'
import { DeterministicPlanner } from '../orchestration/planner'
import { QAEngine } from '../qa/QAEngine'
import { QAFault, type QACheck } from '../qa/qaTypes'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import { ToolFault, type Tool } from '../tools/toolTypes'
import { toolObject, publicToolJson } from '../tools/toolValidation'
import { InMemoryMemoryRepository } from '../memory/InMemoryMemoryRepository'
import { MemoryService } from '../memory/MemoryService'
import {
  DEVELOPMENT_AGENT_IDS,
  developmentRegistrations,
  developmentTask,
} from './runtimeFixtures'

export const QA_PREVIEW = {
  ...DEVELOPMENT_AGENT_IDS,
  request: 'phase9-request',
  task: 'phase9-document-task',
  qa: 'phase9-initial-qa',
  artifact: 'phase9-local-document',
  lesson: 'phase9-repair-lesson',
  laterTask: 'phase9-later-task',
} as const

export type QAPreviewMode = 'repair' | 'pass' | 'exhaustion' | 'blocked'

/** Explicit development artifact. Every read/write below goes through ToolExecutor. */
export function createQAPreviewSession(mode: QAPreviewMode = 'repair') {
  const ids = QA_PREVIEW
  const runtime = createOfficeRuntime()
  let document: string | null = null
  let execution = 0
  let lastWriteId: string | null = null
  const registry = new ToolRegistry()
  const writeTool: Tool<
    { content: string },
    { artifactId: string; characters: number }
  > = {
    id: 'development.document.write',
    name: 'Write development document',
    description: 'Writes only the labelled in-memory development document.',
    category: 'data',
    capabilities: ['development.document'],
    permissions: ['write'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 2000,
    metadata: { developmentOnly: true },
    inputSchema: {
      description: 'Bounded document content',
      parse(value) {
        const input = toolObject(value, ['content'])
        if (
          typeof input.content !== 'string' ||
          !input.content.trim() ||
          input.content.length > 4000
        )
          throw new ToolFault(
            'INVALID_INPUT',
            'Document content must be bounded nonempty text.',
          )
        return { content: input.content }
      },
    },
    outputSchema: {
      description: 'Local artifact receipt',
      parse(value) {
        const output = toolObject(value, ['artifactId', 'characters'])
        if (
          output.artifactId !== ids.artifact ||
          typeof output.characters !== 'number'
        )
          throw new ToolFault(
            'INVALID_OUTPUT',
            'Invalid local document receipt.',
          )
        return { artifactId: ids.artifact, characters: output.characters }
      },
    },
    summarizeInput: (input) => ({ characters: input.content.length }),
    async execute(input, context) {
      context.signal.throwIfAborted()
      document = input.content
      return { artifactId: ids.artifact, characters: document.length }
    },
  }
  const readTool: Tool<
    null,
    { artifactId: string; content: string | null; characters: number }
  > = {
    id: 'development.document.inspect',
    name: 'Inspect development document',
    description:
      'Reads the actual current in-memory document for explicit QA checks.',
    category: 'validation',
    capabilities: ['development.verify'],
    permissions: ['read'],
    allowedKinds: ['standard-worker'],
    timeoutMs: 2000,
    metadata: { developmentOnly: true },
    inputSchema: {
      description: 'No input',
      parse(value) {
        if (value !== null)
          throw new ToolFault(
            'INVALID_INPUT',
            'This inspection accepts no input.',
          )
        return null
      },
    },
    outputSchema: {
      description: 'Current local artifact contents',
      parse(value) {
        const output = toolObject(publicToolJson(value), [
          'artifactId',
          'content',
          'characters',
        ])
        if (
          output.artifactId !== ids.artifact ||
          !(output.content === null || typeof output.content === 'string') ||
          typeof output.characters !== 'number'
        )
          throw new ToolFault(
            'INVALID_OUTPUT',
            'Invalid local document inspection.',
          )
        return {
          artifactId: ids.artifact,
          content: output.content,
          characters: output.characters,
        }
      },
    },
    summarizeInput: () => null,
    async execute(_input, context) {
      context.signal.throwIfAborted()
      return {
        artifactId: ids.artifact,
        content: document,
        characters: document?.length ?? 0,
      }
    },
  }
  registry.register(writeTool)
  registry.register(readTool)
  let executor: ToolExecutor | null = null
  let engine: QAEngine | null = null
  function executionService() {
    executor ??= new ToolExecutor({
      runtime,
      registry,
      grants: {
        [ids.workerA]: { toolIds: [writeTool.id], permissions: ['write'] },
        [ids.workerB]: {
          toolIds: mode === 'blocked' ? [] : [readTool.id],
          permissions: ['read'],
        },
      },
    })
    return executor
  }
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: ids.manager,
    planner: new DeterministicPlanner((request) => ({
      requestId: request.requestId,
      planId: 'phase9-plan',
      objective: request.title,
      constraints: [...request.constraints],
      expectedOutputs: [],
      tasks: [
        {
          id: ids.task,
          title: 'Write the local QA development document',
          description:
            'Use the registered document tool. Acceptance requires an Acceptance section. No external work occurs.',
          priority: 'normal',
          status: 'queued',
          dependencyIds: [],
          requiredCapabilities: ['development.document'],
          preferredAgentId: ids.workerA,
        },
      ],
    })),
  })
  const repository = new InMemoryMemoryRepository(runtime, ids.workerA)
  const memory = new MemoryService(repository)
  function accepted(result: RuntimeResult) {
    if (!result.ok) throw new QAFault(result.error.code, result.error.message)
    return result.state
  }
  function issue(command: RuntimeCommand) {
    return accepted(runtime.dispatch(command))
  }
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
        title: 'Explicit local QA document scenario',
        description:
          'Demonstrate completion, inspection, bounded repair and historical evidence.',
        requestedBy: 'development-operator',
        priority: 'normal',
        constraints: ['No external work or automatic execution.'],
      }),
    )
    accepted(await manager.planRequest(ids.request))
    const checks: QACheck[] = [
      {
        checkId: 'acceptance-section',
        title: 'Acceptance section exists',
        type: 'requirement-compliance',
        required: true,
        severity: 'error',
        toolId: readTool.id,
        input: null,
        assertion: {
          kind: 'includes',
          path: ['content'],
          value: '## Acceptance',
        },
      },
    ]
    accepted(
      manager.requestQA({
        qaId: ids.qa,
        taskId: ids.task,
        scope: 'Explicit local document acceptance section',
        checks,
        repairCapabilities: ['development.document'],
        maxRepairAttempts: mode === 'exhaustion' ? 1 : 2,
      }),
    )
    const dispatched = manager.dispatchReady(ids.request)
    if (!dispatched.ok)
      throw new QAFault(
        'DISPATCH_FAILED',
        'Development document assignment failed.',
      )
    issue({ type: 'selectTask', taskId: ids.task })
  }
  const latest = () =>
    Object.values(runtime.getSnapshot().qaRequests)
      .filter((qa) => qa.taskId === ids.task)
      .at(-1)
  const repair = () =>
    Object.values(runtime.getSnapshot().repairRequests)
      .filter((item) => item.sourceTaskId === ids.task)
      .at(-1)
  async function write(passing: boolean) {
    const taskId = runtime.getSnapshot().agents[ids.workerA]?.currentTaskId
    if (!taskId)
      throw new QAFault('TASK_REQUIRED', 'Start a worker task before writing.')
    const executionId = `phase9-write-${++execution}`
    const result = await executionService().execute({
      executionId,
      agentId: ids.workerA,
      taskId,
      toolId: writeTool.id,
      input: {
        content: passing
          ? '# Development document\n\n## Acceptance\nExplicit local validation only.'
          : '# Development draft\n\nThe required section has not been written.',
      },
    })
    if (result.status !== 'completed')
      throw new QAFault(
        'WRITE_FAILED',
        'Local document write did not complete.',
      )
    lastWriteId = executionId
    return result
  }
  function finish() {
    const taskId = runtime.getSnapshot().agents[ids.workerA]?.currentTaskId
    if (!taskId) throw new QAFault('TASK_REQUIRED', 'No active worker task.')
    return issue({ type: 'completeTask', taskId })
  }
  function assignRepair() {
    const item = repair()
    if (!item)
      throw new QAFault('REPAIR_REQUIRED', 'Run a failing QA attempt first.')
    accepted(manager.assignRepair(item.repairId))
    accepted(manager.startRepair(item.repairId))
    issue({ type: 'selectAgent', agentId: ids.workerA })
  }
  function recheck() {
    const qa = latest()
    if (!qa) throw new QAFault('QA_REQUIRED', 'Run initial QA first.')
    return accepted(manager.recheckQA(qa.qaId))
  }
  function lesson() {
    if (
      latest()?.status !== 'passed' ||
      repair()?.status !== 'completed' ||
      !lastWriteId
    )
      throw new QAFault(
        'SUCCESSFUL_REPAIR_REQUIRED',
        'A successful explicit repair and recheck is required.',
      )
    return memory.remember({
      id: ids.lesson,
      scope: { kind: 'agent', id: ids.workerA },
      type: 'episodic',
      content:
        'Development repair lesson: write the required Acceptance section before requesting inspection.',
      metadata: { qaId: latest()!.qaId, repairId: repair()!.repairId },
      importance: 'normal',
      trust: 'unverified',
      source: { kind: 'tool', id: lastWriteId },
      reason: 'lesson',
      rationale:
        'Explicitly selected development lesson; passing QA does not verify memory.',
    })
  }
  function context() {
    if (!runtime.getSnapshot().tasks[ids.laterTask]) {
      issue({
        type: 'createTask',
        task: developmentTask(
          ids.laterTask,
          'Later local task with explicit memory context',
        ),
      })
      issue({ type: 'assignTask', taskId: ids.laterTask, agentId: ids.workerA })
    }
    return memory.forTask({
      taskId: ids.laterTask,
      query: 'Acceptance',
      limit: 4,
      maxCharacters: 4000,
    })
  }
  function runQA() {
    const qa = latest()
    if (!qa)
      throw new QAFault('QA_REQUIRED', 'Create an explicit QA request first.')
    engine ??= new QAEngine({ runtime, executor: executionService() })
    return engine.run(qa.qaId, ids.workerB)
  }
  return {
    runtime,
    manager,
    issue,
    connect,
    begin,
    latest,
    repair,
    write,
    finish,
    assignRepair,
    recheck,
    runQA,
    lesson,
    context,
    dispose() {
      manager.dispose()
      executor?.dispose()
    },
  }
}
