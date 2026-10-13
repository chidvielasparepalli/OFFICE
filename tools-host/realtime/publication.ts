import {
  canAccessArtifact,
  copyArtifactPolicy,
} from '../../src/artifacts/artifactPolicy'
import type { ArtifactPolicy } from '../../src/artifacts/artifactTypes'
import {
  copyMemoryPolicy,
  isActiveMemory,
  memoryId,
  requireRecordAccess,
} from '../../src/memory/memoryPolicy'
import type { MemoryPolicy } from '../../src/memory/memoryTypes'
import { providerCostSummary } from '../../src/providers/costPolicy'
import type { QACheck } from '../../src/qa/qaTypes'
import {
  REALTIME_MAPS,
  type RealtimeMap,
  type RealtimeView,
} from '../../src/realtime/realtimeTypes'
import {
  REALTIME_RECORD_FIELDS,
  realtimeEventLabel,
  realtimeEventSeverity,
  validateRealtimePublicData,
  validateRealtimeView,
} from '../../src/realtime/realtimeValidation'
import type { RuntimeJson, RuntimeState } from '../../src/runtime/runtimeTypes'

export interface RealtimeProjectionOptions {
  /** Set only by the authenticated CEO host. Ordinary office recipients see no personnel file. */
  readonly recruitmentCeo?: boolean
  readonly principalAgentId: string
  readonly memoryPolicy: MemoryPolicy
  readonly artifactPolicy: ArtifactPolicy
  /** Host-configured known-secret rejection, never sent to the recipient. */
  readonly assertPublic?: (value: unknown, maxBytes?: number) => RuntimeJson
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function pick(key: RealtimeMap, value: object): Record<string, unknown> {
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    REALTIME_RECORD_FIELDS[key]
      .filter((field) => Object.hasOwn(record, field))
      .map((field) => [field, record[field]]),
  )
}
function publicAssertion(
  assertion: QACheck['assertion'],
): QACheck['assertion'] {
  if (assertion.kind === 'equals')
    return { kind: 'equals', path: [], value: null }
  if (assertion.kind === 'includes')
    return { kind: 'includes', path: [], value: 'Comparison withheld.' }
  if (assertion.kind === 'maximum')
    return { kind: 'maximum', path: [], value: assertion.value }
  return { kind: assertion.kind, path: [] }
}

