import type { OfficeRuntime } from '../runtime/officeRuntime'
import type { RuntimeState } from '../runtime/runtimeTypes'
import { memoryId } from './memoryPolicy'
import { serializeMemoryContext } from './memoryRetrieval'
import {
  MemoryFault,
  type MemoryContext,
  type MemoryLimits,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryRepository,
  type MemoryRuntimeCommand,
  type MemoryScope,
  type MemorySearchResult,
  type MemoryTaskContextRequest,
  type MemoryUpdate,
  type MemoryWriteInput,
} from './memoryTypes'

/** A principal-bound view of the runtime repository, not a second memory store.
 * Only the trusted host creates this adapter; workers receive its narrowed interface. */
export class InMemoryMemoryRepository implements MemoryRepository {
  readonly #runtime: OfficeRuntime
  readonly #agentId: string
  constructor(runtime: OfficeRuntime, agentId: string) {
    this.#runtime = runtime
    this.#agentId = memoryId(agentId)
  }
  get agentId() {
    return this.#agentId
  }
  private issue(command: MemoryRuntimeCommand): RuntimeState {
    const result = this.#runtime.dispatch(command)
    if (!result.ok)
      throw new MemoryFault(result.error.code, result.error.message)
    return result.state
  }
  private changed(state: RuntimeState): MemoryRecord {
    const id = state.events.at(-1)!.payload.memoryId as string
    return state.memories[id]
  }
  private retrieved(state: RuntimeState): MemorySearchResult {
    const payload = state.events.at(-1)!.payload
    return Object.freeze({
      memories: Object.freeze(
        (payload.memoryIds as readonly string[]).map(
          (id) => state.memories[id],
        ),
      ),
      characters: payload.characters as number,
      approximateTokens: payload.approximateTokens as number,
    })
  }
  add(memory: MemoryWriteInput) {
    return this.changed(
      this.issue({ type: 'createMemory', agentId: this.agentId, memory }),
    )
  }
  get(memoryId: string) {
    return (
      this.retrieved(
        this.issue({ type: 'getMemory', agentId: this.agentId, memoryId }),
      ).memories[0] ?? null
    )
  }
  update(memoryId: string, expectedRevision: number, patch: MemoryUpdate) {
    return this.changed(
      this.issue({
        type: 'updateMemory',
        agentId: this.agentId,
        memoryId,
        expectedRevision,
        patch,
      }),
    )
  }
  archive(memoryId: string, expectedRevision: number) {
    return this.changed(
      this.issue({
        type: 'archiveMemory',
        agentId: this.agentId,
        memoryId,
        expectedRevision,
      }),
    )
  }
  supersede(
    memoryId: string,
    expectedRevision: number,
    replacement: MemoryWriteInput,
  ) {
    return this.changed(
      this.issue({
        type: 'supersedeMemory',
        agentId: this.agentId,
        memoryId,
        expectedRevision,
        replacement,
      }),
    )
  }
  search(query: MemoryQuery) {
    return this.retrieved(
      this.issue({ type: 'retrieveMemories', agentId: this.agentId, query }),
    )
  }
  listByScope(scope: MemoryScope, limits: MemoryLimits = {}) {
    return this.search({ ...limits, scopes: [scope] })
  }
  listByAgent(agentId: string, limits: MemoryLimits = {}) {
    return this.listByScope({ kind: 'agent', id: agentId }, limits)
  }
  listByProject(projectId: string, limits: MemoryLimits = {}) {
    return this.search({
      ...limits,
      scopes: [{ kind: 'project', id: projectId }],
      projectId,
    })
  }
  buildContext(request: MemoryTaskContextRequest): MemoryContext {
    const state = this.issue({
      type: 'buildMemoryContext',
      agentId: this.agentId,
      request,
    })
    const result = this.retrieved(state)
    const payload = state.events.at(-1)!.payload
    const taskId = payload.taskId as string
    const projectId = payload.projectId as string | null
    return Object.freeze({
      ...result,
      agentId: this.agentId,
      taskId,
      projectId,
      serialized: serializeMemoryContext(
        this.agentId,
        taskId,
        projectId,
        result.memories,
      ),
    })
  }
}
