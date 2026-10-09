import { describe, expect, it } from 'vitest'
import type { AgentContext, OfficeRuntimeSnapshot } from './officeState'
import { presentedAgents, workerAtInstance } from './workerPresentation'
import { ManagerAsset, StandardWorkerAsset } from '../assets/officeAssets'

const worker: AgentContext = {
  id: 'worker-1',
  kind: 'standard-worker',
  name: 'Test worker',
  role: 'QA',
  departmentId: 'quality',
  position: [2, 0, 3],
  headingRadians: 0,
  status: 'waiting',
  manager: null,
  task: null,
  dependencies: null,
  collaborator: null,
  nextAction: null,
  blockers: null,
  activity: null,
  artifacts: null,
  providerUsage: null,
  cost: null,
  workstation: { position: [2, 0, 5], headingRadians: 0 },
}
const snapshot = (agents: AgentContext[]): OfficeRuntimeSnapshot => ({
  agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
  departments: {},
})

describe('canonical worker boundary', () => {
  it('requires normalized stable IDs rather than accepting ambiguous record identities', () => {
    expect(
      presentedAgents({ agents: { wrong: worker }, departments: {} }),
    ).toEqual([])
    const result = presentedAgents(
      snapshot([
        {
          ...worker,
          role: 'Research',
          collaborationTargetId: 'other',
          workstation: { ...worker.workstation!, id: 'desk-1' },
        },
      ]),
    )
    expect(result[0]).toMatchObject({
      id: 'worker-1',
      role: 'Research',
      departmentId: 'quality',
      collaborationTargetId: 'other',
      workstation: { id: 'desk-1' },
    })
  })
  it('never substitutes the worker for a Manager, including a role named Manager', () => {
    const data = snapshot([
      { ...worker, id: 'm1', kind: 'manager' },
      { ...worker, role: 'Manager assistant' },
    ])
    const agents = presentedAgents(data)
    expect(
      agents
        .filter((agent) => agent.kind === 'standard-worker')
        .map((item) => item.id),
    ).toEqual(['worker-1'])
    expect(
      agents.filter((agent) => agent.kind === 'manager').map((item) => item.id),
    ).toEqual(['m1'])
    expect(ManagerAsset.previewUrl).not.toBe(StandardWorkerAsset.previewUrl)
    expect(ManagerAsset.productionUrl).not.toBe(
      StandardWorkerAsset.productionUrl,
    )
    expect(StandardWorkerAsset.id).not.toBe(ManagerAsset.id)
  })
  it('maps raycast instance indices to current entity IDs after reorder and removal', () => {
    const a = presentedAgents(snapshot([worker, { ...worker, id: 'worker-2' }]))
    expect(workerAtInstance(a, 1)?.id).toBe('worker-2')
    expect(workerAtInstance([...a].reverse(), 1)?.id).toBe('worker-1')
    expect(workerAtInstance(a.slice(1), 1)).toBeUndefined()
    for (const index of [undefined, -1, 0.5, NaN])
      expect(workerAtInstance(a, index)).toBeUndefined()
  })
  it('preserves real status and fixed desk pose while the worker moves', () => {
    const presented = presentedAgents(
      snapshot([{ ...worker, position: [9, 0, 8], status: 'walking' }]),
    )[0]
    expect(presented.position).toEqual([9, 0, 8])
    expect(presented.workstation?.position).toEqual([2, 0, 5])
    expect(presented.status).toBe('walking')
    expect(presentedAgents(null)).toEqual([])
  })
  it('rejects nonfinite or ungrounded poses without placing them at a fake origin', () => {
    for (const position of [
      [NaN, 0, 1],
      [1, 2, 3],
      [1, 0, Infinity],
    ] as const) {
      expect(presentedAgents(snapshot([{ ...worker, position }]))).toEqual([])
    }
  })
})
