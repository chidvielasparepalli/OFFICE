import type { AgentMotion, WorldPosition } from './officeState'

const distance = (a: WorldPosition, b: WorldPosition) =>
  Math.hypot(a[0] - b[0], a[2] - b[2])
const validPoint = (point: WorldPosition) =>
  Array.isArray(point) &&
  point.length === 3 &&
  point.every(Number.isFinite) &&
  point[1] === 0

/** Retrace an accepted desk route; never connect an unknown location through furniture. */
export function reverseAcceptedWorkstationRoute(
  position: WorldPosition,
  standingAnchor: WorldPosition,
  accepted: Readonly<AgentMotion> | undefined,
  id: string,
): AgentMotion | null {
  if (
    !accepted ||
    !id ||
    !validPoint(position) ||
    !validPoint(standingAnchor) ||
    !Array.isArray(accepted.points) ||
    accepted.points.length < 2 ||
    accepted.points.length > 1024 ||
    !accepted.points.every(validPoint) ||
    !Number.isFinite(accepted.speedMetersPerSecond) ||
    accepted.speedMetersPerSecond <= 0 ||
    accepted.speedMetersPerSecond > 3 ||
    distance(position, standingAnchor) <= 0.01
  )
    return null

  const points: WorldPosition[] = accepted.points.map((point) => [
    point[0],
    point[1],
    point[2],
  ])
  if (distance(points[0], standingAnchor) <= 0.01) points.reverse()
  else if (distance(points.at(-1)!, standingAnchor) > 0.01) return null

  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index],
      to = points[index + 1]
    const x = to[0] - from[0],
      z = to[2] - from[2]
    const lengthSquared = x * x + z * z
    const progress = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((position[0] - from[0]) * x + (position[2] - from[2]) * z) /
              lengthSquared,
          ),
        )
      : 0
    if (
      distance(position, [from[0] + x * progress, 0, from[2] + z * progress]) >
      0.01
    )
      continue
    return {
      id,
      points: [[position[0], 0, position[2]], ...points.slice(index + 1)],
      speedMetersPerSecond: accepted.speedMetersPerSecond,
    }
  }
  return null
}
