import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { OfficeAgent } from '../../types';

interface AgentCharacterProps {
  agent: OfficeAgent;
  isSelected: boolean;
  onSelect: () => void;
}

export const AgentCharacter: React.FC<AgentCharacterProps> = ({
  agent,
  isSelected,
  onSelect
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  const [hovered, setHovered] = useState(false);

  // Procedural animation loop per frame
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();

    const isWorking = agent.status === 'WORKING';
    const isSleeping = agent.status === 'SLEEPING';
    const isWalking = agent.status === 'WALKING';
    const isCollaborating = agent.status === 'COLLABORATING';

    // 1. Sitting / Working Pose
    if (isWorking) {
      // Subtle spinal breathing
      if (torsoRef.current) {
        torsoRef.current.position.y = 0.55 + Math.sin(time * 3) * 0.008;
      }
      // Arm typing oscillation (alternating tapping)
      if (leftArmRef.current) {
        leftArmRef.current.rotation.x = -1.1 + Math.sin(time * 12 + agent.deskIndex) * 0.08;
        leftArmRef.current.rotation.z = 0.35 + Math.cos(time * 8) * 0.03;
      }
      if (rightArmRef.current) {
        rightArmRef.current.rotation.x = -1.1 + Math.sin(time * 12 + agent.deskIndex + Math.PI) * 0.08;
        rightArmRef.current.rotation.z = -0.35 - Math.cos(time * 8) * 0.03;
      }
      // Head looking attentively at screen
      if (headRef.current) {
        headRef.current.rotation.x = 0.15 + Math.sin(time * 2 + agent.deskIndex) * 0.03;
        headRef.current.rotation.y = Math.sin(time * 1.5) * 0.04;
      }
      // Seated legs
      if (leftLegRef.current) leftLegRef.current.rotation.x = -Math.PI / 2;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.PI / 2;
    } 
    // 2. Sleeping / Idle Pose
    else if (isSleeping) {
      if (torsoRef.current) {
        torsoRef.current.position.y = 0.53 + Math.sin(time * 1.2) * 0.005;
      }
      // Arms resting on desk
      if (leftArmRef.current) {
        leftArmRef.current.rotation.x = -0.8;
        leftArmRef.current.rotation.z = 0.2;
      }
      if (rightArmRef.current) {
        rightArmRef.current.rotation.x = -0.8;
        rightArmRef.current.rotation.z = -0.2;
      }
      // Head slumped slightly downward
      if (headRef.current) {
        headRef.current.rotation.x = 0.32 + Math.sin(time * 1.2) * 0.02;
        headRef.current.rotation.y = 0;
      }
      if (leftLegRef.current) leftLegRef.current.rotation.x = -Math.PI / 2;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.PI / 2;
    }
    // 3. Walking Pose
    else if (isWalking) {
      const walkCycle = Math.sin(time * 8) * 0.55;
      if (leftLegRef.current) leftLegRef.current.rotation.x = walkCycle;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -walkCycle;

      if (leftArmRef.current) leftArmRef.current.rotation.x = -walkCycle * 0.8;
      if (rightArmRef.current) rightArmRef.current.rotation.x = walkCycle * 0.8;

      if (torsoRef.current) {
        torsoRef.current.position.y = 0.58 + Math.abs(Math.sin(time * 16)) * 0.03;
      }
    }
    // 4. Collaborating Pose
    else if (isCollaborating) {
      if (leftArmRef.current) {
        leftArmRef.current.rotation.x = -1.3 + Math.sin(time * 4) * 0.2;
        leftArmRef.current.rotation.z = 0.4;
      }
      if (rightArmRef.current) {
        rightArmRef.current.rotation.x = -0.6 + Math.cos(time * 3) * 0.15;
        rightArmRef.current.rotation.z = -0.3;
      }
      if (headRef.current) {
        headRef.current.rotation.y = Math.sin(time * 2.5) * 0.25;
        headRef.current.rotation.x = 0.05;
      }
    }

    // Smooth hover/select scale interpolation
    const targetScale = isSelected ? 1.08 : (hovered ? 1.05 : 1.0);
    groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 8);
  });

  return (
    <group
      ref={groupRef}
      position={[0, 0, 0.42]} // seated position relative to desk center
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        setHovered(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
        setHovered(false);
      }}
    >
      {/* Selection / Hover Glow Ring on Floor */}
      {(isSelected || hovered) && (
        <mesh position={[0, -0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.48, 32]} />
          <meshBasicMaterial 
            color={isSelected ? '#38bdf8' : '#94a3b8'} 
            transparent 
            opacity={isSelected ? 0.9 : 0.4} 
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Pelvis / Hips */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.26, 0.14, 0.22]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} />
      </mesh>

      {/* Legs (Left & Right) */}
      <group ref={leftLegRef} position={[-0.08, 0.28, 0.02]}>
        {/* Upper Leg */}
        <mesh position={[0, 0, -0.12]} castShadow>
          <boxGeometry args={[0.09, 0.1, 0.24]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>
        {/* Lower Leg / Shin */}
        <mesh position={[0, -0.15, -0.22]} castShadow>
          <boxGeometry args={[0.08, 0.22, 0.08]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>
        {/* Shoe */}
        <mesh position={[0, -0.26, -0.18]} castShadow>
          <boxGeometry args={[0.09, 0.06, 0.16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
      </group>

      <group ref={rightLegRef} position={[0.08, 0.28, 0.02]}>
        <mesh position={[0, 0, -0.12]} castShadow>
          <boxGeometry args={[0.09, 0.1, 0.24]} />
          <meshStandardMaterial color="#1e293b" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.15, -0.22]} castShadow>
          <boxGeometry args={[0.08, 0.22, 0.08]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} />
        </mesh>
        <mesh position={[0, -0.26, -0.18]} castShadow>
          <boxGeometry args={[0.09, 0.06, 0.16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
      </group>

      {/* Torso */}
      <group ref={torsoRef} position={[0, 0.54, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.32, 0.36, 0.2]} />
          <meshStandardMaterial color={agent.clothingColor} roughness={0.5} />
        </mesh>

        {/* Tie or Collar accent if executive/manager */}
        {agent.role === 'Manager' && (
          <mesh position={[0, 0.02, 0.11]} castShadow>
            <boxGeometry args={[0.06, 0.22, 0.02]} />
            <meshStandardMaterial color="#d97706" roughness={0.3} />
          </mesh>
        )}

        {/* Head Group */}
        <group ref={headRef} position={[0, 0.32, 0]}>
          {/* Head Sphere */}
          <mesh castShadow>
            <sphereGeometry args={[0.13, 24, 24]} />
            <meshStandardMaterial color={agent.skinTone} roughness={0.4} />
          </mesh>

          {/* Hair Styling */}
          <mesh position={[0, 0.04, -0.02]} castShadow>
            <sphereGeometry args={[0.14, 24, 16]} />
            <meshStandardMaterial color={agent.hairColor} roughness={0.7} />
          </mesh>

          {/* Glasses or Headset accessory based on role */}
          {(agent.role.includes('Engineer') || agent.role.includes('Developer') || agent.role.includes('DevOps')) && (
            <group position={[0, 0.02, 0.1]}>
              <mesh position={[-0.05, 0, 0]}>
                <ringGeometry args={[0.025, 0.035, 16]} />
                <meshBasicMaterial color="#38bdf8" />
              </mesh>
              <mesh position={[0.05, 0, 0]}>
                <ringGeometry args={[0.025, 0.035, 16]} />
                <meshBasicMaterial color="#38bdf8" />
              </mesh>
            </group>
          )}

          {/* Role Indicator Halo / Badge when Working */}
          {agent.status === 'WORKING' && (
            <mesh position={[0, 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.09, 0.12, 24]} />
              <meshBasicMaterial color="#38bdf8" toneMapped={false} />
            </mesh>
          )}
        </group>

        {/* Left Arm */}
        <group ref={leftArmRef} position={[-0.2, 0.12, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow>
            <boxGeometry args={[0.08, 0.22, 0.08]} />
            <meshStandardMaterial color={agent.clothingColor} roughness={0.5} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.24, 0]} castShadow>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshStandardMaterial color={agent.skinTone} roughness={0.4} />
          </mesh>
        </group>

        {/* Right Arm */}
        <group ref={rightArmRef} position={[0.2, 0.12, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow>
            <boxGeometry args={[0.08, 0.22, 0.08]} />
            <meshStandardMaterial color={agent.clothingColor} roughness={0.5} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.24, 0]} castShadow>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshStandardMaterial color={agent.skinTone} roughness={0.4} />
          </mesh>
        </group>
      </group>
    </group>
  );
};
