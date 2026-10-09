import { officeAssets } from '../assets/officeAssets'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import type { WorldPosition } from '../office/officeState'
import type {
  ManagerRequest,
  PlanProposal,
} from '../orchestration/orchestrationTypes'
import type { RuntimeCommand } from '../runtime/runtimeTypes'

export const MANAGER_PREVIEW_IDS = {
  manager: 'phase6-manager',
  researcher: 'phase6-researcher',
  implementer: 'phase6-implementer',
} as const

export const MANAGER_PREVIEW_TEMPLATE =
  'Development template: research → implementation'

/** Explicit registrations for this isolated development route only. */
export function managerRegistrations(): RuntimeCommand[] {
  const zones = ['engineering', 'quality', 'executive'].map((id) =>
    officeAssets.warehouse.layout.departments.find((zone) => zone.id === id)!,
  )
  const desks = zones.map((zone, index) => ({
    id: [
      'phase6-desk-research',
      'phase6-desk-implementation',
      'phase6-desk-manager',
    ][index],
    departmentId: zone.id,
    position: [
      zone.position[0],
      0,
      zone.position[2] + (zone.id === 'executive' ? 0.82 : 0.72),
    ] as WorldPosition,
    headingRadians: 0,
  }))
  return [
    ...zones.map((zone): RuntimeCommand => ({
      type: 'registerDepartment',
      department: {
        id: zone.id,
        name: zone.name,
        description:
          'Authored zone used by the explicit Manager development scenario.',
      },
    })),
    ...desks.map((workstation): RuntimeCommand => ({
      type: 'registerWorkstation',
      workstation,
    })),
    {
      type: 'registerAgent',
      agent: {
        id: MANAGER_PREVIEW_IDS.manager,
        name: 'Development Manager',
        role: 'Development request owner',
        departmentId: 'executive',
        kind: 'manager',
        status: 'waiting',
        workstationId: desks[2].id,
        position: seatedWorkstationAnchor(desks[2]),
        headingRadians: 0,
      },
    },
    {
      type: 'registerAgent',
      agent: {
        id: MANAGER_PREVIEW_IDS.researcher,
        name: 'Development Research Worker',
        role: 'Development research capability',
        capabilities: ['development.research'],
        departmentId: 'engineering',
        kind: 'standard-worker',
        status: 'queued',
        workstationId: desks[0].id,
        managerId: MANAGER_PREVIEW_IDS.manager,
        position: [0, 0, 0],
        headingRadians: 0,
      },
    },
    {
      type: 'registerAgent',
      agent: {
        id: MANAGER_PREVIEW_IDS.implementer,
        name: 'Development Implementation Worker',
        role: 'Development implementation capability',
        capabilities: ['development.implementation'],
        departmentId: 'quality',
        kind: 'standard-worker',
        status: 'sleeping',
        workstationId: desks[1].id,
        managerId: MANAGER_PREVIEW_IDS.manager,
        position: seatedWorkstationAnchor(desks[1]),
        headingRadians: 0,
      },
    },
    { type: 'selectAgent', agentId: MANAGER_PREVIEW_IDS.manager },
  ]
}

/** Fixed structured template. Request prose is preserved, never interpreted as AI output. */
export function managerDevelopmentPlan(
  request: Readonly<ManagerRequest>,
): PlanProposal {
  const research = `${request.requestId}:research`
  return {
    planId: `${request.requestId}:plan`,
    requestId: request.requestId,
    objective: request.title,
    constraints: [...request.constraints],
    expectedOutputs: [],
    tasks: [
      {
        id: research,
        title: 'Development research step',
        description: `Manual development step for the supplied request: ${request.description}`,
        priority: request.priority,
        status: 'queued',
        dependencyIds: [],
        requiredCapabilities: ['development.research'],
        preferredAgentId: null,
      },
      {
        id: `${request.requestId}:implementation`,
        title: 'Development implementation step',
        description:
          'Manual development step that may start only after the research dependency completes. No external work is executed.',
        priority: request.priority,
        status: 'queued',
        dependencyIds: [research],
        requiredCapabilities: ['development.implementation'],
        preferredAgentId: null,
      },
    ],
  }
}
