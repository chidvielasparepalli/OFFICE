import {
  MemoryFault,
  type MemoryPolicy,
  type MemoryRecord,
  type MemoryRuntimeCommand,
  type MemorySearchResult,
} from '../memory/memoryTypes'
import {
  createMemoryRecord,
  isActiveMemory,
  memoryId,
  memoryObject,
  requireRecordAccess,
  updateMemoryRecord,
} from '../memory/memoryPolicy'
import { buildMemoryContext, retrieveMemories } from '../memory/memoryRetrieval'
import type { OrchestrationTransaction } from './orchestrationRuntime'
import type { RuntimeCommand, RuntimeJson } from './runtimeTypes'

type MemoryTransaction = OrchestrationTransaction
const commandFields: Record<MemoryRuntimeCommand['type'], readonly string[]> = {
  createMemory: ['type', 'agentId', 'memory'],
  updateMemory: ['type', 'agentId', 'memoryId', 'expectedRevision', 'patch'],
  archiveMemory: ['type', 'agentId', 'memoryId', 'expectedRevision'],
  supersedeMemory: [
    'type',
    'agentId',
    'memoryId',
    'expectedRevision',
    'replacement',
  ],
  retrieveMemories: ['type', 'agentId', 'query'],
  getMemory: ['type', 'agentId', 'memoryId'],
  buildMemoryContext: ['type', 'agentId', 'request'],
}

function ensure(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new MemoryFault(code, message)
}

function store(tx: MemoryTransaction, ...records: readonly MemoryRecord[]) {
  tx.state = {
    ...tx.state,
    memories: {
      ...tx.state.memories,
      ...Object.fromEntries(records.map((record) => [record.id, record])),
    },
  }
}

function find(tx: MemoryTransaction, id: string) {
  memoryId(id)
  return Object.hasOwn(tx.state.memories, id) ? tx.state.memories[id] : null
}

function writable(
  tx: MemoryTransaction,
  policy: MemoryPolicy,
  actorId: string,
  id: string,
  revision: number,
) {
  const record = find(tx, id)
  ensure(record, 'MEMORY_NOT_FOUND', 'The memory record does not exist.')
  // Check access before status/revision so unauthorized callers learn no details.
  requireRecordAccess(tx.state, policy, actorId, record, 'write')
  ensure(
    Number.isSafeInteger(revision) && revision >= 1,
    'INVALID_REVISION',
    'Expected revision must be a positive integer.',
  )
  ensure(
    record.revision === revision,
    'STALE_MEMORY',
    'Memory changed since this revision was read.',
  )
  ensure(
    record.status === 'active',
    'INACTIVE_MEMORY',
    'Archived or superseded memory cannot be edited.',
  )
  return record
}

function freshId(tx: MemoryTransaction, inputId: string | undefined) {
  const id = memoryId(inputId ?? tx.id('memory'))
  ensure(
    !Object.hasOwn(tx.state.memories, id),
    'DUPLICATE_ID',
    'Memory ID already exists.',
  )
  return id
}

function sameScope(a: MemoryRecord, b: MemoryRecord) {
  return (
    a.scope.kind === b.scope.kind &&
    a.scope.id === b.scope.id &&
    a.projectId === b.projectId
  )
}

/** Replacement links are runtime-owned. Also fail closed on invalid restored
 * lineage instead of extending a cycle or a chain crossing access scopes. */
function validateLineage(tx: MemoryTransaction, record: MemoryRecord) {
  const visited = new Set<string>()
  let current = record
  ensure(
    current.supersededById === null,
    'INVALID_LINEAGE',
    'Active memory has an invalid replacement link.',
  )
  while (true) {
    ensure(
      !visited.has(current.id),
      'INVALID_LINEAGE',
      'Memory lineage must not contain a cycle.',
    )
    visited.add(current.id)
    if (current.supersedesId === null) return
    const prior = find(tx, current.supersedesId)
    ensure(
      prior &&
        prior.status === 'superseded' &&
        prior.supersededById === current.id &&
        sameScope(prior, record),
      'INVALID_LINEAGE',
      'Memory lineage must retain reciprocal links within one scope and project.',
    )
    current = prior
  }
}

function emitRetrieval(
  tx: MemoryTransaction,
  actorId: string,
  result: MemorySearchResult,
  taskId: string | null = null,
  extra: Readonly<Record<string, RuntimeJson>> = {},
) {
  tx.emit(
    'MEMORY_RETRIEVED',
    'Retrieved authorized memory context.',
    actorId,
    taskId,
    {
      ...extra,
      memoryIds: result.memories.map((memory) => memory.id),
      characters: result.characters,
      approximateTokens: result.approximateTokens,
    },
  )
}

