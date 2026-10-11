import type { OfficeRuntime } from '../../src/runtime/officeRuntime'
import type { RuntimeCommand } from '../../src/runtime/runtimeTypes'
import { ToolFault } from '../../src/tools/toolTypes'
import {
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from '../../src/office/characterMotion'

export function validatePreviewFeedback(
  runtime: Pick<OfficeRuntime, 'getSnapshot'>,
  command: RuntimeCommand,
) {
  const state = runtime.getSnapshot()
  if (command.type === 'selectAgent' || command.type === 'selectTask') return
  if (command.type !== 'arrive' && command.type !== 'rejectMovement')
    throw new ToolFault(
      'COMMAND_DENIED',
      'Only selection and discrete spatial feedback are accepted from the scene.',
    )
  const agent = state.agents[command.agentId]
  if (!agent || agent.destination?.id !== command.intentId)
    throw new ToolFault(
      'STALE_INTENT',
      'Spatial feedback does not match the current host intent.',
    )
  if (command.type === 'arrive') {
    const desk = agent.workstationId && state.workstations[agent.workstationId]
    if (!desk || agent.destination.destinationType !== 'workstation')
      throw new ToolFault(
        'DESTINATION_DENIED',
        'Only the assigned fixture workstation may receive arrival feedback.',
      )
    const near = ([px, py, pz]: readonly number[]) =>
      Math.hypot(
        command.position[0] - px,
        command.position[1] - py,
        command.position[2] - pz,
      ) < 0.03
    const facing = Math.abs(
      Math.atan2(
        Math.sin(command.headingRadians - desk.headingRadians),
        Math.cos(command.headingRadians - desk.headingRadians),
      ),
    )
    if (
      !near(seatedWorkstationAnchor(desk)) &&
      !near(standingWorkstationAnchor(desk))
    )
      throw new ToolFault(
        'INVALID_ARRIVAL',
        'Arrival must match an authored seated or standing workstation anchor.',
      )
    if (near(seatedWorkstationAnchor(desk)) && facing > 0.02)
      throw new ToolFault(
        'INVALID_ARRIVAL',
        'A seated arrival must face its assigned workstation.',
      )
  }
}
