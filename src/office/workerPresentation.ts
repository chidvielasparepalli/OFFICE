import type {
  AgentMotion,
  AgentRuntimeWorkstation,
  OfficeAgentStatus,
  OfficeRuntimeSnapshot,
  WorldPosition,
} from './officeState'

export interface AgentPlacement {
  id: string
  kind: 'standard-worker' | 'manager'
  label: string
  position: WorldPosition
  headingRadians: number
  status: OfficeAgentStatus | null
  departmentId?: string
  role?: string
  collaborationTargetId?: string | null
  workstation?: AgentRuntimeWorkstation
  motion?: Readonly<AgentMotion>
  /** A rejected route remains visible as a diagnostic, never a straight-line fallback. */
  navigationDiagnostic?: string
}

export const statusSymbols: Record<OfficeAgentStatus, string> = {
  sleeping: 'Z',
  queued: 'Q',
  working: 'W',
  walking: '→',
  collaborating: '↔',
  waiting: '…',
  completed: '✓',
  blocked: '!',
  repair: 'R',
}

export function validGroundPose(pose: {
  position: WorldPosition
  headingRadians: number
}) {
  return (
    Array.isArray(pose.position) &&
    pose.position.length === 3 &&
    pose.position.every(Number.isFinite) &&
    pose.position[1] === 0 &&
    Number.isFinite(pose.headingRadians)
  )
}

export function presentedAgents(
  runtime: OfficeRuntimeSnapshot | null,
): AgentPlacement[] {
  return Object.entries(runtime?.agents ?? {})
    .filter(
      ([id, agent]) =>
        id.length > 0 &&
        id === agent.id &&
        (agent.kind === 'standard-worker' || agent.kind === 'manager') &&
        validGroundPose(agent),
    )
    .map(([, agent]) => ({
      id: agent.id,
      kind: agent.kind,
      label: `${agent.name} — ${agent.role}`,
      position: agent.position,
      headingRadians: agent.headingRadians,
      status: agent.status,
      departmentId: agent.departmentId,
      role: agent.role,
      collaborationTargetId: agent.collaborationTargetId,
      motion: agent.motion,
      workstation:
        agent.workstation && validGroundPose(agent.workstation)
          ? agent.workstation
          : undefined,
    }))
}

export function workerAtInstance(
  workers: readonly AgentPlacement[],
  instanceId: number | undefined,
) {
  return instanceId !== undefined &&
    Number.isInteger(instanceId) &&
    instanceId >= 0
    ? workers[instanceId]
    : undefined
}
