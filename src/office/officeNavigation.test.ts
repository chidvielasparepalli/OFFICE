import { describe, expect, it } from 'vitest'
import layout from '../../assets/warehouse/open-layout.json'
import { standingWorkstationAnchor, workstationAnchor } from './characterMotion'
import {
  createOfficeNavigation,
  type NavigationPlan,
  type NavigationWorkstation,
} from './officeNavigation'
import type { WorldPosition } from './officeState'

const workstations: NavigationWorkstation[] = layout.departments
  .filter((zone) => zone.id !== 'executive')
  .flatMap((zone) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${zone.id}-${index}`,
      position: [
        zone.position[0] + [-2.5, 0, 2.5][index % 3],
        0,
        zone.position[2] + (index < 3 ? -1.3 : 1.4) + 0.72,
      ] as WorldPosition,
      headingRadians: 0,
    })),
  )
workstations.push({
  id: 'manager',
  position: [0, 0, -10.18],
  headingRadians: 0,
})
const navigation = createOfficeNavigation(workstations)

function successful(plan: NavigationPlan) {
  expect(plan.ok, plan.ok ? undefined : plan.diagnostic).toBe(true)
  if (!plan.ok) throw new Error(plan.diagnostic)
  return plan
}

function sampleSegments(points: readonly WorldPosition[]) {
  return points.slice(1).flatMap((to, index) => {
    const from = points[index]
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 0.04),
    )
    return Array.from({ length: steps + 1 }, (_, step): WorldPosition => [
      from[0] + ((to[0] - from[0]) * step) / steps,
      0,
      from[2] + ((to[2] - from[2]) * step) / steps,
    ])
  })
}

describe('deterministic office navigation', () => {
  it('routes all 30 standard desks and the Manager to the hub and back through clear aisles', () => {
    expect(workstations).toHaveLength(31)
    for (const station of workstations) {
      const start = standingWorkstationAnchor(station)
      const outbound = successful(
        navigation.planNavigation(start, 'hub:central'),
      )
      const inbound = successful(
        navigation.planNavigation(
          outbound.destination.position,
          `workstation:${station.id}`,
        ),
      )
      expect(outbound.points[0]).toEqual(start)
      expect(outbound.points.at(-1)).toEqual([0, 0, 3])
      expect(inbound.points.at(-1)).toEqual(start)
      expect(navigation.validatePath(outbound.points).ok).toBe(true)
      expect(navigation.validatePath(inbound.points).ok).toBe(true)
      // Independent samples against measured asset bounds, not the planner's inflated rectangles.
      for (const point of sampleSegments([
        ...outbound.points,
        ...inbound.points,
      ])) {
        expect(Math.abs(point[0])).toBeLessThanOrEqual(17.76)
        expect(Math.abs(point[2])).toBeLessThanOrEqual(17.76)
        const intersects = workstations.some((other) => {
          const x = Math.abs(point[0] - other.position[0]),
            z = point[2] - other.position[2]
          return (
            (x < 1.043120265 + 0.24 &&
              z > -0.468564034 - 0.24 &&
              z < 0.468564034 + 0.24) ||
            (x < 0.404168964 + 0.24 &&
              z > -1.690161968 - 0.24 &&
              z < -0.469837993 + 0.24)
          )
        })
        expect(intersects).toBe(false)
      }
    }
  })

  it('creates safe explicit department, entrance, meeting and corridor nodes', () => {
    for (const zone of layout.departments) {
      const plan = successful(
        navigation.planNavigation([0, 0, 3], `department:${zone.id}`),
      )
      expect(navigation.validatePath(plan.points).ok).toBe(true)
    }
    for (const destination of ['entrance:front', 'meeting:open', 'corridor:0'])
      expect(
        successful(navigation.planNavigation([0, 0, 3], destination))
          .destination.id,
      ).toBe(destination)
    expect(navigation.edges.every((edge) => edge.distanceMeters >= 0)).toBe(
      true,
    )
  })

  it('returns identical paths when station input order changes and snapshots static placement', () => {
    const first = navigation.planNavigation(
      standingWorkstationAnchor(workstations[0]),
      'workstation:manager',
    )
    const reordered = createOfficeNavigation([...workstations].reverse())
    expect(
      reordered.planNavigation(
        standingWorkstationAnchor(workstations[0]),
        'workstation:manager',
      ),
    ).toEqual(first)
    const mutable = {
      id: 'desk',
      position: [0, 0, 0] as [number, number, number],
      headingRadians: 0,
    }
    const fixed = createOfficeNavigation([mutable])
    mutable.position[0] = 15
    expect(
      successful(fixed.planNavigation([0, 0, 3], 'workstation:desk'))
        .destination.position,
    ).toEqual([0.65, 0, -1.35])
  })

  it('returns from the exact middle of any outbound segment without teleporting', () => {
    const station = workstations[0]
    const outbound = successful(
      navigation.planNavigation(
        standingWorkstationAnchor(station),
        'hub:central',
      ),
    )
    for (let index = 0; index < outbound.points.length - 1; index++) {
      const from = outbound.points[index],
        to = outbound.points[index + 1]
      const current: WorldPosition = [
        (from[0] + to[0]) / 2,
        0,
        (from[2] + to[2]) / 2,
      ]
      const result = successful(
        navigation.planNavigation(current, `workstation:${station.id}`),
      )
      expect(result.points[0]).toEqual(current)
      expect(navigation.validatePath(result.points).ok).toBe(true)
    }
  })

  it('rejects furniture crossings, narrow desk gaps, swept chair space and invalid ground points', () => {
    const pair = createOfficeNavigation([
      { id: 'a', position: [0, 0, 0], headingRadians: 0 },
      { id: 'b', position: [2.5, 0, 0], headingRadians: 0 },
    ])
    expect(
      pair.validatePath([
        [1.25, 0, -3],
        [1.25, 0, 2],
      ]).ok,
    ).toBe(false)
    expect(
      pair.validatePath([
        [-2, 0, 0],
        [2, 0, 0],
      ]).ok,
    ).toBe(false)
    expect(
      pair.validatePath([
        [-1, 0, -1.6],
        [1, 0, -1.6],
      ]).ok,
    ).toBe(false)
    expect(
      pair.validatePath([
        [-1, 0, -2],
        [1, 0, -2],
      ]).ok,
    ).toBe(true)
    expect(
      pair.validatePath([
        [0, 0, 3],
        [18, 0, 3],
      ]).ok,
    ).toBe(false)
    expect(
      pair.validatePath([
        [0, 1, 3],
        [0, 0, 4],
      ]).ok,
    ).toBe(false)
    expect(
      pair.validatePath([
        [NaN, 0, 3],
        [0, 0, 4],
      ]).ok,
    ).toBe(false)
    expect(pair.validatePath([[0, 0, 3]]).ok).toBe(false)
    expect(
      pair.validatePath([
        [1.1, 0, -0.9],
        [1.4, 0, -0.5],
      ]).ok,
    ).toBe(false)
    expect(pair.planNavigation([0, 0, -0.73], 'hub:central').ok).toBe(false)
    expect(pair.planNavigation([0, 0, 3], 'missing').ok).toBe(false)
  })

  it('reports disconnected routes instead of crossing a continuous furniture barrier', () => {
    const barrier = createOfficeNavigation(
      Array.from({ length: 19 }, (_, index) => ({
        id: `barrier-${index}`,
        position: [(index - 9) * 2, 0, 0] as WorldPosition,
        headingRadians: 0,
      })),
    )
    const plan = barrier.planNavigation([0, 0, -5], 'hub:central')
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.diagnostic).toContain('No furniture-safe route')
  })

  it('handles rotated workstations with the same clearance and standing-anchor contract', () => {
    const station: NavigationWorkstation = {
      id: 'rotated',
      position: [3, 0, 1],
      headingRadians: Math.PI / 3,
    }
    const graph = createOfficeNavigation([station])
    const start = standingWorkstationAnchor(station)
    const plan = successful(graph.planNavigation(start, 'hub:central'))
    expect(graph.validatePath(plan.points).ok).toBe(true)
    expect(
      graph.validatePath([
        workstationAnchor(station, [-2, 0, 0]),
        workstationAnchor(station, [2, 0, 0]),
      ]).ok,
    ).toBe(false)
    expect(
      graph.validatePath([
        workstationAnchor(station, [-1, 0, -2]),
        workstationAnchor(station, [1, 0, -2]),
      ]).ok,
    ).toBe(true)
  })

  it('approaches another standing agent without occupying or crossing their position', () => {
    const target: WorldPosition = [0, 0, 3]
    const approach = successful(navigation.planApproach([0, 0, -5], target))
    expect(approach.destination.id).toBeNull()
    expect(
      Math.hypot(
        approach.destination.position[0],
        approach.destination.position[2] - 3,
      ),
    ).toBeCloseTo(0.85)
    for (const point of sampleSegments(approach.points))
      expect(Math.hypot(point[0], point[2] - 3)).toBeGreaterThanOrEqual(
        0.55 - 1e-8,
      )
    expect(navigation.planApproach([0, 0, 3], [0, 0, 3]).ok).toBe(false)
  })

  it('rejects invalid station identities and accepts a zero-distance arrival explicitly', () => {
    expect(() =>
      createOfficeNavigation([
        { id: 'x', position: [0, 0, 0], headingRadians: Infinity },
      ]),
    ).toThrow('finite ground poses')
    expect(() =>
      createOfficeNavigation([workstations[0], workstations[0]]),
    ).toThrow('unique workstation IDs')
    const result = successful(
      navigation.planNavigation([0, 0, 3], 'hub:central'),
    )
    expect(result.distanceMeters).toBe(0)
    expect(result.points).toEqual([
      [0, 0, 3],
      [0, 0, 3],
    ])
  })
})
