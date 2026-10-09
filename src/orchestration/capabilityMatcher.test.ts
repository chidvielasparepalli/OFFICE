import { describe, expect, it } from 'vitest'
import type {
  RuntimeAgent,
  RuntimeState,
  RuntimeTask,
} from '../runtime/runtimeTypes'
import { eligibleAgents, meetsCapabilities } from './capabilityMatcher'

function agent(id: string, patch: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    id,
    name: id,
    role: 'Supplied role',
    departmentId: 'engineering',
    kind: 'standard-worker',
    capabilities: ['research', 'code'],
    status: 'sleeping',
    workstationId: null,
    managerId: 'manager',
    currentTaskId: null,
    destination: null,
    collaboratorIds: [],
    blockers: [],
    position: [0, 0, 0],
    headingRadians: 0,
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
    ...patch,
  }
}

const requirements = { capabilities: ['code'], preferredAgentId: null }
function state(...agents: RuntimeAgent[]): RuntimeState {
  return {
    connection: 'local',
    revision: 0,
    agents: Object.fromEntries(agents.map((item) => [item.id, item])),
    tasks: {},
    workstations: {},
    departments: {},
    requests: {},
    plans: {},
    toolExecutions: {},
    events: [],
    activities: [],
    selectedAgentId: null,
    selectedTaskId: null,
  }
}

describe('capability and availability matching', () => {
  it('matches exact capabilities and ownership without treating the Manager as a worker', () => {
    expect(meetsCapabilities(agent('a'), requirements, 'manager')).toBe(true)
    expect(
      meetsCapabilities(
        agent('a', { managerId: null }),
        requirements,
        'manager',
      ),
    ).toBe(true)
    expect(
      meetsCapabilities(
        agent('a', { managerId: 'other' }),
        requirements,
        'manager',
      ),
    ).toBe(false)
    expect(
      meetsCapabilities(
        agent('a', { kind: 'manager' }),
        requirements,
        'manager',
      ),
    ).toBe(false)
    expect(
      meetsCapabilities(
        agent('a', { capabilities: ['Code'] }),
        requirements,
        'manager',
      ),
    ).toBe(false)
    expect(
      meetsCapabilities(
        agent('a'),
        { capabilities: ['code', 'design'], preferredAgentId: null },
        'manager',
      ),
    ).toBe(false)
    expect(
      meetsCapabilities(
        agent('a', { capabilities: [] }),
        { capabilities: [], preferredAgentId: null },
        'manager',
      ),
    ).toBe(true)
  })

  it.each([
    ['sleeping', true],
    ['queued', true],
    ['waiting', true],
    ['completed', true],
    ['working', false],
    ['walking', false],
    ['collaborating', false],
    ['blocked', false],
    ['repair', false],
  ] as const)(
    'treats an otherwise free %s employee availability as %s',
    (status, available) => {
      const worker = agent('worker', { status })
      expect(meetsCapabilities(worker, requirements, 'manager')).toBe(true)
      expect(
        eligibleAgents(state(worker), requirements, 'manager'),
      ).toHaveLength(available ? 1 : 0)
    },
  )

  it.each([
    ['queued', false],
    ['assigned', false],
    ['in_progress', false],
    ['waiting', false],
    ['blocked', false],
    ['completed', true],
    ['failed', true],
    ['cancelled', true],
  ] as const)('never steals a %s current task', (status, available) => {
    const snapshot = state(agent('worker', { currentTaskId: 'current' }))
    const task: RuntimeTask = {
      id: 'current',
      title: 'Current task',
      description: 'Supplied task',
      status,
      priority: 'normal',
      progressPercent: 0,
      assignedAgentId: 'worker',
      dependencyIds: [],
      parentTaskId: null,
      statusReason: null,
      waitingForDependencies: false,
      metadata: {},
      createdAt: '',
      updatedAt: '',
      startedAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
    }
    expect(
      eligibleAgents(
        { ...snapshot, tasks: { current: task } },
        requirements,
        'manager',
      ),
    ).toHaveLength(available ? 1 : 0)
  })

  it('fails closed when a current-task reference cannot be resolved', () => {
    expect(
      eligibleAgents(
        state(agent('worker', { currentTaskId: 'missing' })),
        requirements,
        'manager',
      ),
    ).toEqual([])
  })

  it('narrows to the preferred worker without falling back when that worker is busy or absent', () => {
    const snapshot = state(agent('a'), agent('b', { status: 'working' }))
    expect(
      eligibleAgents(
        snapshot,
        { ...requirements, preferredAgentId: 'a' },
        'manager',
      ).map((item) => item.id),
    ).toEqual(['a'])
    expect(
      eligibleAgents(
        snapshot,
        { ...requirements, preferredAgentId: 'b' },
        'manager',
      ),
    ).toEqual([])
    expect(
      eligibleAgents(
        snapshot,
        { ...requirements, preferredAgentId: 'missing' },
        'manager',
      ),
    ).toEqual([])
    expect(
      meetsCapabilities(
        snapshot.agents.b,
        { ...requirements, preferredAgentId: 'b' },
        'manager',
      ),
    ).toBe(true)
  })

  it('returns immutable stable ID order while reusing unchanged runtime records', () => {
    const snapshot = state(agent('z'), agent('a'), agent('B'))
    const before = structuredClone(snapshot)
    const candidates = eligibleAgents(snapshot, requirements, 'manager')
    expect(candidates.map((item) => item.id)).toEqual(['B', 'a', 'z'])
    expect(candidates[1]).toBe(snapshot.agents.a)
    expect(Object.isFrozen(candidates)).toBe(true)
    expect(snapshot).toEqual(before)
  })
})
