import { OFFICE_DEPTH, OFFICE_WIDTH } from './officeCamera'

export function OfficeBuilding() {
  return (
    <group name="office-building">
      <mesh name="office-floor" position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[OFFICE_WIDTH, 0.3, OFFICE_DEPTH]} />
        <meshStandardMaterial color="#e5e9ec" roughness={0.9} />
      </mesh>
      <mesh
        name="north-wall"
        position={[0, 1.4, -8.9]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[OFFICE_WIDTH, 2.8, 0.2]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.85} />
      </mesh>
      <mesh
        name="west-wall"
        position={[-11.9, 1.4, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0.2, 2.8, OFFICE_DEPTH]} />
        <meshStandardMaterial color="#d1dbe3" roughness={0.85} />
      </mesh>
      <mesh name="east-cutaway" position={[11.9, 0.15, 0]} castShadow>
        <boxGeometry args={[0.2, 0.3, OFFICE_DEPTH]} />
        <meshStandardMaterial color="#b5c4d0" roughness={0.85} />
      </mesh>
      {[-7, 7].map((x) => (
        <mesh
          key={x}
          name={`south-cutaway-${x}`}
          position={[x, 0.15, 8.9]}
          castShadow
        >
          <boxGeometry args={[10, 0.3, 0.2]} />
          <meshStandardMaterial color="#b5c4d0" roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}
