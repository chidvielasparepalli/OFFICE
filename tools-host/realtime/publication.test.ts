// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createOfficeRuntime,
  createEmptyRuntimeState,
} from '../../src/runtime/officeRuntime'
import type {
  RuntimeCommand,
  RuntimeState,
} from '../../src/runtime/runtimeTypes'
import { InMemoryArtifactStorage } from '../../src/artifacts/ArtifactStorage'
import { InMemoryArtifactRepository } from '../../src/artifacts/InMemoryArtifactRepository'
import { ArtifactService } from '../../src/artifacts/ArtifactService'
import { InMemoryMemoryRepository } from '../../src/memory/InMemoryMemoryRepository'
import { MemoryService } from '../../src/memory/MemoryService'
import type { MemoryPolicy } from '../../src/memory/memoryTypes'
import { InMemorySecretStore } from '../providers/SecretStore'
import { createRealtimeProjection } from './publication'
import {
  validateRealtimePublicData,
  validateRealtimeView,
} from '../../src/realtime/realtimeValidation'
import type { RealtimeView } from '../../src/realtime/realtimeTypes'

const synthetic = 'synthetic-host-private-fixture-only-1248'
const noLeak = (value: unknown, fragment: string) =>
  expect(JSON.stringify(value).includes(fragment)).toBe(false)

