export function OfficeLighting() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#9aaebb', 2]} />
      <directionalLight
        position={[8, 18, 12]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-normalBias={0.03}
      />
    </>
  )
}
