import { describe, expect, it } from 'vitest'
import type { RuntimeAgent, RuntimeState } from '../runtime/runtimeTypes'
import type {
  ExecutionPlan,
  ManagerRequest,
  PlanProposal,
  PlanTaskProposal,
} from './orchestrationTypes'
import { validatePlanProposal } from './planValidation'

const request: ManagerRequest = {
  requestId: 'request:one',
  title: 'Supplied request',
  description: 'Supplied description',
  requestedBy: 'user',
  priority: 'normal',
  constraints: ['Stay local', 'Preserve source assets'],
  managerId: 'manager',
  status: 'planning',
  planId: null,
  planningAttemptId: 'attempt:one',
  coordinationTaskId: null,
  issues: [],
  createdAt: '',
  updatedAt: '',
}
function task(
  id = 'task:one',
  patch: Partial<PlanTaskProposal> = {},
): PlanTaskProposal {
  return {
    id,
    title: 'Supplied task',
    description: 'Task description',
    priority: 'normal',
    status: 'queued',
    dependencyIds: [],
    requiredCapabilities: ['code'],
    preferredAgentId: null,
    ...patch,
  }
}
function proposal(patch: Partial<PlanProposal> = {}): PlanProposal {
  return {
    planId: 'plan:one',
    requestId: request.requestId,
    objective: 'Supplied objective',
    tasks: [task()],
    constraints: [...request.constraints],
    expectedOutputs: [],
    ...patch,
  }
}
function worker(patch: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    id: 'worker',
    name: 'Supplied worker',
    role: 'Engineer',
    departmentId: 'engineering',
    kind: 'standard-worker',
    capabilities: ['code'],
    status: 'sleeping',
    workstationId: null,
    managerId: 'manager',
    currentTaskId: null,
    destination: null,
    collaboratorIds: [],
    blockers: [],
    position: [0, 0, 0],
    headingRadians: 0,
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}
function state(): RuntimeState {
  return {
    connection: 'local',
    revision: 0,
    agents: { worker: worker() },
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
function rejects(input: unknown, code: string, snapshot = state()) {
  expect(validatePlanProposal(input, request, snapshot)).toMatchObject({
    ok: false,
    error: { code },
  })
}

describe('unknown plan validation', () => {
  it('returns an independent deeply frozen topological copy without mutating proposal or runtime', () => {
    const input = proposal({
      tasks: [
        task('final', { dependencyIds: ['middle'] }),
        task('root'),
        task('middle', { dependencyIds: ['root'] }),
      ],
      expectedOutputs: ['Supplied report'],
    })
    const before = structuredClone(input)
    const snapshot = state()
    const stateBefore = structuredClone(snapshot)
    const result = validatePlanProposal(input, request, snapshot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.tasks.map((item) => item.id)).toEqual([
      'root',
      'middle',
      'final',
    ])
    expect(result.proposal).not.toBe(input)
    expect(result.proposal.tasks[0]).not.toBe(input.tasks[1])
    expect(result.proposal.tasks[2].dependencyIds).not.toBe(
      input.tasks[0].dependencyIds,
    )
    for (const value of [
      result.proposal,
      result.proposal.tasks,
      result.proposal.constraints,
      result.proposal.expectedOutputs,
      ...result.proposal.tasks.flatMap((item) => [
        item,
        item.dependencyIds,
        item.requiredCapabilities,
      ]),
    ])
      expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(input)).toBe(false)
    expect(input).toEqual(before)
    expect(snapshot).toEqual(stateBefore)
    ;(input.constraints as string[]).push('Caller changes')
    expect(result.proposal.constraints).toEqual(request.constraints)
  })

  it('preserves deterministic input ordering for unrelated tasks and permits no invented outputs or capabilities', () => {
    const result = validatePlanProposal(
      proposal({ tasks: [task('b', { requiredCapabilities: [] }), task('a')] }),
      request,
      state(),
    )
    expect(result).toMatchObject({
      ok: true,
      proposal: { expectedOutputs: [] },
    })
    if (result.ok)
      expect(result.proposal.tasks.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it.each([
    null,
    [],
    'plan',
    1,
    new Date(),
    { ...proposal(), extra: true },
    { ...proposal(), tasks: [] },
  ])('rejects invalid plan shape %#', (input) => {
    rejects(input, 'INVALID_PLAN')
  })

  it('rejects missing fields, extra business state, accessor properties and sparse task arrays', () => {
    const { objective: _objective, ...missing } = proposal()
    rejects(missing, 'INVALID_PLAN')
    rejects(
      proposal({
        tasks: [{ ...task(), progressPercent: 100 } as PlanTaskProposal],
      }),
      'INVALID_PLAN',
    )
    const getter = Object.defineProperty({ ...proposal() }, 'objective', {
      get: () => {
        throw new Error('Must not execute')
      },
    })
    rejects(getter, 'INVALID_PLAN')
    rejects(proposal({ tasks: new Array<PlanTaskProposal>(1) }), 'INVALID_PLAN')
  })

  it.each([
    '__proto__',
    'constructor',
    'prototype',
    'has spaces',
    ' padded',
    'line\nbreak',
    'bad\u0000id',
  ])('rejects unsafe identifier %j', (value) => {
    rejects(proposal({ planId: value }), 'INVALID_PLAN_ID')
    rejects(proposal({ tasks: [task(value)] }), 'INVALID_PLAN_ID')
  })

  it('rejects runtime and proposal plan/task namespace collisions', () => {
    const snapshot = state()
    const existingPlan: ExecutionPlan = {
      planId: 'existing-plan',
      requestId: 'prior',
      managerId: 'manager',
      objective: 'Prior plan',
      taskIds: [],
      requirements: {},
      constraints: [],
      expectedOutputs: [],
      status: 'planned',
      issues: [],
      createdAt: '',
      updatedAt: '',
    }
    const withPlan = {
      ...snapshot,
      plans: { [existingPlan.planId]: existingPlan },
    }
    rejects(
      proposal({ planId: 'existing-plan' }),
      'PLAN_ID_COLLISION',
      withPlan,
    )
    rejects(
      proposal({ tasks: [task('existing-plan')] }),
      'PLAN_ID_COLLISION',
      withPlan,
    )
    const withTask = {
      ...snapshot,
      tasks: { occupied: {} as RuntimeState['tasks'][string] },
    }
    rejects(proposal({ planId: 'occupied' }), 'PLAN_ID_COLLISION', withTask)
    rejects(
      proposal({ tasks: [task('occupied')] }),
      'PLAN_ID_COLLISION',
      withTask,
    )
    rejects(proposal({ tasks: [task('plan:one')] }), 'PLAN_ID_COLLISION')
    rejects(proposal({ tasks: [task(), task()] }), 'PLAN_ID_COLLISION')
  })

  it('rejects unknown and cross-plan dependencies, duplicate edges, self cycles and transitive cycles', () => {
    rejects(
      proposal({ tasks: [task('a', { dependencyIds: ['missing'] })] }),
      'INVALID_PLAN_DEPENDENCY',
    )
    rejects(
      proposal({ tasks: [task('a', { dependencyIds: ['external'] })] }),
      'INVALID_PLAN_DEPENDENCY',
      { ...state(), tasks: { external: {} as RuntimeState['tasks'][string] } },
    )
    rejects(
      proposal({
        tasks: [task('a'), task('b', { dependencyIds: ['a', 'a'] })],
      }),
      'INVALID_PLAN_DEPENDENCY',
    )
    rejects(
      proposal({ tasks: [task('a', { dependencyIds: ['a'] })] }),
      'PLAN_DEPENDENCY_CYCLE',
    )
    rejects(
      proposal({
        tasks: [
          task('a', { dependencyIds: ['b'] }),
          task('b', { dependencyIds: ['c'] }),
          task('c', { dependencyIds: ['a'] }),
        ],
      }),
      'PLAN_DEPENDENCY_CYCLE',
    )
  })

  it('requires matching request identity and exact retained constraints while allowing additional constraints', () => {
    rejects(proposal({ requestId: 'other' }), 'PLAN_REQUEST_MISMATCH')
    rejects(
      proposal({ constraints: ['Stay Local', 'Preserve source assets'] }),
      'PLAN_CONSTRAINT_MISSING',
    )
    const result = validatePlanProposal(
      proposal({
        constraints: [...request.constraints, 'Additional supplied limit'],
      }),
      request,
      state(),
    )
    expect(result.ok).toBe(true)
  })

  it.each(['assigned', 'in_progress', 'completed', 'failed'])(
    'rejects fabricated initial task status %s',
    (status) => {
      rejects(
        { ...proposal(), tasks: [{ ...task(), status }] },
        'INVALID_PLAN_STATUS',
      )
    },
  )

  it('rejects blank text, unknown priorities and malformed string lists', () => {
    rejects(proposal({ objective: ' ' }), 'INVALID_PLAN')
    rejects(proposal({ tasks: [task('a', { title: '' })] }), 'INVALID_PLAN')
    rejects(
      proposal({ tasks: [task('a', { description: '\n' })] }),
      'INVALID_PLAN',
    )
    rejects(
      { ...proposal(), tasks: [{ ...task(), priority: 'critical' }] },
      'INVALID_PLAN_PRIORITY',
    )
    rejects({ ...proposal(), expectedOutputs: [null] }, 'INVALID_PLAN')
    rejects({ ...proposal(), constraints: 'Stay local' }, 'INVALID_PLAN')
    rejects(proposal({ expectedOutputs: new Array<string>(1) }), 'INVALID_PLAN')
    rejects(
      proposal({ tasks: [task('a', { requiredCapabilities: [''] })] }),
      'INVALID_PLAN',
    )
  })

  it.each([
    { id: 'missing' },
    { kind: 'manager' as const },
    { managerId: 'another-manager' },
    { capabilities: ['Code'] },
  ])('rejects an incompatible preferred agent %#', (patch) => {
    rejects(
      proposal({ tasks: [task('a', { preferredAgentId: 'worker' })] }),
      'INVALID_PREFERRED_AGENT',
      { ...state(), agents: { [patch.id ?? 'worker']: worker(patch) } },
    )
  })

  it('accepts a busy capable preferred employee or unowned employee without assigning either', () => {
    for (const patch of [
      { status: 'working' as const, currentTaskId: 'current' },
      { managerId: null },
    ]) {
      const snapshot = { ...state(), agents: { worker: worker(patch) } }
      const result = validatePlanProposal(
        proposal({ tasks: [task('a', { preferredAgentId: 'worker' })] }),
        request,
        snapshot,
      )
      expect(result.ok).toBe(true)
      expect(snapshot.agents.worker).toEqual(worker(patch))
      expect(snapshot.tasks).toEqual({})
    }
  })
})
