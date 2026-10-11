import type { RuntimeJson, RuntimeState } from '../runtime/runtimeTypes'

export const artifactTypes = [
  'code',
  'file',
  'document',
  'report',
  'image',
  'video',
  'dataset',
  'archive',
  'build',
  'repository-change',
  'configuration',
  'other',
] as const
export type ArtifactType = (typeof artifactTypes)[number]
export type ArtifactStatus =
  | 'created'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'verified'
  | 'superseded'
  | 'archived'
export interface ArtifactExpectation {
  readonly role: string
  readonly type: ArtifactType
  readonly count: number
}
export interface ArtifactScope {
  readonly kind: 'agent' | 'task' | 'project'
  readonly id: string
}
export interface ArtifactGrant {
  readonly agentId: string
  readonly scope: ArtifactScope
  readonly permissions: readonly ('read' | 'modify' | 'archive' | 'import')[]
}
export interface ArtifactPolicy {
  readonly grants: readonly ArtifactGrant[]
}
/** Opaque immutable content identity, never a filesystem path or download URL. */
export interface ArtifactContentReference {
  readonly storageId: string
  readonly contentId: string
  readonly byteLength: number
  readonly mediaType: string
  readonly sha256: string
}
export interface ArtifactStorage {
  put(bytes: Uint8Array, mediaType: string): Promise<ArtifactContentReference>
  inspect(reference: ArtifactContentReference): ArtifactContentReference | null
  read(reference: ArtifactContentReference): Promise<Uint8Array>
}
export type ArtifactSourceInput =
  | { readonly kind: 'tool'; readonly executionId: string }
  | { readonly kind: 'task'; readonly taskId: string }
  | {
      readonly kind: 'manager'
      readonly taskId: string
      readonly requestId: string
    }
  | { readonly kind: 'user'; readonly reference: string }
export interface ArtifactSource {
  readonly kind: ArtifactSourceInput['kind']
  readonly taskId: string | null
  readonly agentId: string | null
  readonly executionId: string | null
  readonly toolId: string | null
  readonly requestId: string | null
  readonly userReference: string | null
  readonly recordedByAgentId: string
}
export interface Artifact {
  /** Every immutable version has its own ID; lineageId groups its history. */
  readonly artifactId: string
  readonly lineageId: string
  readonly name: string
  readonly description: string
  readonly type: ArtifactType
  readonly role: 'input' | 'output'
  readonly outputRole: string | null
  /** Owning output task; source.taskId records the actual producing/repair task. */
  readonly taskId: string | null
  readonly agentId: string | null
  readonly projectId: string | null
  readonly scope: ArtifactScope
  readonly status: ArtifactStatus
  readonly version: number
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly source: ArtifactSource
  readonly content: ArtifactContentReference
  readonly metadata: Readonly<Record<string, RuntimeJson>>
  readonly derivedFromArtifactIds: readonly string[]
  readonly supersedesArtifactId: string | null
  readonly supersededByArtifactId: string | null
  readonly verifiedByQA: string | null
}
export interface ArtifactCreateInput {
  readonly artifactId?: string
  readonly name: string
  readonly description: string
  readonly type: ArtifactType
  readonly role: 'input' | 'output'
  readonly outputRole?: string
  readonly taskId?: string
  readonly projectId?: string
  readonly scope: ArtifactScope
  readonly status?: 'created' | 'in_progress' | 'completed' | 'failed'
  readonly source: ArtifactSourceInput
  readonly content: ArtifactContentReference
  readonly metadata?: Readonly<Record<string, RuntimeJson>>
  readonly derivedFromArtifactIds?: readonly string[]
}
export interface ArtifactVersionInput {
  readonly artifactId?: string
  readonly name?: string
  readonly description?: string
  readonly source: ArtifactSourceInput
  readonly content: ArtifactContentReference
  readonly metadata?: Readonly<Record<string, RuntimeJson>>
  readonly status?: 'created' | 'in_progress' | 'completed' | 'failed'
}
export interface ArtifactQuery {
  readonly taskId?: string
  readonly agentId?: string
  readonly projectId?: string
  readonly lineageId?: string
  readonly limit?: number
}
export interface ArtifactRepository {
  readonly agentId: string
  create(input: ArtifactCreateInput): Artifact
  get(id: string): Artifact | null
  update(
    id: string,
    expectedRevision: number,
    status: 'in_progress' | 'completed' | 'failed',
  ): Artifact
  createVersion(
    id: string,
    expectedRevision: number,
    input: ArtifactVersionInput,
  ): Artifact
  supersede(
    id: string,
    expectedRevision: number,
    input: ArtifactVersionInput,
  ): Artifact
  archive(id: string, expectedRevision: number): Artifact
  list(query?: ArtifactQuery): readonly Artifact[]
  listByTask(taskId: string): readonly Artifact[]
  listByAgent(agentId: string): readonly Artifact[]
  listByProject(projectId: string): readonly Artifact[]
  linkInput(taskId: string, artifactId: string): void
  canRead(id: string): boolean
  canModify(id: string): boolean
  canArchive(id: string): boolean
}
export type ArtifactRuntimeCommand =
  | {
      readonly type: 'createArtifact'
      readonly agentId: string
      readonly artifact: ArtifactCreateInput
    }
  | {
      readonly type: 'versionArtifact'
      readonly agentId: string
      readonly artifactId: string
      readonly expectedRevision: number
      readonly replacement: ArtifactVersionInput
    }
  | {
      readonly type: 'updateArtifact'
      readonly agentId: string
      readonly artifactId: string
      readonly expectedRevision: number
      readonly status: 'in_progress' | 'completed' | 'failed'
    }
  | {
      readonly type: 'archiveArtifact'
      readonly agentId: string
      readonly artifactId: string
      readonly expectedRevision: number
    }
  | {
      readonly type: 'linkInputArtifact'
      readonly agentId: string
      readonly taskId: string
      readonly artifactId: string
    }
export interface ArtifactReadPort {
  getSnapshot(): RuntimeState
  canAccessArtifact(
    agentId: string,
    artifactId: string,
    permission: 'read' | 'modify' | 'archive',
  ): boolean
}
export class ArtifactFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
