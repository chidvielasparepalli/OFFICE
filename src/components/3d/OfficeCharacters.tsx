import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { InstancedMesh, Matrix4, Mesh, Object3D, Vector3 } from 'three'
import {
  StandardWorkerAsset,
  WorkstationAsset,
  ManagerAsset,
} from '../../assets/officeAssets'
import type {
  AgentSpatialSnapshot,
  OfficeSelectionHandler,
} from '../../office/officeState'
import { workerAtInstance } from '../../office/workerPresentation'
import type { AgentPlacement } from '../../office/workerPresentation'
import { AnimatedCharacters } from './AnimatedCharacter'
import type { CharacterView } from './AnimatedCharacter'

const workerUrl = import.meta.env.DEV
  ? StandardWorkerAsset.previewUrl
  : StandardWorkerAsset.productionUrl
const workstationUrl = import.meta.env.DEV
  ? WorkstationAsset.previewUrl
  : WorkstationAsset.productionUrl
const managerUrl = import.meta.env.DEV
  ? ManagerAsset.previewUrl
  : ManagerAsset.productionUrl

function InstancePart({
  part,
  workers,
  name,
  onSelect,
  views,
}: {
  part: Mesh
  workers: readonly AgentPlacement[]
  name: string
  onSelect?: OfficeSelectionHandler
  views?: RefObject<Map<string, CharacterView>>
}) {
  const ref = useRef<InstancedMesh>(null)
  const chairOffsets = useRef<number[]>([])
  const pose = useRef(new Object3D())
  const matrix = useRef(new Matrix4())
  const invalidate = useThree((state) => state.invalidate)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    workers.forEach((worker, index) => {
      const offset =
        part.name === 'CHAIR'
          ? (views?.current.get(worker.id)?.chairOffsetZ ?? 0)
          : 0
      chairOffsets.current[index] = offset
      pose.current.position.set(...worker.position)
      pose.current.position.x += Math.sin(worker.headingRadians) * offset
      pose.current.position.z += Math.cos(worker.headingRadians) * offset
      pose.current.rotation.set(0, worker.headingRadians, 0)
      pose.current.updateMatrix()
      mesh.setMatrixAt(
        index,
        matrix.current.multiplyMatrices(pose.current.matrix, part.matrixWorld),
      )
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    if (part.name === 'CHAIR') {
      mesh.boundingBox?.expandByScalar(0.5)
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.5
    }
    invalidate()
  }, [workers, part, views, invalidate])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh || part.name !== 'CHAIR') return
    let changed = false
    workers.forEach((worker, index) => {
      const offset = views?.current.get(worker.id)?.chairOffsetZ ?? 0
      if (offset === chairOffsets.current[index]) return
      chairOffsets.current[index] = offset
      pose.current.position.set(...worker.position)
      pose.current.position.x += Math.sin(worker.headingRadians) * offset
      pose.current.position.z += Math.cos(worker.headingRadians) * offset
      pose.current.rotation.set(0, worker.headingRadians, 0)
      pose.current.updateMatrix()
      mesh.setMatrixAt(
        index,
        matrix.current.multiplyMatrices(pose.current.matrix, part.matrixWorld),
      )
      changed = true
    })
    if (changed) mesh.instanceMatrix.needsUpdate = true
  }, -0.5)
  useEffect(() => {
    const mesh = ref.current
    // Only instance buffers are owned here; cached geometry/materials stay shared.
    return () => mesh?.dispose()
  }, [])
  return (
    <instancedMesh
      ref={ref}
      name={name}
      args={[part.geometry, part.material, workers.length]}
      dispose={null}
      onClick={
        onSelect
          ? (event) => {
              if (event.delta > 5) return
              const worker = workerAtInstance(workers, event.instanceId)
              if (worker) {
                event.stopPropagation()
                onSelect({ kind: 'agent', id: worker.id })
              }
            }
          : undefined
      }
      userData={{ workerIds: workers.map((worker) => worker.id) }}
    />
  )
}

function SharedAsset({
  url,
  workers,
  name,
  onSelect,
  views,
}: {
  url: string
  workers: readonly AgentPlacement[]
  name: string
  onSelect?: OfficeSelectionHandler
  views?: RefObject<Map<string, CharacterView>>
}) {
  const { scene } = useGLTF(url)
  const parts = useMemo(() => {
    scene.updateMatrixWorld(true)
    const meshes: Mesh[] = []
    scene.traverse((object) => {
      if (object instanceof Mesh) meshes.push(object)
    })
    return meshes
  }, [scene])
  return (
    <group name={name} dispose={null}>
      {parts.map((part) => (
        <InstancePart
          key={`${part.uuid}-${workers.length}`}
          part={part}
          workers={workers}
          name={`${name}-${part.name}`}
          onSelect={onSelect}
          views={views}
        />
      ))}
    </group>
  )
}

