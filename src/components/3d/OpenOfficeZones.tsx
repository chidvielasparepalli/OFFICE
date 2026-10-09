import { useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { officeAssets } from '../../assets/officeAssets'
import type {
  OfficeSelection,
  OfficeSelectionHandler,
} from '../../office/officeState'

export function OpenOfficeZones({
  selection,
  onSelect,
  labels,
}: {
  selection: OfficeSelection
  onSelect: OfficeSelectionHandler
  labels: RefObject<Map<string, HTMLButtonElement>>
}) {
  const projected = useRef(new Vector3())
  // Keep labels in the main React root; update only DOM transforms during camera motion.
  useFrame(({ camera, size }) => {
    for (const zone of officeAssets.warehouse.layout.departments) {
      const label = labels.current.get(zone.id)
      if (!label) continue
      const p = projected.current
        .set(zone.position[0], 0.06, zone.position[2] + zone.size[1] / 2 + 1.2)
        .project(camera)
      label.hidden = Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1
      label.style.transform = `translate(${((p.x + 1) * size.width) / 2}px, ${((1 - p.y) * size.height) / 2}px) translate(-50%, -50%)`
    }
  })
  return (
    <group name="open-department-zones">
      {officeAssets.warehouse.layout.departments.map((zone) => {
        const selected =
          selection.kind === 'department' && selection.id === zone.id
        return (
          <group
            key={zone.id}
            name={`ZONE_${zone.id}`}
            position={[zone.position[0], 0, zone.position[2]]}
          >
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.001, 0]}
              onClick={(event) => {
                if (event.delta > 5) return
                event.stopPropagation()
                onSelect({ kind: 'department', id: zone.id })
              }}
            >
              <planeGeometry args={[zone.size[0], zone.size[1]]} />
              <meshBasicMaterial
                color={zone.color}
                transparent
                opacity={selected ? 0.75 : 0.32}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-2}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
