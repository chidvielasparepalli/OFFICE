import { expect, it } from 'vitest'
import { emptyRealtimeView } from '../realtime/realtimeCodec'
import { createOfficeRuntimeBridge } from '../runtime/officeRuntimeBridge'
import { createCharacterMotion } from '../office/characterMotion'
import { presentedAgents } from '../office/workerPresentation'
import type { AgentSpatialSnapshot } from '../office/officeState'
import type { RuntimeAgent, RuntimeState } from '../runtime/runtimeTypes'

it('keeps an interrupted Manager return route safe when the old frame advances before new props arrive', () => {
  const manager: RuntimeAgent = {
    id: 'manager',
    name: 'Manager',
    role: 'Recruitment Manager',
    kind: 'manager',
    departmentId: 'executive',
    capabilities: [],
    status: 'walking',
    workstationId: 'executive-desk',
    managerId: null,
    currentTaskId: null,
    destination: {
      id: 'return-1',
      destinationType: 'workstation',
      destinationId: 'executive-desk',
      movementReason: 'Return after interview',
      arrivalStatus: 'waiting',
      collaboratorIds: [],
    },
    collaboratorIds: [],
    blockers: [],
    position: [0.8, 0, 10],
    headingRadians: -Math.PI / 2,
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
  }
  const state: RuntimeState = {
    ...emptyRealtimeView().state,
    connection: 'local',
    agents: { manager },
    workstations: {
      'executive-desk': {
        id: 'executive-desk',
        departmentId: 'executive',
        position: [0, 0, -10.18],
        headingRadians: 0,
      },
    },
  }
  const view: AgentSpatialSnapshot = {
    agentId: 'manager',
    position: manager.position,
    headingRadians: manager.headingRadians,
    workstation: null,
    destination: null,
    movementState: 'stationary',
    speedMetersPerSecond: 0,
    pathProgress: null,
    collaborationTargetId: null,
    phase: 'standing',
    diagnostic: null,
    motionId: null,
    completedMotionId: null,
  }
  const views = new Map([['manager', view]]),
    bridge = createOfficeRuntimeBridge()
  const placement = presentedAgents(bridge.project(state, views))[0]
  const controller = createCharacterMotion(placement)
  for (let frame = 0; frame < 50; frame++) controller.advance(0.1)
  const frame = controller.advance(0)
  views.set('manager', {
    ...view,
    position: [...frame.position],
    phase: frame.phase,
    motionId: frame.motionId,
  })
  const interrupted: RuntimeState = {
    ...state,
    revision: 1,
    agents: {
      manager: {
        ...manager,
        destination: {
          ...manager.destination!,
          id: 'interview-2',
          destinationType: 'waypoint',
          destinationId: 'interview:manager',
          arrivalStatus: 'collaborating',
        },
      },
    },
  }
  const next = presentedAgents(bridge.project(interrupted, views))[0]
  // R3F may render one old frame while React commits an event-driven projection.
  const beforeCommit = [...controller.advance(0.1).position]
  controller.update(next)
  expect(controller.advance(0).position).toEqual(beforeCommit)
  expect(controller.advance(0).diagnostic).toBeNull()
  for (let step = 0; step < 100; step++) controller.advance(0.1)
  expect(controller.advance(0).position).toEqual([0.8, 0, 10])
  expect(controller.advance(0).headbandVisible).toBe(false)
})