class AssetLoadBoundary extends Component<
  { children: ReactNode; onUnavailable: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onUnavailable()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function AssetBatch({
  url,
  workers,
  name,
  onSelect,
  onUnavailable,
  views,
  selectedId = null,
  spatialViews,
  onSpatialEvent,
}: {
  url: string | null
  workers: readonly AgentPlacement[]
  name: string
  onSelect?: OfficeSelectionHandler
  onUnavailable: () => void
  views?: RefObject<Map<string, CharacterView>>
  selectedId?: string | null
  spatialViews?: RefObject<Map<string, AgentSpatialSnapshot>>
  onSpatialEvent?: (snapshot: AgentSpatialSnapshot) => void
}) {
  if (!url || workers.length === 0) return null
  return (
    <AssetLoadBoundary onUnavailable={onUnavailable}>
      <Suspense fallback={null}>
        {views && onSelect ? (
          <AnimatedCharacters
            url={url}
            workers={workers}
            views={views}
            selectedId={selectedId}
            onSelect={onSelect}
            spatialViews={spatialViews}
            onSpatialEvent={onSpatialEvent}
          />
        ) : (
          <SharedAsset
            url={url}
            workers={workers}
            name={name}
            onSelect={onSelect}
            views={views}
          />
        )}
      </Suspense>
    </AssetLoadBoundary>
  )
}

export function OfficeCharacters({
  workers,
  onSelect,
  onUnavailable,
  views,
  selectedId,
  spatialViews,
  onSpatialEvent,
}: {
  workers: readonly AgentPlacement[]
  onSelect: OfficeSelectionHandler
  onUnavailable: (kind: AgentPlacement['kind'] | 'workstation') => void
  views: RefObject<Map<string, CharacterView>>
  selectedId: string | null
  spatialViews: RefObject<Map<string, AgentSpatialSnapshot>>
  onSpatialEvent: (snapshot: AgentSpatialSnapshot) => void
}) {
  const standard = useMemo(
    () => workers.filter((agent) => agent.kind === 'standard-worker'),
    [workers],
  )
  const managers = useMemo(
    () => workers.filter((agent) => agent.kind === 'manager'),
    [workers],
  )
  const desks = useMemo(
    () =>
      workers.flatMap((worker) =>
        worker.workstation ? [{ ...worker, ...worker.workstation }] : [],
      ),
    [workers],
  )
  return (
    <>
      <AssetBatch
        url={workerUrl}
        workers={standard}
        name="standard-workers"
        spatialViews={spatialViews}
        onSpatialEvent={onSpatialEvent}
        views={views}
        selectedId={selectedId}
        onSelect={onSelect}
        onUnavailable={() => onUnavailable('standard-worker')}
      />
      <AssetBatch
        url={managerUrl}
        workers={managers}
        name="primary-manager"
        spatialViews={spatialViews}
        onSpatialEvent={onSpatialEvent}
        views={views}
        selectedId={selectedId}
        onSelect={onSelect}
        onUnavailable={() => onUnavailable('manager')}
      />
      <AssetBatch
        url={workstationUrl}
        workers={desks}
        name="shared-workstations"
        views={views}
        onUnavailable={() => onUnavailable('workstation')}
      />
    </>
  )
}

export function WorkerMarkerProjection({
  workers,
  labels,
  views,
}: {
  workers: readonly AgentPlacement[]
  labels: RefObject<Map<string, HTMLButtonElement>>
  views: RefObject<Map<string, CharacterView>>
}) {
  const point = useRef(new Vector3())
  const headCenter = useRef(new Vector3())
  const headEdge = useRef(new Vector3())
  const cameraRight = useRef(new Vector3())
  useFrame(({ camera, size }) => {
    const occupied: { x: number; y: number }[] = []
    const heads: { x: number; y: number; radius: number }[] = []
    cameraRight.current.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    for (const worker of workers) {
      const view = views.current.get(worker.id)
      if (!view) continue
      const center = headCenter.current.copy(view.head)
      center.y -= 0.2
      const projected = point.current.copy(center).project(camera)
      if (Math.abs(projected.z) > 1) continue
      const edge = headEdge.current
        .copy(center)
        .addScaledVector(
          cameraRight.current,
          worker.kind === 'manager' ? 0.16 : 0.2,
        )
        .project(camera)
      heads.push({
        x: ((projected.x + 1) * size.width) / 2,
        y: ((1 - projected.y) * size.height) / 2,
        radius: Math.hypot(
          ((edge.x - projected.x) * size.width) / 2,
          ((edge.y - projected.y) * size.height) / 2,
        ),
      })
    }
    workers.forEach((worker) => {
      const label = labels.current.get(worker.id)
      if (!label) return
      const view = views.current.get(worker.id)
      const p = point.current
      if (view) p.copy(view.head)
      else
        p.set(
          worker.position[0],
          worker.kind === 'manager' ? 1.9 : 1.85,
          worker.position[2],
        )
      p.project(camera)
      label.hidden = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1
      if (label.hidden) return
      const headX = ((p.x + 1) * size.width) / 2
      const headY = ((1 - p.y) * size.height) / 2
      let x = headX,
        y = headY - 20
      let placed = false
      // Keep model heads clickable as well as separating their screen-space markers.
      search: for (let ring = 0; ring <= 12; ring++) {
        for (let step = 0; step < (ring === 0 ? 1 : 8); step++) {
          const angle = (step * Math.PI) / 4
          const nextX = headX + Math.cos(angle) * ring * 26
          const nextY = headY - 20 + Math.sin(angle) * ring * 26
          if (
            nextX < 12 ||
            nextX > size.width - 12 ||
            nextY < 12 ||
            nextY > size.height - 12 ||
            heads.some(
              (head) =>
                Math.hypot(head.x - nextX, head.y - nextY) < head.radius + 13,
            )
          )
            continue
          if (
            occupied.every(
              (other) => Math.hypot(other.x - nextX, other.y - nextY) >= 25,
            )
          ) {
            x = nextX
            y = nextY
            placed = true
            break search
          }
        }
      }
      if (!placed) {
        label.hidden = true
        return
      }
      occupied.push({ x, y })
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      label.style.setProperty(
        '--leader-length',
        `${Math.hypot(headX - x, headY - y)}px`,
      )
      label.style.setProperty(
        '--leader-angle',
        `${Math.atan2(headY - y, headX - x)}rad`,
      )
    })
  }, 0)
  return null
}