/** Recipient-bound read projection only. It never dispatches, writes or changes runtime trust. */
export function createRealtimeProjection(
  options: RealtimeProjectionOptions,
): (state: RuntimeState) => RealtimeView {
  const principal = memoryId(options.principalAgentId)
  const memoryPolicy = copyMemoryPolicy(options.memoryPolicy)
  const artifactPolicy = copyArtifactPolicy(options.artifactPolicy)
  let previous: RuntimeState | undefined, cached: RealtimeView | undefined
  const project = (state: RuntimeState) => {
    if (state === previous && cached) return cached
    // Retention changes become visible with an authoritative runtime commit, never a conflicting same-revision projection.
    const timestamp =
      state.events.at(-1)?.occurredAt ?? '1970-01-01T00:00:00.000Z'
    // Employment history stays canonical/private; an ended employment is no
    // longer an office occupant, even for recipients without personnel access.
    const activeAgentIds = new Set(
      Object.keys(state.agents).filter(
        (id) => state.employees[id]?.status !== 'terminated',
      ),
    )
    const memoryIds = new Set<string>()
    if (state.connection === 'local')
      for (const memory of Object.values(state.memories)) {
        try {
          requireRecordAccess(state, memoryPolicy, principal, memory, 'read')
          if (!isActiveMemory(memory, timestamp)) continue
          memoryIds.add(memory.id)
        } catch {
          /* No existence or content is published for denied records. */
        }
      }
    const artifactIds = new Set(
      Object.values(state.artifacts)
        .filter((item) =>
          canAccessArtifact(state, artifactPolicy, principal, item, 'read'),
        )
        .map((item) => item.artifactId),
    )
    const qaIds = new Set(
      Object.values(state.qaRequests)
        .filter(
          (item) =>
            item.artifactId === null || artifactIds.has(item.artifactId),
        )
        .map((item) => item.qaId),
    )
    const repairIds = new Set(
      Object.values(state.repairRequests)
        .filter((item) => qaIds.has(item.sourceQaId))
        .map((item) => item.repairId),
    )
    const privateTasks = new Set([
      ...Object.values(state.qaRequests)
        .filter((item) => !qaIds.has(item.qaId))
        .map((item) => item.inspectionTaskId),
      ...Object.values(state.repairRequests)
        .filter((item) => !repairIds.has(item.repairId))
        .map((item) => item.taskId),
    ])
    const restrictedExecutions = new Set([
      ...Object.values(state.artifacts)
        .filter((item) => !artifactIds.has(item.artifactId))
        .map((item) => item.source.executionId),
      ...Object.values(state.qaRequests)
        .filter((item) => !qaIds.has(item.qaId))
        .flatMap((item) => Object.values(item.executionIds)),
    ])
    const toolIds = new Set(
      Object.values(state.toolExecutions)
        .filter(
          (item) =>
            !restrictedExecutions.has(item.executionId) &&
            !privateTasks.has(item.taskId),
        )
        .map((item) => item.executionId),
    )
    const map = <K extends RealtimeMap>(
      key: K,
      transform: (item: RuntimeState[K][string]) => Record<string, unknown>,
      allowed?: Set<string>,
    ): RuntimeState[K] =>
      Object.fromEntries(
        Object.entries(state[key])
          .filter(([id]) => !allowed || allowed.has(id))
          .map(([id, item]) => [
            id,
            {
              ...pick(key, item),
              ...transform(item as RuntimeState[K][string]),
            },
          ]),
      ) as RuntimeState[K]
    const visible = (ids: Set<string>, id: string | null) =>
      id !== null && ids.has(id) ? id : null
    const publicEvents = state.events
      .filter((event) => {
        if (event.taskId && privateTasks.has(event.taskId)) return false
        for (const [key, ids] of [
          ['memories', memoryIds],
          ['artifacts', artifactIds],
          ['qaRequests', qaIds],
          ['repairRequests', repairIds],
          ['toolExecutions', toolIds],
        ] as const)
          if (Object.keys(event.changes[key] ?? {}).some((id) => !ids.has(id)))
            return false
        for (const [key, ids] of [
          ['memoryId', memoryIds],
          ['supersedesId', memoryIds],
          ['artifactId', artifactIds],
          ['qaId', qaIds],
          ['repairId', repairIds],
          ['executionId', toolIds],
        ] as const)
          if (
            typeof event.payload[key] === 'string' &&
            !ids.has(event.payload[key] as string)
          )
            return false
        if (
          Array.isArray(event.payload.memoryIds) &&
          event.payload.memoryIds.some(
            (id) => typeof id !== 'string' || !memoryIds.has(id),
          )
        )
          return false
        return true
      })
      .slice(-100)
      .map((event) => ({
        id: event.id,
        type: event.type,
        occurredAt: event.occurredAt,
        agentId: event.agentId,
        taskId: event.taskId,
        payload: {},
        changes: {},
        transactionRevision: event.transactionRevision,
        transactionEventIndex: event.transactionEventIndex,
        transactionEventCount: event.transactionEventCount,
      }))
    const eventMap = new Map(publicEvents.map((event) => [event.id, event]))
    let publicState: RuntimeState = {
      connection: state.connection,
      revision: state.revision,
      selectedAgentId: visible(activeAgentIds, state.selectedAgentId),
      selectedTaskId: state.selectedTaskId,
      agents: map(
        'agents',
        (agent) => ({
          blockers: agent.blockers.length
            ? ['Runtime intervention required.']
            : [],
          destination: agent.destination
            ? {
                id: agent.destination.id,
                destinationType: agent.destination.destinationType,
                destinationId: agent.destination.destinationId,
                movementReason: 'Runtime movement requested.',
                arrivalStatus: agent.destination.arrivalStatus,
                collaboratorIds: [...agent.destination.collaboratorIds],
              }
            : null,
        }),
        activeAgentIds,
      ),
      tasks: map('tasks', (task) => ({
        metadata: {},
        statusReason:
          task.statusReason === null ? null : 'Runtime attention is recorded.',
        ...(privateTasks.has(task.id)
          ? {
              title: 'Restricted inspection task',
              description:
                'Inspection details are not available to this recipient.',
            }
          : {}),
        inputArtifactIds: (task.inputArtifactIds ?? []).filter((id) =>
          artifactIds.has(id),
        ),
        outputArtifactIds: (task.outputArtifactIds ?? []).filter((id) =>
          artifactIds.has(id),
        ),
      })),
      workstations: map('workstations', () => ({})),
      departments: map('departments', () => ({})),
      requests: map('requests', (item) => ({
        issues: item.issues.map((issue) => ({
          code: 'RUNTIME_ATTENTION',
          message: 'Runtime intervention required.',
          taskId: issue.taskId,
          agentId: issue.agentId,
        })),
      })),
      plans: map('plans', (item) => ({
        issues: item.issues.map((issue) => ({
          code: 'RUNTIME_ATTENTION',
          message: 'Runtime intervention required.',
          taskId: issue.taskId,
          agentId: issue.agentId,
        })),
      })),
      toolExecutions: map(
        'toolExecutions',
        (item) => ({
          inputSummary: null,
          output: null,
          metadata: {},
          permission: {
            allowed: item.permission.allowed,
            code: item.permission.allowed ? 'ALLOWED' : 'DENIED',
            reason: 'Host authorization evaluated.',
            requiredPermissions: [],
          },
          error:
            item.error === null
              ? null
              : {
                  code: 'TOOL_FAILED',
                  message: 'Execution did not complete successfully.',
                },
        }),
        toolIds,
      ),
      memories: map(
        'memories',
        (item) => ({
          metadata: {},
          supersedesId: visible(memoryIds, item.supersedesId),
          supersededById: visible(memoryIds, item.supersededById),
        }),
        memoryIds,
      ),
      artifacts: map(
        'artifacts',
        (item) => ({
          metadata: {},
          source: {
            kind: item.source.kind,
            taskId: item.source.taskId,
            agentId: item.source.agentId,
            executionId: item.source.executionId,
            toolId: item.source.toolId,
            requestId: item.source.requestId,
            userReference: null,
            recordedByAgentId: item.source.recordedByAgentId,
          },
          derivedFromArtifactIds: item.derivedFromArtifactIds.filter((id) =>
            artifactIds.has(id),
          ),
          supersedesArtifactId: visible(artifactIds, item.supersedesArtifactId),
          supersededByArtifactId: visible(
            artifactIds,
            item.supersededByArtifactId,
          ),
          verifiedByQA: visible(qaIds, item.verifiedByQA),
        }),
        artifactIds,
      ),
      qaRequests: map(
        'qaRequests',
        (item) => ({
          checks: item.checks.map((check) => ({
            checkId: check.checkId,
            title: check.title,
            type: check.type,
            required: check.required,
            severity: check.severity,
            toolId: check.toolId,
            input: null,
            assertion: publicAssertion(check.assertion),
          })),
          previousQaId: visible(qaIds, item.previousQaId),
          repairId: visible(repairIds, item.repairId),
        }),
        qaIds,
      ),
      repairRequests: map('repairRequests', () => ({}), repairIds),
      recruitments: options.recruitmentCeo
        ? map('recruitments', () => ({}))
        : {},
      employees: options.recruitmentCeo ? map('employees', () => ({})) : {},
      providerRequests: map(
        'providerRequests',
        () => ({ reconciliationEvidence: null }),
        toolIds,
      ),
      creditLedger: state.creditLedger
        .filter((item) => toolIds.has(item.requestId))
        .slice(-1000)
        .map((item) => ({
          ledgerId: item.ledgerId,
          requestId: item.requestId,
          agentId: item.agentId,
          taskId: item.taskId,
          providerId: item.providerId,
          modelId: item.modelId,
          kind: item.kind,
          unit: item.unit,
          capability: item.capability,
          estimateMicros: item.estimateMicros,
          actualMicros: item.actualMicros,
          status: item.status,
          reservedMicros: item.reservedMicros,
          chargedMicros: item.chargedMicros,
          occurredAt: item.occurredAt,
          reconciliationId: item.reconciliationId,
        })),
      events: publicEvents,
      activities: state.activities
        .filter((item) => eventMap.has(item.eventId))
        .slice(-100)
        .map((item) => ({
          id: item.id,
          eventId: item.eventId,
          occurredAt: item.occurredAt,
          agentId: item.agentId,
          taskId: item.taskId,
          summary: realtimeEventLabel(eventMap.get(item.eventId)!.type),
        })),
    }
    // Hidden QA details are not replaced with a false verification result.
    publicState = {
      ...publicState,
      tasks: Object.fromEntries(
        Object.entries(publicState.tasks).map(([id, task]) => {
          if (!task.verification || qaIds.has(task.verification.qaId))
            return [id, task]
          const { verification: _withheld, ...rest } = task
          return [id, rest]
        }),
      ),
    }
    const view: RealtimeView = {
      state: publicState,
      notifications: publicEvents.map((event) => ({
        id: event.id,
        eventId: event.id,
        severity: realtimeEventSeverity(event.type),
        text: realtimeEventLabel(event.type),
        agentId: event.agentId,
        taskId: event.taskId,
        occurredAt: event.occurredAt,
      })),
      handoffs: Object.values(publicState.tasks).flatMap((task) =>
        (task.inputArtifactIds ?? []).map((artifactId) => ({
          id: `${task.id}::${artifactId}`,
          artifactId,
          fromTaskId: publicState.artifacts[artifactId].taskId,
          toTaskId: task.id,
          toAgentId: task.assignedAgentId,
        })),
      ),
      costs: providerCostSummary(publicState.providerRequests),
    }
    // A record-sized boundary retains the original credential detector's limits without a 100-agent global node cap.
    for (const key of REALTIME_MAPS)
      for (const record of Object.values(publicState[key])) {
        validateRealtimePublicData(record)
        options.assertPublic?.(record, 65536)
      }
    for (const entries of [
      publicState.events,
      publicState.activities,
      publicState.creditLedger,
      view.notifications,
      view.handoffs,
    ])
      for (const entry of entries) {
        validateRealtimePublicData(entry)
        options.assertPublic?.(entry, 65536)
      }
    options.assertPublic?.(view.costs)
    const accepted = validateRealtimeView(view)
    cached = freeze(structuredClone(accepted))
    previous = state
    return cached
  }
  return (state) => {
    try {
      return project(state)
    } catch {
      // Host validators may throw private diagnostics. Only a fixed rejection crosses this boundary.
      throw new Error('Office publication unavailable.')
    }
  }
}
