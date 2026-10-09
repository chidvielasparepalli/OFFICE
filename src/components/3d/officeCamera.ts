import { MathUtils, Vector3 } from 'three'
import type { WorldPosition } from '../../office/officeState'

export const OFFICE_WIDTH = 24
export const OFFICE_DEPTH = 18
export const PROCEDURAL_BOUNDS = {
  width: OFFICE_WIDTH,
  depth: OFFICE_DEPTH,
  height: 2.8,
}
export type OfficeBounds = typeof PROCEDURAL_BOUNDS
export const CAMERA_FOV = 40
export const MIN_DISTANCE = 8
export const MAX_DISTANCE = 120
export const MIN_POLAR_ANGLE = Math.PI / 8
export const MAX_POLAR_ANGLE = Math.PI / 2.8
export const OPEN_MIN_DISTANCE = 5
export const OPEN_MIN_POLAR_ANGLE = Math.PI / 90
export const OPEN_MAX_POLAR_ANGLE = Math.PI / 3
export type CameraFocus = { target: WorldPosition; radius: number }

export function overviewPosition(
  aspect: number,
  bounds = PROCEDURAL_BOUNDS,
  openOffice = false,
) {
  const radius = Math.hypot(bounds.width / 2, bounds.depth / 2, bounds.height)
  return framePosition(aspect, { target: [0, 0, 0], radius }, openOffice)
}

export function framePosition(
  aspect: number,
  focus: CameraFocus,
  openOffice = true,
) {
  const verticalFov = MathUtils.degToRad(CAMERA_FOV)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
  const distance = Math.min(
    MAX_DISTANCE,
    Math.max(
      openOffice ? OPEN_MIN_DISTANCE : MIN_DISTANCE,
      (focus.radius * 1.08) /
        Math.sin(Math.min(verticalFov, horizontalFov) / 2),
    ),
  )
  const direction = openOffice
    ? new Vector3(20, 32, 24)
    : new Vector3(26, 30, 34)
  return direction
    .normalize()
    .multiplyScalar(distance)
    .add(new Vector3(...focus.target))
}

export function constrainPan(
  position: Vector3,
  target: Vector3,
  bounds = PROCEDURAL_BOUNDS,
) {
  const x = MathUtils.clamp(target.x, -bounds.width / 2, bounds.width / 2)
  const z = MathUtils.clamp(target.z, -bounds.depth / 2, bounds.depth / 2)
  // Move both ends equally so hitting the pan boundary preserves the view angle.
  position.x += x - target.x
  position.y -= target.y
  position.z += z - target.z
  target.set(x, 0, z)
}
