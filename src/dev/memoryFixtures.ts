import { createOfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeCommand } from '../runtime/runtimeTypes'
import { InMemoryMemoryRepository } from '../memory/InMemoryMemoryRepository'
import { MemoryService } from '../memory/MemoryService'
import {
  MemoryFault,
  type MemoryPolicy,
  type MemoryWriteInput,
} from '../memory/memoryTypes'
import { ToolExecutor } from '../tools/ToolExecutor'
import { ToolRegistry } from '../tools/ToolRegistry'
import { createResearchTool } from '../tools/researchTool'
import { DeterministicResearchProvider } from './deterministicResearchProvider'
import {
  DEVELOPMENT_AGENT_IDS as ids,
  developmentRegistrations,
  developmentTask,
} from './runtimeFixtures'

export const MEMORY_PREVIEW = {
  ...ids,
  project: 'phase8-office',
  earlierTask: 'phase8-earlier-task',
  laterTask: 'phase8-later-task',
  managerTask: 'phase8-manager-review',
  preference: 'phase8-preference',
  lesson: 'phase8-lesson',
  privateLesson: 'phase8-private-lesson',
  decision: 'phase8-decision',
  revisedDecision: 'phase8-revised-decision',
  execution: 'phase8-research-fixture',
  finding: 'phase8-tool-finding',
} as const
const project = { kind: 'project', id: MEMORY_PREVIEW.project } as const
export const memoryPreviewPolicy: MemoryPolicy = {
  grants: [
    ...Object.values(ids).map((agentId) => ({
      agentId,
      scope: project,
      permissions: ['read', 'write'] as const,
    })),
    {
      agentId: ids.manager,
      scope: project,
      permissions: ['write', 'verify'],
      allowSourceAttribution: true,
    },
  ],
}

/** Fixed, explicitly operated fixtures; no production state or automatic memory writes. */
export function createMemoryPreviewSession() {
  const runtime = createOfficeRuntime({ memoryPolicy: memoryPreviewPolicy })
  const repositories = Object.fromEntries(
    Object.values(ids).map((id) => [
      id,
      new InMemoryMemoryRepository(runtime, id),
    ]),
  )
  const services = Object.fromEntries(
    Object.entries(repositories).map(([id, repository]) => [
      id,
      new MemoryService(repository),
    ]),
  )
  function issue(command: RuntimeCommand) {
    const result = runtime.dispatch(command)
    if (!result.ok)
      throw new MemoryFault(result.error.code, result.error.message)
    return result.state
  }
  function connect() {
    issue({ type: 'connect' })
    if (Object.keys(runtime.getSnapshot().agents).length) return
    for (const command of developmentRegistrations())
      issue(
        command.type === 'registerAgent'
          ? {
              ...command,
              agent: {
                ...command.agent,
                capabilities:
                  command.agent.kind === 'standard-worker'
                    ? ['research.search']
                    : [],
              },
            }
          : command,
      )
  }
  function begin(taskId: string, agentId = ids.workerA as string) {
    issue({
      type: 'createTask',
      task: {
        ...developmentTask(taskId, 'Explicit memory development task'),
        metadata: {
          projectId: MEMORY_PREVIEW.project,
          developmentFixture: 'phase8-memory',
        },
      },
    })
    issue({ type: 'assignTask', taskId, agentId })
    issue({ type: 'startTask', taskId })
    issue({ type: 'selectAgent', agentId })
  }
  function write(actorId: string, overrides: Partial<MemoryWriteInput>) {
    return services[actorId].remember({
      scope: project,
      type: 'project',
      content: 'Explicit development memory.',
      importance: 'normal',
      trust: 'observed',
      source: {
        kind: actorId === ids.manager ? 'manager' : 'agent',
        id: actorId,
      },
      reason: 'decision',
      rationale:
        'Explicit reusable development example, not production knowledge.',
      ...overrides,
    })
  }
  async function research() {
    const taskId = runtime.getSnapshot().agents[ids.workerA]?.currentTaskId
    if (!taskId)
      throw new MemoryFault(
        'TASK_REQUIRED',
        'Start an explicit worker task first.',
      )
    const registry = new ToolRegistry()
    registry.register(createResearchTool(new DeterministicResearchProvider()))
    const executor = new ToolExecutor({
      runtime,
      registry,
      grants: {
        [ids.workerA]: { toolIds: ['research.search'], permissions: ['read'] },
      },
    })
    try {
      return await executor.execute({
        executionId: MEMORY_PREVIEW.execution,
        agentId: ids.workerA,
        taskId,
        toolId: 'research.search',
        input: { query: 'Explicit memory evidence fixture; no real search.' },
      })
    } finally {
      executor.dispose()
    }
  }
  return {
    runtime,
    repositories,
    services,
    issue,
    connect,
    begin,
    write,
    research,
  }
}
export type MemoryPreviewSession = ReturnType<typeof createMemoryPreviewSession>
