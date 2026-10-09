import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import type { AnimationClip, Group } from 'three'
import { CharacterAnimationPlayer } from '../../office/characterAnimation'
import { createCharacterMotion } from '../../office/characterMotion'
import type {
  AgentSpatialSnapshot,
  OfficeSelectionHandler,
} from '../../office/officeState'
import type { AgentPlacement } from '../../office/workerPresentation'
import { RedHeadbandAsset } from '../../assets/officeAssets'

export interface CharacterView {
  position: Vector3
  head: Vector3
  chairOffsetZ: number
}

interface CharacterProps {
  worker: AgentPlacement
  views: RefObject<Map<string, CharacterView>>
  selectedId: string | null
  onSelect: OfficeSelectionHandler
  spatialViews?: RefObject<Map<string, AgentSpatialSnapshot>>
  onSpatialEvent?: (snapshot: AgentSpatialSnapshot) => void
}

function Character({
  scene,
  clips,
  headband,
  worker,
  views,
  selectedId,
  onSelect,
  spatialViews,
  onSpatialEvent,
}: CharacterProps & {
  scene: Group
  clips: AnimationClip[]
  headband?: Group
}) {
  const root = useRef<Group>(null)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const [visibility] = useState(() => ({
    frustum: new Frustum(),
    projection: new Matrix4(),
    bounds: new Sphere(new Vector3(), 2),
  }))
  const [motion] = useState(() => createCharacterMotion(worker))
  const [actor] = useState(
    () =>
      new CharacterAnimationPlayer(
        scene,
        clips,
        worker.kind === 'standard-worker' && headband
          ? { scene: headband, scale: RedHeadbandAsset.fits.worker.scale }
          : undefined,
      ),
  )
  const view = useRef<CharacterView>({
    position: new Vector3(),
    head: new Vector3(),
    chairOffsetZ: 0,
  })
  const spatial = useRef<AgentSpatialSnapshot>({
    agentId: worker.id,
    position: worker.position,
    headingRadians: worker.headingRadians,
    workstation: worker.workstation ?? null,
    destination: null,
    movementState: 'stationary',
    speedMetersPerSecond: 0,
    pathProgress: null,
    collaborationTargetId: worker.collaborationTargetId ?? null,
    phase: 'standing',
    diagnostic: null,
    motionId: null,
    completedMotionId: null,
  })
  const eventKey = useRef('')
  const mounted = useRef(false)
  const destination = useMemo(
    () =>
      worker.motion
        ? (worker.motion.destination ?? {
            id: null,
            position:
              worker.motion.points[worker.motion.points.length - 1] ??
              worker.position,
          })
        : null,
    [worker.motion, worker.position],
  )
  const eventHandler = useRef(onSpatialEvent)
  useLayoutEffect(() => {
    eventHandler.current = onSpatialEvent
  }, [onSpatialEvent])

  const applyPose = useCallback(
    (delta: number, force = false) => {
      const group = root.current
      if (!group) return
      const frame = motion.advance(delta)
      group.position.set(...frame.position)
      group.rotation.y = frame.headingRadians
      Object.assign(group.userData, {
        agentId: worker.id,
        kind: worker.kind,
        clip: frame.clip,
        phase: frame.phase,
        paused: frame.paused,
        diagnostic: worker.navigationDiagnostic ?? frame.diagnostic,
        motionId: frame.motionId,
        completedMotionId: frame.completedMotionId,
        pathProgress: frame.pathProgress,
        headbandProgress: frame.headbandProgress,
        headbandVisible: frame.headbandVisible,
        workingHard: frame.workingHard,
      })
      const time =
        frame.clipTimeSeconds *
        (frame.clip === 'walk' ? frame.walkingSpeedMetersPerSecond / 0.76 : 1)
      const selected = selectedId === worker.id
      let visible = force || selected
      if (!visible) {
        // Reuse a conservative envelope; never CPU-skin vertices to measure bounds.
        visibility.bounds.center.set(
          group.position.x + Math.sin(frame.headingRadians) * 0.2,
          group.position.y + 0.9,
          group.position.z + Math.cos(frame.headingRadians) * 0.2,
        )
        visibility.frustum.setFromProjectionMatrix(
          visibility.projection.multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse,
          ),
          camera.coordinateSystem,
        )
        visible = visibility.frustum.intersectsSphere(visibility.bounds)
      }
      const blending = actor.update(
        frame.clip,
        time,
        delta,
        frame.paused,
        frame.active,
        selected,
        force,
        visible,
      )
      actor.setHeadbandVisible(frame.headbandVisible)
      group.updateMatrixWorld(true)
      view.current.position.copy(group.position)
      view.current.chairOffsetZ = frame.chairOffsetZ
      actor.head.getWorldPosition(view.current.head)
      view.current.head.y += worker.kind === 'manager' ? 0.3 : 0.38
      const state = spatial.current
      state.position = frame.position
      state.headingRadians = frame.headingRadians
      state.workstation = worker.workstation ?? null
      state.destination = destination
      state.movementState = frame.paused
        ? 'paused'
        : frame.phase === 'turning'
          ? 'turning'
          : frame.moving
            ? 'moving'
            : 'stationary'
      state.speedMetersPerSecond = frame.paused
        ? 0
        : frame.walkingSpeedMetersPerSecond
      state.pathProgress = frame.pathProgress
      state.collaborationTargetId = worker.collaborationTargetId ?? null
      state.phase = frame.phase
      state.diagnostic = worker.navigationDiagnostic ?? frame.diagnostic
      state.motionId = frame.motionId
      state.completedMotionId = frame.completedMotionId
      const nextKey = `${worker.status}:${state.phase}:${state.movementState}:${state.motionId}:${state.completedMotionId}:${state.diagnostic}`
      if (eventKey.current !== nextKey) {
        eventKey.current = nextKey
        const snapshot = { ...state, position: [...state.position] as const }
        // Discrete presentation events leave the render/commit stack; no per-frame React updates.
        queueMicrotask(() => {
          if (mounted.current) eventHandler.current?.(snapshot)
        })
      }
      if (frame.active || blending) invalidate()
    },
    [
      actor,
      camera,
      destination,
      invalidate,
      motion,
      selectedId,
      view,
      visibility,
      worker,
    ],
  )

  useLayoutEffect(() => {
    actor.start()
    mounted.current = true
    const currentViews = views.current
    currentViews.set(worker.id, view.current)
    const currentSpatialViews = spatialViews?.current
    currentSpatialViews?.set(worker.id, spatial.current)
    return () => {
      mounted.current = false
      currentViews.delete(worker.id)
      currentSpatialViews?.delete(worker.id)
      actor.stop()
    }
  }, [actor, spatialViews, view, views, worker.id])
  useLayoutEffect(() => {
    motion.update(worker)
    applyPose(0, true)
    invalidate()
  }, [worker, applyPose, motion, invalidate])
  useFrame((_, delta) => applyPose(Math.min(delta, 0.1)), -1)

  return (
    <group
      ref={root}
      name={`character-${worker.id}`}
      dispose={null}
      onClick={(event) => {
        if (event.delta > 5) return
        event.stopPropagation()
        onSelect({ kind: 'agent', id: worker.id })
      }}
    >
      <primitive object={actor.model} dispose={null} />
      {selectedId === worker.id && (
        <mesh
          name="selected-agent-ring"
          position={[0, 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => {}}
        >
          <ringGeometry args={[0.49, 0.56, 48]} />
          <meshBasicMaterial color="#167bb9" depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function WorkerCharacter(
  props: CharacterProps & { scene: Group; clips: AnimationClip[] },
) {
  const { scene: headband } = useGLTF(RedHeadbandAsset.productionUrl)
  return <Character {...props} headband={headband} />
}

export function AnimatedCharacters({
  url,
  workers,
  ...props
}: Omit<CharacterProps, 'worker'> & {
  url: string
  workers: readonly AgentPlacement[]
}) {
  const { scene, animations } = useGLTF(url)
  return workers.map((worker) => {
    // A Manager never mounts the accessory loader or receives an attachment.
    const Component =
      worker.kind === 'standard-worker' ? WorkerCharacter : Character
    return (
      <Component
        key={`${url}-${worker.id}`}
        scene={scene}
        clips={animations}
        worker={worker}
        {...props}
      />
    )
  })
}
