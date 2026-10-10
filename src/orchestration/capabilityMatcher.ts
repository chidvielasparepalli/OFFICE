import type { RuntimeAgent, RuntimeState } from '../runtime/runtimeTypes'
import type { TaskRequirements } from './orchestrationTypes'

const availableStatuses = new Set([
  'sleeping',
  'queued',
  'waiting',
  'completed',
])
const terminalTasks = new Set(['completed', 'failed', 'cancelled'])

/** Capability/ownership fit only; availability is checked at dispatch time. */
export function meetsCapabilities(
  agent: Readonly<RuntimeAgent>,
  requirements: Readonly<TaskRequirements>,
  managerId: string,
): boolean {
  return (
    agent.kind === 'standard-worker' &&
    (agent.managerId === null || agent.managerId === managerId) &&
    (requirements.preferredAgentId === null ||
      requirements.preferredAgentId === agent.id) &&
    requirements.capabilities.every((capability) =>
      agent.capabilities.includes(capability),
    )
  )
}

/** Stable ordering makes equally capable workers deterministic without changing them. */
export function eligibleAgents(
  state: RuntimeState,
  requirements: Readonly<TaskRequirements>,
  managerId: string,
): readonly Readonly<RuntimeAgent>[] {
  return Object.freeze(
    Object.values(state.agents)
      .filter((agent) => {
        if (
          !meetsCapabilities(agent, requirements, managerId) ||
          !availableStatuses.has(agent.status)
        )
          return false
        if (agent.currentTaskId === null) return true
        const task = state.tasks[agent.currentTaskId]
        return task !== undefined && terminalTasks.has(task.status)
      })
      .sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
  )
}
