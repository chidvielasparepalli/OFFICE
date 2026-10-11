import type { OfficeRuntime } from '../runtime/officeRuntime'
import { memoryId, memoryObject, memorySafeJson } from '../memory/memoryPolicy'
import { artifactAssert } from './artifactPolicy'
import {
  ArtifactFault,
  type Artifact,
  type ArtifactCreateInput,
  type ArtifactQuery,
  type ArtifactRepository,
  type ArtifactRuntimeCommand,
  type ArtifactVersionInput,
} from './artifactTypes'

/** Principal-bound view of OfficeRuntime; metadata is never copied to a second store. */
export class InMemoryArtifactRepository implements ArtifactRepository {
  readonly #runtime: OfficeRuntime
  readonly #agentId: string
  constructor(runtime: OfficeRuntime, agentId: string) {
    this.#runtime = runtime
    this.#agentId = memoryId(agentId)
  }
  get agentId() {
    return this.#agentId
  }
  private issue(command: ArtifactRuntimeCommand) {
    const result = this.#runtime.dispatch(command)
    if (!result.ok)
      throw new ArtifactFault(result.error.code, result.error.message)
    return result.state
  }
  private created(command: ArtifactRuntimeCommand): Artifact {
    const before = this.#runtime.getSnapshot().artifacts
    const state = this.issue(command)
    const created = Object.values(state.artifacts).find(
      (a) => !Object.hasOwn(before, a.artifactId),
    )
    artifactAssert(
      created,
      'ARTIFACT_NOT_CREATED',
      'No artifact version was created.',
    )
    return created
  }
  create(artifact: ArtifactCreateInput) {
    return this.created({
      type: 'createArtifact',
      agentId: this.agentId,
      artifact,
    })
  }
  get(id: string): Artifact | null {
    memoryId(id)
    const artifact = this.#runtime.getSnapshot().artifacts[id]
    if (!artifact) return null
    artifactAssert(
      this.canRead(id),
      'ARTIFACT_ACCESS_DENIED',
      'Artifact access is not authorized.',
    )
    memorySafeJson(artifact, 32768)
    return artifact
  }
  update(
    artifactId: string,
    expectedRevision: number,
    status: 'in_progress' | 'completed' | 'failed',
  ) {
    this.get(artifactId)
    return this.issue({
      type: 'updateArtifact',
      agentId: this.agentId,
      artifactId,
      expectedRevision,
      status,
    }).artifacts[artifactId]
  }
  createVersion(
    artifactId: string,
    expectedRevision: number,
    replacement: ArtifactVersionInput,
  ) {
    return this.created({
      type: 'versionArtifact',
      agentId: this.agentId,
      artifactId,
      expectedRevision,
      replacement,
    })
  }
  supersede(
    artifactId: string,
    expectedRevision: number,
    replacement: ArtifactVersionInput,
  ) {
    return this.createVersion(artifactId, expectedRevision, replacement)
  }
  archive(artifactId: string, expectedRevision: number) {
    this.get(artifactId)
    return this.issue({
      type: 'archiveArtifact',
      agentId: this.agentId,
      artifactId,
      expectedRevision,
    }).artifacts[artifactId]
  }
  list(query: ArtifactQuery = {}): readonly Artifact[] {
    memoryObject(query, [
      'taskId',
      'agentId',
      'projectId',
      'lineageId',
      'limit',
    ])
    const limit = query.limit ?? 20
    artifactAssert(
      Number.isInteger(limit) && limit >= 1 && limit <= 50,
      'INVALID_ARTIFACT_QUERY',
      'Artifact lists are limited to one through fifty records.',
    )
    for (const value of [
      query.taskId,
      query.agentId,
      query.projectId,
      query.lineageId,
    ])
      if (value !== undefined) memoryId(value)
    const state = this.#runtime.getSnapshot()
    const task = query.taskId ? state.tasks[query.taskId] : undefined
    const ids = new Set([
      ...(task?.inputArtifactIds ?? []),
      ...(task?.outputArtifactIds ?? []),
    ])
    const result = Object.values(state.artifacts)
      .filter(
        (a) =>
          this.canRead(a.artifactId) &&
          (!query.taskId ||
            a.taskId === query.taskId ||
            ids.has(a.artifactId)) &&
          (!query.agentId || a.agentId === query.agentId) &&
          (!query.projectId || a.projectId === query.projectId) &&
          (!query.lineageId || a.lineageId === query.lineageId),
      )
      .reverse()
      .slice(0, limit)
    result.forEach((artifact) => memorySafeJson(artifact, 32768))
    return Object.freeze(result)
  }
  listByTask(taskId: string) {
    return this.list({ taskId })
  }
  listByAgent(agentId: string) {
    return this.list({ agentId })
  }
  listByProject(projectId: string) {
    return this.list({ projectId })
  }
  linkInput(taskId: string, artifactId: string) {
    this.issue({
      type: 'linkInputArtifact',
      agentId: this.agentId,
      taskId,
      artifactId,
    })
  }
  canRead(id: string) {
    return this.#runtime.canAccessArtifact(this.agentId, id, 'read')
  }
  canModify(id: string) {
    return (
      this.canRead(id) &&
      this.#runtime.canAccessArtifact(this.agentId, id, 'modify')
    )
  }
  canArchive(id: string) {
    return (
      this.canRead(id) &&
      this.#runtime.canAccessArtifact(this.agentId, id, 'archive')
    )
  }
}
