import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { MathUtils, PerspectiveCamera } from 'three'
import gsap from 'gsap'
import {
  MIN_DISTANCE,
  MAX_DISTANCE,
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
  constrainPan,
  overviewPosition,
  PROCEDURAL_BOUNDS,
  type OfficeBounds,
  framePosition,
  type CameraFocus,
  OPEN_MIN_DISTANCE,
  OPEN_MIN_POLAR_ANGLE,
  OPEN_MAX_POLAR_ANGLE,
} from './officeCamera'

export function CameraController({
  resetVersion,
  bounds = PROCEDURAL_BOUNDS,
  focus = null,
  openOffice = false,
}: {
  resetVersion: number
  bounds?: OfficeBounds
  focus?: CameraFocus | null
  openOffice?: boolean
}) {
  const { camera, gl, size, invalidate } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const zoomTargetRef = useRef<number | null>(null)
  const previousResetRef = useRef(resetVersion)
  const previousFocusRef = useRef(focus)
  const minimumDistance = openOffice ? OPEN_MIN_DISTANCE : MIN_DISTANCE

  // Drei updates controls at priority -1; clamp even the last sub-threshold drift.
  useFrame(() => {
    const controls = controlsRef.current
    if (controls) constrainPan(camera.position, controls.target, bounds)
  })

  function stopTransition() {
    tweenRef.current?.kill()
    zoomTargetRef.current = null
  }

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || !(camera instanceof PerspectiveCamera)) return
    stopTransition()
    // Flush leftover drag inertia before GSAP takes over the same camera.
    controls.enableDamping = false
    controls.update()
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    controls.enableDamping = !reducedMotion
    const destination = focus
      ? framePosition(size.width / size.height, focus, openOffice)
      : overviewPosition(size.width / size.height, bounds, openOffice)
    const animate =
      (previousResetRef.current !== resetVersion ||
        previousFocusRef.current !== focus) &&
      !reducedMotion
    previousResetRef.current = resetVersion
    previousFocusRef.current = focus
    const view = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      tx: controls.target.x,
      tz: controls.target.z,
    }
    tweenRef.current = gsap.to(view, {
      x: destination.x,
      y: destination.y,
      z: destination.z,
      tx: focus?.target[0] ?? 0,
      tz: focus?.target[2] ?? 0,
      duration: animate ? 0.8 : 0,
      ease: 'power3.out',
      onUpdate: () => {
        camera.position.set(view.x, view.y, view.z)
        controls.target.set(view.tx, 0, view.tz)
        controls.update()
        invalidate()
      },
    })
    return stopTransition
  }, [
    camera,
    size.width,
    size.height,
    resetVersion,
    invalidate,
    bounds,
    focus,
    openOffice,
  ])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => {
      stopTransition()
      controls.enableDamping = !motion.matches
      controls.update()
      invalidate()
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      // Intercept wheel only; OrbitControls still owns pinch, pan and orbit.
      event.stopImmediatePropagation()
      tweenRef.current?.kill()
      const distance = camera.position.distanceTo(controls.target)
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1)
      const destination = MathUtils.clamp(
        (zoomTargetRef.current ?? distance) *
          Math.exp(MathUtils.clamp(delta, -100, 100) * 0.002),
        minimumDistance,
        MAX_DISTANCE,
      )
      zoomTargetRef.current = destination
      const zoom = { distance }
      tweenRef.current = gsap.to(zoom, {
        distance: destination,
        duration: motion.matches ? 0 : 0.25,
        ease: 'power2.out',
        onUpdate: () => {
          camera.position
            .sub(controls.target)
            .setLength(zoom.distance)
            .add(controls.target)
          controls.update()
          invalidate()
        },
        onComplete: () => {
          zoomTargetRef.current = null
        },
      })
    }
    motion.addEventListener('change', updateMotion)
    gl.domElement.addEventListener('wheel', wheel, {
      capture: true,
      passive: false,
    })
    return () => {
      motion.removeEventListener('change', updateMotion)
      gl.domElement.removeEventListener('wheel', wheel, true)
      stopTransition()
    }
  }, [camera, gl, invalidate, size.height, minimumDistance])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning={false}
      minDistance={minimumDistance}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={openOffice ? OPEN_MIN_POLAR_ANGLE : MIN_POLAR_ANGLE}
      maxPolarAngle={openOffice ? OPEN_MAX_POLAR_ANGLE : MAX_POLAR_ANGLE}
      onStart={stopTransition}
    />
  )
}
