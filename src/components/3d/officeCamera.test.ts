import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { officeAssets } from '../../assets/officeAssets'
import warehouse from '../../../assets/warehouse/conversion.json'
import {
  CAMERA_FOV,
  OFFICE_WIDTH,
  OFFICE_DEPTH,
  MIN_DISTANCE,
  MAX_DISTANCE,
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
  constrainPan,
  overviewPosition,
  framePosition,
} from './officeCamera'

describe('office camera', () => {
  it.each([0.65, 1, 2])(
    'frames a standing worker and workstation at aspect %s',
    (aspect) => {
      for (const radius of [5.5, 2.5]) {
        const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 250)
        camera.position.copy(
          framePosition(aspect, { target: [-11, 0, 0], radius }),
        )
        camera.lookAt(-11, 0, 0)
        camera.updateMatrixWorld()
        for (const x of [-12, -10])
          for (const y of [0, 2.1])
            for (const z of [-0.6, 0.6]) {
              const point = new Vector3(x, y, z).project(camera)
              expect(Math.abs(point.x)).toBeLessThan(1)
              expect(Math.abs(point.y)).toBeLessThan(1)
            }
      }
    },
  )
  it.each([0.65, 0.9, 1, 1.8, 3])(
    'frames the measured warehouse at aspect %s',
    (aspect) => {
      const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 250)
      camera.position.copy(
        overviewPosition(aspect, officeAssets.warehouse.bounds, true),
      )
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      for (const x of warehouse.bounds.map((point) => point[0])) {
        for (const y of warehouse.bounds.map((point) => point[1])) {
          for (const z of warehouse.bounds.map((point) => point[2])) {
            const projected = new Vector3(x, y, z).project(camera)
            expect(Math.abs(projected.x)).toBeLessThan(1)
            expect(Math.abs(projected.y)).toBeLessThan(1)
            expect(Math.abs(projected.z)).toBeLessThan(1)
          }
        }
      }
    },
  )

  it('uses the imported foundation bounds when panning', () => {
    const bounds = officeAssets.warehouse.bounds
    const target = new Vector3(100, 3, -100)
    const position = target.clone().add(new Vector3(10, 20, 30))
    constrainPan(position, target, bounds)
    expect(target.toArray()).toEqual([bounds.width / 2, 0, -bounds.depth / 2])
    expect(position.clone().sub(target).toArray()).toEqual([10, 20, 30])
  })

  it.each([0.65, 0.9, 1, 1.8, 3])(
    'frames the whole shell at aspect %s',
    (aspect) => {
      const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 250)
      camera.position.copy(overviewPosition(aspect))
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      expect(camera.position.length()).toBeGreaterThan(MIN_DISTANCE)
      expect(camera.position.length()).toBeLessThanOrEqual(MAX_DISTANCE)
      const polar = Math.acos(camera.position.y / camera.position.length())
      expect(polar).toBeGreaterThan(MIN_POLAR_ANGLE)
      expect(polar).toBeLessThan(MAX_POLAR_ANGLE)
      for (const x of [-OFFICE_WIDTH / 2, OFFICE_WIDTH / 2]) {
        for (const y of [-0.3, 2.8]) {
          for (const z of [-OFFICE_DEPTH / 2, OFFICE_DEPTH / 2]) {
            const projected = new Vector3(x, y, z).project(camera)
            expect(Math.abs(projected.x)).toBeLessThan(1)
            expect(Math.abs(projected.y)).toBeLessThan(1)
            expect(Math.abs(projected.z)).toBeLessThan(1)
          }
        }
      }
    },
  )

  it.each([-1, 1])(
    'bounds panning in direction %s without changing viewing distance or angle',
    (sign) => {
      const target = new Vector3(sign * 100, 4, sign * 100)
      const position = target.clone().add(new Vector3(10, 20, 30))
      const offset = position.clone().sub(target)
      constrainPan(position, target)
      expect(target.toArray()).toEqual([sign * 12, 0, sign * 9])
      expect(position.clone().sub(target).toArray()).toEqual(offset.toArray())
    },
  )

  it('leaves an in-bounds view unchanged', () => {
    const target = new Vector3(3, 0, -4)
    const position = new Vector3(12, 20, 30)
    constrainPan(position, target)
    expect(position.toArray()).toEqual([12, 20, 30])
    expect(target.toArray()).toEqual([3, 0, -4])
  })
})
