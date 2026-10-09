import { officeAssets } from '../assets/officeAssets'
import { seatedWorkstationAnchor } from '../office/characterMotion'
import type { WorldPosition } from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'

export const SCENARIO_MANAGER_ID = 'scenario-manager-primary'
export const DEFAULT_SCENARIO_AGENT_ID = 'scenario-worker-13'
const hub = officeAssets.warehouse.layout.anchors.find(
  (anchor) => anchor.name === 'HUB_CENTRAL',
)!.position
export const SCENARIO_HUB_POSITION: WorldPosition = [hub[0], hub[1], hub[2]]

/** Isolated spatial test fixtures. These are never an OfficeRuntimeSnapshot. */
export function createNavigationSamples(): AgentPlacement[] {
  const workers: AgentPlacement[] = officeAssets.warehouse.layout.departments
    .filter((zone) => zone.id !== 'executive')
    .flatMap((zone, department) =>
      Array.from({ length: 5 }, (_, index) => {
        const id = `scenario-worker-${String(department * 5 + index + 1).padStart(2, '0')}`
        const workstation = {
          position: [
            zone.position[0] + [-2.5, 0, 2.5][index % 3],
            0,
            zone.position[2] + (index < 3 ? -1.3 : 1.4) + 0.72,
          ] as WorldPosition,
          headingRadians: 0,
        }
        return {
          id,
          kind: 'standard-worker' as const,
          label: `Worker scenario ${department * 5 + index + 1}`,
          role: 'Standard worker asset sample',
          departmentId: zone.id,
          status: 'working' as const,
          position: seatedWorkstationAnchor(workstation),
          headingRadians: 0,
          workstation,
        }
      }),
    )
  const workstation = {
    position: [0, 0, -10.18] as WorldPosition,
    headingRadians: 0,
  }
  workers.push({
    id: SCENARIO_MANAGER_ID,
    kind: 'manager',
    label: 'Manager scenario',
    role: 'Manager asset sample',
    departmentId: 'executive',
    status: 'working',
    position: seatedWorkstationAnchor(workstation),
    headingRadians: 0,
    workstation,
  })
  return workers
}
