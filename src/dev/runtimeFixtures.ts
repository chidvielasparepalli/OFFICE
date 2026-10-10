import { officeAssets } from '../assets/officeAssets'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import type { WorldPosition } from '../office/officeState'
import type { CreateTaskInput, RuntimeCommand } from '../runtime/runtimeTypes'

export const DEVELOPMENT_AGENT_IDS = {
  workerA: 'phase5-worker-a',
  workerB: 'phase5-worker-b',
  manager: 'phase5-manager',
} as const

/** Registration commands used only after an explicit development connection. */
export function developmentRegistrations(): RuntimeCommand[] {
  const departments = ['engineering', 'quality', 'executive'].map((id) => {
    const zone = officeAssets.warehouse.layout.departments.find(
      (department) => department.id === id,
    )!
    return { id: zone.id, name: zone.name, position: zone.position }
  })
  const desks = departments.map((department, index) => ({
    id: ['phase5-desk-a', 'phase5-desk-b', 'phase5-desk-manager'][index],
    departmentId: department.id,
    position: [
      department.position[0],
      0,
      department.position[2] + (department.id === 'executive' ? 0.82 : 0.72),
    ] as WorldPosition,
    headingRadians: 0,
  }))
  return [
    ...departments.map(({ id, name }): RuntimeCommand => ({
      type: 'registerDepartment',
      department: {
        id,
        name,
        description: 'Authored office zone registered for local development.',
      },
    })),
    ...desks.map((workstation): RuntimeCommand => ({
      type: 'registerWorkstation',
      workstation,
    })),
    {
      type: 'registerAgent',
      agent: {
        id: DEVELOPMENT_AGENT_IDS.manager,
        name: 'Development Manager',
        role: 'Development coordination sample',
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
        id: DEVELOPMENT_AGENT_IDS.workerA,
        name: 'Development Worker A',
        role: 'Development standard worker sample',
        departmentId: 'engineering',
        kind: 'standard-worker',
        status: 'queued',
        workstationId: desks[0].id,
        managerId: DEVELOPMENT_AGENT_IDS.manager,
        position: [0, 0, 0],
        headingRadians: 0,
      },
    },
    {
      type: 'registerAgent',
      agent: {
        id: DEVELOPMENT_AGENT_IDS.workerB,
        name: 'Development Worker B',
        role: 'Development standard worker sample',
        departmentId: 'quality',
        kind: 'standard-worker',
        status: 'sleeping',
        workstationId: desks[1].id,
        managerId: DEVELOPMENT_AGENT_IDS.manager,
        position: seatedWorkstationAnchor(desks[1]),
        headingRadians: 0,
      },
    },
    { type: 'selectAgent', agentId: DEVELOPMENT_AGENT_IDS.workerA },
  ]
}

export function developmentTask(
  id: string,
  title: string,
  dependencyIds: readonly string[] = [],
): CreateTaskInput {
  return {
    id,
    title,
    description:
      'Explicit local development input for deterministic state and scene validation. No external task execution or AI reasoning occurs.',
    priority: 'normal',
    dependencyIds,
    metadata: { developmentFixture: 'phase5-runtime-preview' },
  }
}
