import layout from '../../assets/warehouse/open-layout.json'
import { standingWorkstationAnchor, workstationAnchor } from './characterMotion'
import type { WorldPosition } from './officeState'

export const NAVIGATION_CLEARANCE_METERS = 0.24
const CORNER_MARGIN = 0.001
const EPSILON = 1e-8

export interface NavigationWorkstation {
  readonly id: string
  readonly position: WorldPosition
  readonly headingRadians: number
}

export interface NavigationNode {
  readonly id: string
  readonly kind:
    | 'workstation'
    | 'department'
    | 'hub'
    | 'corridor'
    | 'entrance'
    | 'meeting'
    | 'waypoint'
  readonly position: WorldPosition
}

export interface NavigationEdge {
  readonly from: string
  readonly to: string
  readonly distanceMeters: number
}

export type NavigationValidation =
  { readonly ok: true } | { readonly ok: false; readonly diagnostic: string }
export type NavigationPlan =
  | {
      readonly ok: true
      readonly points: readonly WorldPosition[]
      readonly destination: {
        readonly id: string | null
        readonly position: WorldPosition
      }
      readonly distanceMeters: number
    }
  | { readonly ok: false; readonly diagnostic: string }

interface Rectangle {
  readonly station: NavigationWorkstation
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

// Measured from canonical workstation GLB 3650dee26161bd9f…; rounded outwards.
// Desk excludes CHAIR. Chair covers both seated and 0.4 m rolled-back positions.
// A single enclosing workstation box would incorrectly block its calibrated exit.
const FOOTPRINTS = [
  { minX: -1.044, maxX: 1.044, minZ: -0.469, maxZ: 0.469 },
  { minX: -0.405, maxX: 0.405, minZ: -1.691, maxZ: -0.469 },
] as const

const distance = (a: WorldPosition, b: WorldPosition) =>
  Math.hypot(a[0] - b[0], a[2] - b[2])
const validPoint = (point: WorldPosition) =>
  Array.isArray(point) &&
  point.length === 3 &&
  point.every(Number.isFinite) &&
  point[1] === 0
const clonePoint = (point: WorldPosition): WorldPosition => [
  point[0],
  0,
  point[2],
]
const failure = (diagnostic: string) => ({ ok: false as const, diagnostic })

function localPoint(
  point: WorldPosition,
  station: NavigationWorkstation,
): WorldPosition {
  const x = point[0] - station.position[0],
    z = point[2] - station.position[2]
  const sine = Math.sin(station.headingRadians),
    cosine = Math.cos(station.headingRadians)
  return [x * cosine - z * sine, 0, x * sine + z * cosine]
}

/** Slab intersection includes tangencies: touching inflated furniture is not a safe route. */
function intersectsRectangle(
  from: WorldPosition,
  to: WorldPosition,
  rectangle: Rectangle,
) {
  const a = localPoint(from, rectangle.station),
    b = localPoint(to, rectangle.station)
  let first = 0,
    last = 1
  for (const [axis, minimum, maximum] of [
    [0, rectangle.minX, rectangle.maxX],
    [2, rectangle.minZ, rectangle.maxZ],
  ]) {
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < EPSILON) {
      if (a[axis] < minimum - EPSILON || a[axis] > maximum + EPSILON)
        return false
    } else {
      const enter = (minimum - a[axis]) / delta,
        leave = (maximum - a[axis]) / delta
      first = Math.max(first, Math.min(enter, leave))
      last = Math.min(last, Math.max(enter, leave))
      if (first > last + EPSILON) return false
    }
  }
  return true
}

function distanceToSegment(
  point: WorldPosition,
  a: WorldPosition,
  b: WorldPosition,
) {
  const x = b[0] - a[0],
    z = b[2] - a[2],
    length = x * x + z * z
  const amount = length
    ? Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * x + (point[2] - a[2]) * z) / length),
      )
    : 0
  return distance(point, [a[0] + x * amount, 0, a[2] + z * amount])
}