export function isMemoryRuntimeCommand(
  command: RuntimeCommand,
): command is MemoryRuntimeCommand {
  return Object.hasOwn(commandFields, command.type)
}

/** Memory is part of the existing transaction; policy is trusted host state,
 * never a command field. Queries audit identifiers, not content or query text. */
export function applyMemoryRuntimeCommand(
  tx: MemoryTransaction,
  policy: MemoryPolicy,
  command: MemoryRuntimeCommand,
) {
  memoryObject(command, commandFields[command.type])
  memoryId(command.agentId)
  tx.agent(command.agentId)
  switch (command.type) {
    case 'createMemory': {
      const input = memoryObject(command.memory, [
        'id',
        'scope',
        'projectId',
        'type',
        'content',
        'metadata',
        'importance',
        'trust',
        'source',
        'reason',
        'rationale',
        'verificationEvidence',
      ])
      const id = freshId(tx, input.id as string | undefined)
      const record = createMemoryRecord(
        tx.state,
        policy,
        command.agentId,
        command.memory,
        id,
        tx.time,
      )
      store(tx, record)
      tx.emit(
        'MEMORY_CREATED',
        'Created an authorized memory record.',
        command.agentId,
        null,
        { memoryId: record.id },
      )
      return
    }
    case 'updateMemory': {
      const prior = writable(
        tx,
        policy,
        command.agentId,
        command.memoryId,
        command.expectedRevision,
      )
      const record = updateMemoryRecord(
        tx.state,
        policy,
        command.agentId,
        prior,
        command.patch,
        tx.time,
      )
      store(tx, record)
      tx.emit(
        'MEMORY_UPDATED',
        'Updated an authorized memory record.',
        command.agentId,
        null,
        { memoryId: record.id },
      )
      return
    }
    case 'archiveMemory': {
      const prior = writable(
        tx,
        policy,
        command.agentId,
        command.memoryId,
        command.expectedRevision,
      )
      const record: MemoryRecord = {
        ...prior,
        status: 'archived',
        archivedAt: tx.time,
        updatedAt: tx.time,
        revision: prior.revision + 1,
      }
      store(tx, record)
      tx.emit(
        'MEMORY_ARCHIVED',
        'Archived a memory record; its history is retained.',
        command.agentId,
        null,
        { memoryId: record.id },
      )
      return
    }
    case 'supersedeMemory': {
      const prior = writable(
        tx,
        policy,
        command.agentId,
        command.memoryId,
        command.expectedRevision,
      )
      validateLineage(tx, prior)
      const input = memoryObject(command.replacement, [
        'id',
        'scope',
        'projectId',
        'type',
        'content',
        'metadata',
        'importance',
        'trust',
        'source',
        'reason',
        'rationale',
        'verificationEvidence',
      ])
      const id = freshId(tx, input.id as string | undefined)
      const replacement = createMemoryRecord(
        tx.state,
        policy,
        command.agentId,
        command.replacement,
        id,
        tx.time,
        prior.id,
      )
      ensure(
        sameScope(prior, replacement),
        'SCOPE_MISMATCH',
        'A replacement must retain the same scope and project.',
      )
      ensure(
        prior.source.kind !== 'tool' ||
          prior.trust === 'verified' ||
          ['unverified', 'verified'].includes(replacement.trust),
        'INVALID_TRUST',
        'Superseding unverified tool evidence requires explicit verification before promotion.',
      )
      store(
        tx,
        {
          ...prior,
          status: 'superseded',
          supersededById: replacement.id,
          updatedAt: tx.time,
          revision: prior.revision + 1,
        },
        replacement,
      )
      tx.emit(
        'MEMORY_SUPERSEDED',
        'Superseded a memory record atomically.',
        command.agentId,
        null,
        { memoryId: replacement.id, supersedesId: prior.id },
      )
      return
    }
    case 'getMemory': {
      const record = find(tx, command.memoryId)
      if (record)
        requireRecordAccess(tx.state, policy, command.agentId, record, 'read')
      const memories = record && isActiveMemory(record, tx.time) ? [record] : []
      const characters = JSON.stringify(memories).length
      emitRetrieval(tx, command.agentId, {
        memories,
        characters,
        approximateTokens: Math.ceil(characters / 4),
      })
      return
    }
    case 'retrieveMemories': {
      const result = retrieveMemories(
        tx.state,
        policy,
        command.agentId,
        command.query,
        tx.time,
      )
      emitRetrieval(tx, command.agentId, result, command.query.taskId ?? null)
      return
    }
    case 'buildMemoryContext': {
      const context = buildMemoryContext(
        tx.state,
        policy,
        command.agentId,
        command.request,
        tx.time,
      )
      emitRetrieval(tx, command.agentId, context, context.taskId, {
        taskId: context.taskId,
        projectId: context.projectId,
      })
      return
    }
  }
}
