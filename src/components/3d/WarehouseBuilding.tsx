import { Component, Suspense } from 'react'
import type { ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { officeAssets } from '../../assets/officeAssets'
function OpenFloorFallback() {
  const { width, depth } = officeAssets.warehouse.layout
  return (
    <mesh name="open-fallback-floor" position={[0, -0.16, 0]}>
      <boxGeometry args={[width, 0.32, depth]} />
      <meshStandardMaterial color="#dbe4e1" roughness={0.95} />
    </mesh>
  )
}

class WarehouseLoadBoundary extends Component<
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
    if (this.state.failed) {
      return <OpenFloorFallback />
    }
    return this.props.children
  }
}

function WarehouseModel() {
  const { scene } = useGLTF(officeAssets.warehouse.previewUrl)
  // The cached scene has one owner; R3F must not dispose its shared resources.
  return <primitive object={scene} dispose={null} />
}

export function WarehouseBuilding({
  onUnavailable,
}: {
  onUnavailable: () => void
}) {
  if (!import.meta.env.DEV && !officeAssets.warehouse.productionUrl)
    return <OpenFloorFallback />
  return (
    <WarehouseLoadBoundary onUnavailable={onUnavailable}>
      <Suspense fallback={<OpenFloorFallback />}>
        <WarehouseModel />
      </Suspense>
    </WarehouseLoadBoundary>
  )
}