/** Static, command-time visibility graph. This does not advance agents or create application state. */
export function createOfficeNavigation(
  workstations: readonly NavigationWorkstation[],
) {
  const ids = new Set<string>()
  const stations = workstations
    .map((station) => {
      if (
        typeof station.id !== 'string' ||
        !station.id ||
        ids.has(station.id) ||
        !validPoint(station.position) ||
        !Number.isFinite(station.headingRadians)
      )
        throw new Error(
          'Navigation requires unique workstation IDs and finite ground poses.',
        )
      ids.add(station.id)
      return { ...station, position: clonePoint(station.position) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const clearance = NAVIGATION_CLEARANCE_METERS
  const bounds = Object.freeze({
    minX: -layout.width / 2 + clearance,
    maxX: layout.width / 2 - clearance,
    minZ: -layout.depth / 2 + clearance,
    maxZ: layout.depth / 2 - clearance,
  })
  const rectangles: Rectangle[] = stations.flatMap((station) =>
    FOOTPRINTS.map((shape) => ({
      station,
      minX: shape.minX - clearance,
      maxX: shape.maxX + clearance,
      minZ: shape.minZ - clearance,
      maxZ: shape.maxZ + clearance,
    })),
  )
  const insideFloor = (point: WorldPosition) =>
    validPoint(point) &&
    point[0] >= bounds.minX &&
    point[0] <= bounds.maxX &&
    point[2] >= bounds.minZ &&
    point[2] <= bounds.maxZ
  const clearSegment = (from: WorldPosition, to: WorldPosition) =>
    insideFloor(from) &&
    insideFloor(to) &&
    !rectangles.some((rectangle) => intersectsRectangle(from, to, rectangle))

  function validatePath(
    points: readonly WorldPosition[],
  ): NavigationValidation {
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > 1024 ||
      !points.every(validPoint)
    )
      return failure('A route must contain 2–1024 finite Y=0 ground points.')
    for (let index = 0; index < points.length - 1; index++) {
      if (!insideFloor(points[index]) || !insideFloor(points[index + 1]))
        return failure(
          `Route segment ${index + 1} leaves the walkable office floor.`,
        )
      if (!clearSegment(points[index], points[index + 1]))
        return failure(
          `Route segment ${index + 1} intersects furniture clearance.`,
        )
    }
    return { ok: true }
  }

  const candidates: NavigationNode[] = [
    { id: 'hub:central', kind: 'hub', position: [0, 0, 3] },
    { id: 'entrance:front', kind: 'entrance', position: [0, 0, 17] },
    { id: 'meeting:open', kind: 'meeting', position: [0, 0, 10] },
    ...[-15, -6, 0, 15].map((z, index): NavigationNode => ({
      id: `corridor:${index}`,
      kind: 'corridor',
      position: [0, 0, z],
    })),
    ...layout.departments.map((zone): NavigationNode => ({
      id: `department:${zone.id}`,
      kind: 'department',
      // Arrival is at the open department entrance; visual zone centers can contain desks.
      position:
        zone.position[0] === 0
          ? [0, 0, zone.position[2] + zone.size[1] / 2 + 0.75]
          : [
              zone.position[0] -
                Math.sign(zone.position[0]) * (zone.size[0] / 2 + 0.75),
              0,
              zone.position[2],
            ],
    })),
    ...stations.map((station): NavigationNode => ({
      id: `workstation:${station.id}`,
      kind: 'workstation',
      position: standingWorkstationAnchor(station),
    })),
  ]
  rectangles.forEach((rectangle, shape) => {
    for (const [corner, [x, z]] of [
      [rectangle.minX - CORNER_MARGIN, rectangle.minZ - CORNER_MARGIN],
      [rectangle.minX - CORNER_MARGIN, rectangle.maxZ + CORNER_MARGIN],
      [rectangle.maxX + CORNER_MARGIN, rectangle.minZ - CORNER_MARGIN],
      [rectangle.maxX + CORNER_MARGIN, rectangle.maxZ + CORNER_MARGIN],
    ].entries())
      candidates.push({
        id: `waypoint:${rectangle.station.id}:${shape % FOOTPRINTS.length}:${corner}`,
        kind: 'waypoint',
        position: workstationAnchor(rectangle.station, [x, 0, z]),
      })
  })
  const nodes = Object.freeze(
    candidates
      .filter((node) => clearSegment(node.position, node.position))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) =>
        Object.freeze({
          ...node,
          position: Object.freeze(clonePoint(node.position)),
        }),
      ),
  )
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]))
  const adjacency = nodes.map(() => [] as { index: number; length: number }[])
  const edges: NavigationEdge[] = []
  for (let from = 0; from < nodes.length; from++)
    for (let to = from + 1; to < nodes.length; to++) {
      if (!clearSegment(nodes[from].position, nodes[to].position)) continue
      const length = distance(nodes[from].position, nodes[to].position)
      adjacency[from].push({ index: to, length })
      adjacency[to].push({ index: from, length })
      edges.push(
        Object.freeze({
          from: nodes[from].id,
          to: nodes[to].id,
          distanceMeters: length,
        }),
      )
    }

  function route(
    current: WorldPosition,
    destination: WorldPosition,
    destinationId: string | null,
    avoid?: WorldPosition,
  ): NavigationPlan {
    if (!clearSegment(current, current))
      return failure(
        'Current position is outside walkable ground or inside furniture clearance; seated actors must use their standing anchor.',
      )
    if (!clearSegment(destination, destination))
      return failure(
        'Destination is outside walkable ground or inside furniture clearance.',
      )
    const allowed = (a: WorldPosition, b: WorldPosition) =>
      !avoid || distanceToSegment(avoid, a, b) >= 0.55 - EPSILON
    const finish = (points: WorldPosition[]): NavigationPlan => ({
      ok: true,
      points,
      destination: { id: destinationId, position: clonePoint(destination) },
      distanceMeters: points
        .slice(1)
        .reduce(
          (total, point, index) => total + distance(points[index], point),
          0,
        ),
    })
    if (clearSegment(current, destination) && allowed(current, destination))
      return finish([clonePoint(current), clonePoint(destination)])
    const costs = nodes.map((node) =>
      clearSegment(current, node.position) && allowed(current, node.position)
        ? distance(current, node.position)
        : Infinity,
    )
    const previous = nodes.map(() => -1),
      visited = new Set<number>()
    let best = Infinity,
      endpoint = -1
    while (visited.size < nodes.length) {
      let next = -1,
        score = Infinity
      for (let index = 0; index < nodes.length; index++) {
        if (visited.has(index)) continue
        const estimate =
          costs[index] + distance(nodes[index].position, destination)
        if (estimate < score - EPSILON) {
          next = index
          score = estimate
        }
      }
      if (next < 0 || score >= best - EPSILON) break
      visited.add(next)
      const point = nodes[next].position
      if (clearSegment(point, destination) && allowed(point, destination)) {
        best = costs[next] + distance(point, destination)
        endpoint = next
      }
      for (const neighbor of adjacency[next]) {
        if (
          visited.has(neighbor.index) ||
          !allowed(point, nodes[neighbor.index].position)
        )
          continue
        const cost = costs[next] + neighbor.length
        if (cost < costs[neighbor.index] - EPSILON) {
          costs[neighbor.index] = cost
          previous[neighbor.index] = next
        }
      }
    }
    if (endpoint < 0)
      return failure(
        'No furniture-safe route connects this position to the destination.',
      )
    const reversed: WorldPosition[] = [clonePoint(destination)]
    for (let index = endpoint; index >= 0; index = previous[index])
      reversed.push(clonePoint(nodes[index].position))
    reversed.push(clonePoint(current))
    const points = reversed
      .reverse()
      .filter(
        (point, index, all) =>
          index === 0 || distance(point, all[index - 1]) > EPSILON,
      )
    return finish(
      points.length === 1 ? [points[0], clonePoint(points[0])] : points,
    )
  }

  function planNavigation(
    current: WorldPosition,
    destinationNodeId: string,
  ): NavigationPlan {
    const index = nodeIndex.get(destinationNodeId)
    if (index === undefined)
      return failure(
        `Unknown or obstructed navigation destination: ${destinationNodeId}.`,
      )
    return route(current, nodes[index].position, destinationNodeId)
  }

  function planApproach(
    current: WorldPosition,
    target: WorldPosition,
  ): NavigationPlan {
    if (!clearSegment(target, target))
      return failure('The target must be on walkable standing ground.')
    let best: Extract<NavigationPlan, { ok: true }> | undefined
    // Prefer conversational distance; widen the approach only when furniture prevents it.
    for (const radius of [0.85, 1.15]) {
      for (let direction = 0; direction < 8; direction++) {
        const angle = (direction * Math.PI) / 4
        const point: WorldPosition = [
          target[0] + Math.sin(angle) * radius,
          0,
          target[2] + Math.cos(angle) * radius,
        ]
        const result = route(current, point, null, target)
        if (
          result.ok &&
          (!best || result.distanceMeters < best.distanceMeters - EPSILON)
        )
          best = result
      }
      if (best) return best
    }
    return (
      best ??
      failure(
        'No clear standing approach is available without crossing the target or furniture.',
      )
    )
  }

  return Object.freeze({
    nodes,
    edges: Object.freeze(edges),
    bounds,
    clearanceMeters: clearance,
    planNavigation,
    planApproach,
    validatePath,
  })
}

export type OfficeNavigation = ReturnType<typeof createOfficeNavigation>
