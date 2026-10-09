import { describe, expect, it } from 'vitest'
import type { AgentMotion, WorldPosition } from './officeState'
import { reverseAcceptedWorkstationRoute } from './workstationReturn'

const anchor: WorldPosition = [0.65, 0, -1.35]
const corner: WorldPosition = [1.2, 0, -1.5]
const end: WorldPosition = [1.2, 0, -2.5]
const route: AgentMotion = {
  id: 'accepted-outbound',
  points: [anchor, corner, end],
  speedMetersPerSecond: 0.85,
}

describe('return along accepted workstation routes', () => {
  it('reverses an accepted outbound route without mutating it or its points', () => {
    const before = structuredClone(route)
    expect(
      reverseAcceptedWorkstationRoute(end, anchor, route, 'return-1'),
    ).toEqual({
      id: 'return-1',
      points: [end, corner, anchor],
      speedMetersPerSecond: 0.85,
    })
    expect(route).toEqual(before)
  })

  it('trims a reversed route to the current occupied segment without a jump or detour', () => {
    const current: WorldPosition = [1.2, 0, -2]
    expect(
      reverseAcceptedWorkstationRoute(current, anchor, route, 'return-2')
        ?.points,
    ).toEqual([current, corner, anchor])
    const firstSegment: WorldPosition = [
      (anchor[0] + corner[0]) / 2,
      0,
      (anchor[2] + corner[2]) / 2,
    ]
    expect(
      reverseAcceptedWorkstationRoute(firstSegment, anchor, route, 'return-3')
        ?.points,
    ).toEqual([firstSegment, anchor])
  })

  it('continues a previously accepted return path toward the same desk', () => {
    const returning = { ...route, points: [end, corner, anchor] }
    expect(
      reverseAcceptedWorkstationRoute(
        [1.2, 0, -2],
        anchor,
        returning,
        'return-resume',
      )?.points,
    ).toEqual([[1.2, 0, -2], corner, anchor])
  })

  it('does not invent a connector for an unknown location or a different workstation', () => {
    expect(
      reverseAcceptedWorkstationRoute([8, 0, 8], anchor, route, 'unknown'),
    ).toBeNull()
    expect(
      reverseAcceptedWorkstationRoute(end, [5, 0, 5], route, 'other-desk'),
    ).toBeNull()
    expect(
      reverseAcceptedWorkstationRoute(end, anchor, undefined, 'no-history'),
    ).toBeNull()
    expect(
      reverseAcceptedWorkstationRoute(anchor, anchor, route, 'already-home'),
    ).toBeNull()
  })

  it('uses world points directly for rotated desks and tolerates duplicate waypoints', () => {
    const rotatedAnchor: WorldPosition = [4, 0, 7]
    const rotatedEnd: WorldPosition = [2, 0, 7]
    const accepted = {
      ...route,
      points: [rotatedAnchor, rotatedAnchor, rotatedEnd],
    }
    const result = reverseAcceptedWorkstationRoute(
      [3, 0, 7],
      rotatedAnchor,
      accepted,
      'rotated',
    )
    expect(result?.points).toEqual([[3, 0, 7], rotatedAnchor, rotatedAnchor])
  })

  it('rejects malformed or ungrounded history instead of emitting an unsafe command', () => {
    for (const accepted of [
      { ...route, points: [anchor] },
      { ...route, points: [anchor, [1, 1, -2] as WorldPosition] },
      { ...route, speedMetersPerSecond: 4 },
      { ...route, speedMetersPerSecond: NaN },
    ])
      expect(
        reverseAcceptedWorkstationRoute(end, anchor, accepted, 'invalid'),
      ).toBeNull()
    expect(
      reverseAcceptedWorkstationRoute(
        [NaN, 0, 0],
        anchor,
        route,
        'invalid-position',
      ),
    ).toBeNull()
  })
})
