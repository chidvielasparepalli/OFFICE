import type { RuntimeJson } from '../runtime/runtimeTypes'

export type MemoryType =
  'working' | 'episodic' | 'semantic' | 'project' | 'preference'
export type MemoryImportance = 'low' | 'normal' | 'high' | 'critical'
export type MemoryTrust = 'verified' | 'observed' | 'inferred' | 'unverified'
export type MemoryScopeKind = 'agent' | 'task' | 'project' | 'organization'
export interface MemoryScope {
  readonly kind: MemoryScopeKind
  readonly id: string
}
export interface MemorySource {
  readonly kind: 'user' | 'task' | 'agent' | 'tool' | 'manager' | 'system'
  readonly id: string
}
export type MemoryWriteReason =
  | 'decision'
  | 'constraint'
  | 'approach'
  | 'lesson'
  | 'preference'
  | 'fact'
  | 'outcome'
export interface MemoryGrant {
  readonly agentId: string
  readonly scope: MemoryScope
  readonly permissions: readonly ('read' | 'write' | 'verify')[]
  /** Trusted host permission to attribute user/system input; never agent-supplied. */
  readonly allowSourceAttribution?: boolean
}
export interface MemoryPolicy {
  readonly grants: readonly MemoryGrant[]
}
export interface MemoryRecord {
  readonly id: string
  readonly agentId: string
  readonly scope: MemoryScope
  readonly projectId: string | null
  readonly type: MemoryType
  readonly content: string
  readonly metadata: Readonly<Record<string, RuntimeJson>>
  readonly importance: MemoryImportance
  readonly trust: MemoryTrust
  readonly source: MemorySource
  readonly reason: MemoryWriteReason
  readonly rationale: string
  readonly verification: {
    readonly agentId: string
    readonly evidence: string
    readonly at: string
  } | null
  readonly retention: {
    readonly kind: 'working' | 'history' | 'persistent'
    readonly expiresAt: string | null
  }
  readonly status: 'active' | 'archived' | 'superseded'
  readonly supersedesId: string | null
  readonly supersededById: string | null
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly revision: number
}
export interface MemoryWriteInput {
  readonly id?: string
  readonly scope: MemoryScope
  readonly projectId?: string | null
  readonly type: MemoryType
  readonly content: string
  readonly metadata?: Readonly<Record<string, RuntimeJson>>
  readonly importance?: MemoryImportance
  readonly trust: MemoryTrust
  readonly source: MemorySource
  readonly reason: MemoryWriteReason
  readonly rationale: string
  readonly verificationEvidence?: string
}
export interface MemoryUpdate {
  readonly importance?: MemoryImportance
  readonly metadata?: Readonly<Record<string, RuntimeJson>>
  readonly trust?: MemoryTrust
  readonly verificationEvidence?: string
}
export interface MemoryLimits {
  readonly limit?: number
  readonly maxCharacters?: number
  /** Approximation only: four characters per token, not a provider tokenizer. */
  readonly maxApproxTokens?: number
  readonly minimumImportance?: MemoryImportance
}
export interface MemoryQuery extends MemoryLimits {
  readonly scopes: readonly MemoryScope[]
  readonly query?: string
  readonly taskId?: string
  readonly projectId?: string
}
export interface MemorySearchResult {
  readonly memories: readonly MemoryRecord[]
  readonly characters: number
  readonly approximateTokens: number
}
export interface MemoryTaskContextRequest extends MemoryLimits {
  readonly taskId: string
  readonly query?: string
  /** Organization/private shared scopes require explicit host grants. */
  readonly additionalScopes?: readonly MemoryScope[]
}
export interface MemoryContext extends MemorySearchResult {
  readonly agentId: string
  readonly taskId: string
  readonly projectId: string | null
  readonly serialized: string
}
export class MemoryFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
export type MemoryRuntimeCommand =
  | {
      readonly type: 'createMemory'
      readonly agentId: string
      readonly memory: MemoryWriteInput
    }
  | {
      readonly type: 'updateMemory'
      readonly agentId: string
      readonly memoryId: string
      readonly expectedRevision: number
      readonly patch: MemoryUpdate
    }
  | {
      readonly type: 'archiveMemory'
      readonly agentId: string
      readonly memoryId: string
      readonly expectedRevision: number
    }
  | {
      readonly type: 'supersedeMemory'
      readonly agentId: string
      readonly memoryId: string
      readonly expectedRevision: number
      readonly replacement: MemoryWriteInput
    }
  | {
      readonly type: 'retrieveMemories'
      readonly agentId: string
      readonly query: MemoryQuery
    }
  | {
      readonly type: 'getMemory'
      readonly agentId: string
      readonly memoryId: string
    }
  | {
      readonly type: 'buildMemoryContext'
      readonly agentId: string
      readonly request: MemoryTaskContextRequest
    }

/** A principal-bound repository: implementations enforce access on every method. */
export interface MemoryRepository {
  readonly agentId: string
  add(input: MemoryWriteInput): MemoryRecord
  get(id: string): MemoryRecord | null
  update(
    id: string,
    expectedRevision: number,
    patch: MemoryUpdate,
  ): MemoryRecord
  archive(id: string, expectedRevision: number): MemoryRecord
  supersede(
    id: string,
    expectedRevision: number,
    replacement: MemoryWriteInput,
  ): MemoryRecord
  search(query: MemoryQuery): MemorySearchResult
  listByScope(scope: MemoryScope, limits?: MemoryLimits): MemorySearchResult
  listByAgent(agentId: string, limits?: MemoryLimits): MemorySearchResult
  listByProject(projectId: string, limits?: MemoryLimits): MemorySearchResult
  buildContext(request: MemoryTaskContextRequest): MemoryContext
}
