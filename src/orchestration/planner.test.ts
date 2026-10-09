import { describe, expect, it, vi } from 'vitest'
import type { ManagerRequest, PlanningContext } from './orchestrationTypes'
import { DeterministicPlanner } from './planner'

const request: ManagerRequest = Object.freeze({
  requestId: 'request:one',
  title: 'Supplied request',
  description: 'Supplied description',
  requestedBy: 'user',
  priority: 'normal',
  constraints: Object.freeze(['Stay local']),
  managerId: 'manager',
  status: 'planning',
  planId: null,
  planningAttemptId: 'attempt:one',
  coordinationTaskId: null,
  issues: Object.freeze([]),
  createdAt: '',
  updatedAt: '',
})
const context: PlanningContext = Object.freeze({
  managerId: 'manager',
  agents: Object.freeze([]),
  existingTaskIds: Object.freeze([]),
})

describe('injected deterministic planner', () => {
  it('calls only the supplied proposal factory with the explicit request and planning context', async () => {
    const proposal = { supplied: 'Unknown until validated' }
    const factory = vi.fn(() => proposal)
    const planner = new DeterministicPlanner(factory)
    expect(await planner.plan(request, context)).toBe(proposal)
    expect(await planner.plan(request, context)).toBe(proposal)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenNthCalledWith(1, request, context)
    expect(factory).toHaveBeenNthCalledWith(2, request, context)
  })

  it('leaves malformed output unknown for the validator rather than fabricating a usable plan', async () => {
    const planner = new DeterministicPlanner(() => null)
    expect(await planner.plan(request, context)).toBeNull()
  })

  it('rejects with the factory failure without fabricating tasks or swallowing the error', async () => {
    const failure = new Error('Explicit planning failure')
    const planner = new DeterministicPlanner(() => {
      throw failure
    })
    await expect(planner.plan(request, context)).rejects.toBe(failure)
  })
})