it('retains safe public HTTPS citations while rejecting host locations and credential-bearing text', () => {
  expect(() =>
    validateRealtimePublicData({
      content: 'Source: https://example.com/research',
    }),
  ).not.toThrow()
  for (const content of [
    'C:/host/private',
    'See C:\\host\\private',
    '/host/private',
    '\\\\host\\private',
    'file:///private',
    'password=synthetic-only',
  ])
    expect(() => validateRealtimePublicData({ content })).toThrow()
})
async function seed() {
  let now = '2026-10-13T00:00:00.000Z'
  const storage = new InMemoryArtifactStorage()
  const memoryPolicy: MemoryPolicy = {
    grants: [
      {
        agentId: 'a',
        scope: { kind: 'project', id: 'project' },
        permissions: ['read', 'write'],
      },
      {
        agentId: 'manager',
        scope: { kind: 'project', id: 'project' },
        permissions: ['read', 'write'],
      },
    ],
  }
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    memoryPolicy,
    now: () => now,
  })
  const send = (command: RuntimeCommand) => {
    const result = runtime.dispatch(command)
    if (!result.ok) throw new Error(result.error.code)
    return result.state
  }
  send({ type: 'connect' })
  send({
    type: 'registerDepartment',
    department: { id: 'department', name: 'Public department' },
  })
  for (const id of ['manager', 'a', 'b'])
    send({
      type: 'registerAgent',
      agent: {
        id,
        name: id,
        role: 'Fixture employee',
        departmentId: 'department',
        kind: id === 'manager' ? 'manager' : 'standard-worker',
        managerId: id === 'manager' ? null : 'manager',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
  for (const id of ['a', 'b']) {
    send({
      type: 'createTask',
      task: {
        id: `task-${id}`,
        title: `Public task ${id}`,
        description: 'Explicit test task.',
      },
    })
    send({ type: 'assignTask', taskId: `task-${id}`, agentId: id })
    send({ type: 'startTask', taskId: `task-${id}` })
  }
  const memories = new MemoryService(new InMemoryMemoryRepository(runtime, 'a'))
  memories.remember({
    id: 'private-memory',
    scope: { kind: 'agent', id: 'a' },
    type: 'semantic',
    content: 'Private worker lesson.',
    trust: 'unverified',
    source: { kind: 'agent', id: 'a' },
    importance: 'high',
    reason: 'lesson',
    rationale: 'Explicit fixture retention.',
  })
  memories.remember({
    id: 'project-memory',
    scope: { kind: 'project', id: 'project' },
    type: 'project',
    content: 'Project architecture decision.',
    trust: 'observed',
    source: { kind: 'agent', id: 'a' },
    reason: 'decision',
    rationale: 'Explicit project decision.',
  })
  memories.remember({
    id: 'working-memory',
    scope: { kind: 'agent', id: 'a' },
    type: 'working',
    content: 'Short-lived active context.',
    trust: 'unverified',
    source: { kind: 'agent', id: 'a' },
    importance: 'low',
    reason: 'fact',
    rationale: 'Current work only.',
  })
  send({
    type: 'requestToolExecution',
    executionId: 'execution',
    agentId: 'a',
    taskId: 'task-a',
    toolId: 'fixture.read',
    inputSummary: { root: 'fixture', path: 'private.txt' },
    permission: {
      allowed: true,
      code: 'ALLOWED',
      reason: 'Explicit host grant.',
      requiredPermissions: ['read'],
    },
  })
  send({ type: 'startToolExecution', executionId: 'execution' })
  send({
    type: 'completeToolExecution',
    executionId: 'execution',
    output: { text: 'Raw tool content remains host-side.' },
  })
  const artifacts = new ArtifactService(
    new InMemoryArtifactRepository(runtime, 'a'),
    storage,
  )
  const content = await storage.put(
    new TextEncoder().encode('Private immutable document.'),
    'text/plain',
  )
  const artifact = artifacts.create({
    artifactId: 'private-artifact',
    name: 'Private document',
    description: 'Agent-private output.',
    type: 'document',
    role: 'output',
    outputRole: 'document',
    taskId: 'task-a',
    scope: { kind: 'agent', id: 'a' },
    source: { kind: 'task', taskId: 'task-a' },
    content,
    status: 'completed',
  })
  const secrets = new InMemorySecretStore({ fixture: synthetic })
  const project = (principalAgentId = 'a') =>
    createRealtimeProjection({
      principalAgentId,
      memoryPolicy,
      artifactPolicy: { grants: [] },
      assertPublic: secrets.assertPublic.bind(secrets),
    })
  return {
    runtime,
    send,
    memories,
    artifacts,
    artifact,
    project,
    memoryPolicy,
    advance: (time: string) => {
      now = time
    },
  }
}

describe('recipient-safe realtime publication', () => {
  it('supports an empty disconnected office without a fake workforce', () => {
    const raw = createEmptyRuntimeState()
    const view = createRealtimeProjection({
      principalAgentId: 'viewer',
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
    })(raw)
    expect(validateRealtimeView(view)).toBe(view)
    expect(view.state.agents).toEqual({})
    expect(view.notifications).toEqual([])
    expect(view.costs.requestCount).toBe(0)
  })
  it('preserves authorized memory trust/provenance and artifact integrity without querying or changing runtime', async () => {
    const s = await seed(),
      before = s.runtime.getSnapshot(),
      project = s.project()
    const view = project(before)
    expect(view.state.memories['private-memory']).toMatchObject({
      trust: 'unverified',
      source: { kind: 'agent', id: 'a' },
      content: 'Private worker lesson.',
    })
    expect(view.state.artifacts['private-artifact'].content).toEqual(
      s.artifact.content,
    )
    expect(view.state.artifacts['private-artifact'].verifiedByQA).toBeNull()
    expect(view.state.toolExecutions.execution).toMatchObject({
      output: null,
      inputSummary: null,
      metadata: {},
      permission: { requiredPermissions: [] },
    })
    expect(s.runtime.getSnapshot()).toBe(before)
    expect(project(before)).toBe(view)
    expect(Object.isFrozen(view.state.memories['private-memory'])).toBe(true)
  })
  it.each(['b', 'manager'])(
    'does not publish worker-private records or their historical after-images to %s',
    async (principal) => {
      const s = await seed()
      s.send({ type: 'selectAgent', agentId: 'a' })
      const view = s.project(principal)(s.runtime.getSnapshot())
      expect(view.state.selectedAgentId).toBe('a')
      expect(view.state.artifacts).toEqual({})
      expect(view.state.tasks['task-a'].outputArtifactIds).toEqual([])
      noLeak(view, 'private-artifact')
      noLeak(view, 'private-memory')
      noLeak(view, 'Private worker lesson.')
      noLeak(view, 'Private immutable document.')
      if (principal === 'manager')
        expect(view.state.memories['project-memory'].trust).toBe('observed')
      else expect(view.state.memories).toEqual({})
    },
  )
  it('preserves scoped project grants without broadcasting the grant configuration', async () => {
    const s = await seed(),
      view = s.project('manager')(s.runtime.getSnapshot())
    expect(view.state.memories['project-memory'].scope).toEqual({
      kind: 'project',
      id: 'project',
    })
    noLeak(view, '"grants"')
    noLeak(view, '"allowSourceAttribution"')
    expect(view.state.memories['private-memory']).toBeUndefined()
  })
  it('uses the committed host timestamp for retention, keeping a revision deterministic', async () => {
    const s = await seed(),
      project = s.project(),
      first = project(s.runtime.getSnapshot())
    expect(first.state.memories['working-memory']).toBeDefined()
    s.advance('2026-10-13T02:00:00.000Z')
    expect(project(s.runtime.getSnapshot())).toBe(first)
    s.send({ type: 'createTask', task: { id: 'later', title: 'Later task' } })
    const later = project(s.runtime.getSnapshot())
    expect(later.state.memories['working-memory']).toBeUndefined()
    noLeak(later, 'Short-lived active context.')
  })
  it('omits superseded memory content and preserves the active successor trust', async () => {
    const s = await seed(),
      repo = new InMemoryMemoryRepository(s.runtime, 'a')
    const prior = s.runtime.getSnapshot().memories['private-memory']
    repo.supersede(prior.id, prior.revision, {
      id: 'new-memory',
      scope: prior.scope,
      type: prior.type,
      content: 'Updated private lesson.',
      trust: 'unverified',
      source: prior.source,
      reason: 'lesson',
      rationale: 'Explicit supersession.',
    })
    const view = s.project()(s.runtime.getSnapshot())
    expect(view.state.memories['new-memory']).toMatchObject({
      trust: 'unverified',
      supersedesId: null,
      source: prior.source,
    })
    noLeak(view, 'Private worker lesson.')
    expect(view.state.memories['private-memory']).toBeUndefined()
  })
  it('discards unsafe private metadata, event bodies, tool output and arbitrary host fields', async () => {
    const s = await seed(),
      original = s.runtime.getSnapshot()
    const raw = {
      ...original,
      tasks: {
        ...original.tasks,
        'task-a': {
          ...original.tasks['task-a'],
          metadata: { password: synthetic },
          hostGrant: ['execute'],
        },
      },
      toolExecutions: {
        ...original.toolExecutions,
        execution: {
          ...original.toolExecutions.execution,
          inputSummary: { root: 'C:\\private' },
          output: { credential: synthetic },
          metadata: { vault: synthetic },
        },
      },
      events: original.events.map((event) => ({
        ...event,
        payload: { password: synthetic },
        changes: {},
      })),
    } as unknown as RuntimeState
    const view = s.project()(raw)
    noLeak(view, synthetic)
    noLeak(view, 'hostGrant')
    noLeak(view, 'C:\\private')
    expect(
      view.state.events.every(
        (event) =>
          Object.keys(event.payload).length === 0 &&
          Object.keys(event.changes).length === 0,
      ),
    ).toBe(true)
    expect(original.tasks['task-a'].metadata).toEqual({})
  })
  it.each([
    synthetic,
    'sk-syntheticFixtureOnly123456',
    'C:\\host\\private.txt',
    'C:/host/private.txt',
    '/tmp/private.txt',
    '\\\\host\\share',
  ])('fails closed for unsafe retained text %#', async (description) => {
    const s = await seed(),
      state = s.runtime.getSnapshot(),
      raw = {
        ...state,
        tasks: {
          ...state.tasks,
          'task-a': { ...state.tasks['task-a'], description },
        },
      }
    let message = ''
    try {
      s.project()(raw)
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message.length > 0).toBe(true)
    noLeak(message, description)
  })
  it('retains 100 agents and bounded real event notifications without the global memory node cap', () => {
    const runtime = createOfficeRuntime({
      now: () => '2026-10-13T00:00:00.000Z',
    })
    const send = (command: RuntimeCommand) => {
      expect(runtime.dispatch(command).ok).toBe(true)
    }
    send({ type: 'connect' })
    send({
      type: 'registerDepartment',
      department: { id: 'd', name: 'Office' },
    })
    for (let n = 0; n < 100; n++)
      send({
        type: 'registerAgent',
        agent: {
          id: `worker-${n}`,
          name: `Worker ${n}`,
          role: 'Worker',
          departmentId: 'd',
          kind: 'standard-worker',
          position: [n, 0, 0],
          headingRadians: 0,
        },
      })
    const view = createRealtimeProjection({
      principalAgentId: 'worker-0',
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
    })(runtime.getSnapshot())
    expect(Object.keys(view.state.agents)).toHaveLength(100)
    expect(view.state.events).toHaveLength(100)
    expect(view.notifications).toHaveLength(100)
    expect(
      view.state.activities.every((activity) =>
        view.state.events.some((event) => event.id === activity.eventId),
      ),
    ).toBe(true)
  })
  it('never exposes a host validation exception or its credential-like diagnostic', async () => {
    const s = await seed()
    const project = createRealtimeProjection({
      principalAgentId: 'a',
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
      assertPublic: () => {
        throw new Error(synthetic)
      },
    })
    let diagnostic: unknown
    try {
      project(s.runtime.getSnapshot())
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : error
    }
    expect(diagnostic).toBe('Office publication unavailable.')
    noLeak(diagnostic, synthetic)
  })
})

describe('strict inbound normalized office validation', () => {
  const mutate = (
    view: RealtimeView,
    fn: (value: Record<string, unknown>) => void,
  ) => {
    const clone = structuredClone(view) as unknown as Record<string, unknown>
    fn(clone)
    return clone
  }
  it.each([
    (v: Record<string, unknown>) => {
      v.grants = []
    },
    (v: Record<string, unknown>) => {
      ;(v.state as Record<string, unknown>).hostStore = {}
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).agents.a as unknown as Record<string, unknown>
      ).kind = 'unknown'
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).agents.a as unknown as Record<string, unknown>
      ).position = [0, 'bad', 0]
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).tasks['task-a'] as unknown as Record<
          string,
          unknown
        >
      ).metadata = { private: 'should not arrive' }
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).toolExecutions.execution as unknown as Record<
          string,
          unknown
        >
      ).output = { text: 'hidden output' }
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).toolExecutions.execution
          .permission as unknown as Record<string, unknown>
      ).requiredPermissions = ['execute']
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).events[0] as unknown as Record<
          string,
          unknown
        >
      ).changes = { memories: { private: { content: 'private' } } }
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).tasks['task-a'] as unknown as Record<
          string,
          unknown
        >
      ).description = 'password=synthetic-only'
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).tasks['task-a'] as unknown as Record<
          string,
          unknown
        >
      ).description = 'C:/host/only'
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).memories[
          'private-memory'
        ] as unknown as Record<string, unknown>
      ).trust = 'verified'
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).tasks['task-a'] as unknown as Record<
          string,
          unknown
        >
      ).outputArtifactIds = ['missing']
    },
    (v: Record<string, unknown>) => {
      ;(v.costs as Record<string, unknown>).chargedMicros = '123'
    },
    (v: Record<string, unknown>) => {
      ;(v.notifications as Record<string, unknown>[])[0].text =
        'An invented success'
    },
    (v: Record<string, unknown>) => {
      ;(v.notifications as Record<string, unknown>[])[0].agentId = 'b'
    },
    (v: Record<string, unknown>) => {
      ;(v.notifications as Record<string, unknown>[])[0].taskId = 'task-b'
    },
    (v: Record<string, unknown>) => {
      ;(v.notifications as Record<string, unknown>[])[0].severity = 'error'
    },
    (v: Record<string, unknown>) => {
      ;(v.notifications as Record<string, unknown>[])[0].occurredAt =
        '2030-01-01T00:00:00.000Z'
    },
    (v: Record<string, unknown>) => {
      const notifications = v.notifications as Record<string, unknown>[]
      notifications.push(notifications[0])
    },
    (v: Record<string, unknown>) => {
      ;(
        (v.state as RuntimeState).activities[0] as unknown as Record<
          string,
          unknown
        >
      ).agentId = 'b'
    },
  ])(
    'rejects malformed, privileged, unsafe or fabricated public data %#',
    async (mutation) => {
      const s = await seed(),
        view = s.project()(s.runtime.getSnapshot())
      expect(() => validateRealtimeView(mutate(view, mutation))).toThrow(
        'Invalid public office data.',
      )
      expect(validateRealtimeView(view)).toBe(view)
    },
  )
})
