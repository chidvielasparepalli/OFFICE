import React from 'react';
import { Html } from '@react-three/drei';
import { OfficeAgent } from '../../types';
import { AgentCharacter } from './AgentCharacter';
import { WorkstationScreen } from './WorkstationScreen';

interface WorkstationProps {
  agent: OfficeAgent;
  isSelected: boolean;
  onSelect: () => void;
}

export const Workstation: React.FC<WorkstationProps> = ({
  agent,
  isSelected,
  onSelect
}) => {
  const isWorking = agent.status === 'WORKING';
  const isLead = agent.role === 'Manager' || agent.role.includes('Lead');

  return (
    <group position={agent.workstationPos}>
      {/* 1. Floating Desk Pill / Role Badge (matches ref_frame_1.jpg and ref_frame_3.jpg) */}
      <Html
        position={[0, 1.85, -0.1]}
        center
        distanceFactor={22}
        zIndexRange={[10, 0]}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wider flex items-center gap-1.5 shadow-md transition-all duration-200 cursor-pointer select-none whitespace-nowrap border ${
            isSelected
              ? 'bg-slate-900 text-cyan-300 border-cyan-400 ring-2 ring-cyan-400/40 shadow-cyan-500/20'
              : isWorking
              ? 'bg-white/95 text-slate-800 border-slate-200 hover:border-slate-400 hover:scale-105'
              : 'bg-white/80 text-slate-500 border-slate-200 opacity-80 hover:opacity-100 hover:scale-105'
          }`}
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}
        >
          {/* Status Indicator Dot */}
          <span
            className={`w-2 h-2 rounded-full ${
              isWorking
                ? 'bg-emerald-500 animate-pulse'
                : agent.status === 'QUEUED'
                ? 'bg-amber-500'
                : 'bg-slate-300'
            }`}
          />
          {isLead && <span className="text-amber-500 font-bold">★</span>}
          <span>{agent.role.toUpperCase()}</span>
        </div>
      </Html>

      {/* 2. Wooden Desk Top */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.06, 0.85]} />
        <meshStandardMaterial 
          color="#d6c2a8" // warm natural oak
          roughness={0.4} 
          metalness={0.05} 
        />
      </mesh>

      {/* Desk Legs (Anthracite metal) */}
      <mesh position={[-0.68, 0.36, -0.36]} castShadow>
        <boxGeometry args={[0.06, 0.72, 0.06]} />
        <meshStandardMaterial color="#334155" roughness={0.5} />
      </mesh>
      <mesh position={[0.68, 0.36, -0.36]} castShadow>
        <boxGeometry args={[0.06, 0.72, 0.06]} />
        <meshStandardMaterial color="#334155" roughness={0.5} />
      </mesh>
      <mesh position={[-0.68, 0.36, 0.36]} castShadow>
        <boxGeometry args={[0.06, 0.72, 0.06]} />
        <meshStandardMaterial color="#334155" roughness={0.5} />
      </mesh>
      <mesh position={[0.68, 0.36, 0.36]} castShadow>
        <boxGeometry args={[0.06, 0.72, 0.06]} />
        <meshStandardMaterial color="#334155" roughness={0.5} />
      </mesh>

      {/* Privacy / Cable Modesty Panel under desk */}
      <mesh position={[0, 0.46, -0.38]} castShadow>
        <boxGeometry args={[1.36, 0.38, 0.02]} />
        <meshStandardMaterial color="#475569" roughness={0.6} />
      </mesh>

      {/* 3. Desktop Monitor Stand & Display */}
      <group position={[0, 0.75, -0.22]}>
        {/* Monitor Base */}
        <mesh position={[0, 0.01, 0]} castShadow>
          <boxGeometry args={[0.34, 0.02, 0.22]} />
          <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.3} />
        </mesh>
        {/* Stand Arm */}
        <mesh position={[0, 0.18, -0.04]} castShadow>
          <boxGeometry args={[0.06, 0.34, 0.04]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.3} />
        </mesh>
        {/* Monitor Screen Frame */}
        <group position={[0, 0.38, 0]} rotation={[-0.05, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.12, 0.72, 0.05]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} />
          </mesh>
          {/* Active Canvas Screen */}
          <WorkstationScreen
            screenType={agent.screenType}
            snippet={agent.screenSnippet}
            isWorking={isWorking}
            agentName={agent.name}
          />
        </group>
      </group>

      {/* 4. Keyboard & Mouse */}
      <mesh position={[0, 0.76, 0.12]} castShadow>
        <boxGeometry args={[0.48, 0.015, 0.16]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      <mesh position={[0.34, 0.76, 0.12]} castShadow>
        <boxGeometry args={[0.08, 0.015, 0.12]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} />
      </mesh>

      {/* 5. Desk Props: Ceramic Coffee Mug */}
      <group position={[0.52, 0.75, -0.05]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.055, 0.05, 0.11, 16]} />
          <meshStandardMaterial color="#f87171" roughness={0.3} />
        </mesh>
        {/* Coffee inside */}
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.01, 16]} />
          <meshStandardMaterial color="#3b1d11" roughness={0.2} />
        </mesh>
      </group>

      {/* 6. Desk Props: Small Succulent Plant */}
      <group position={[-0.56, 0.75, -0.2]}>
        {/* Planter Pot */}
        <mesh castShadow>
          <cylinderGeometry args={[0.06, 0.045, 0.09, 16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} />
        </mesh>
        {/* Green Plant */}
        <mesh position={[0, 0.07, 0]} castShadow>
          <dodecahedronGeometry args={[0.065]} />
          <meshStandardMaterial color="#10b981" roughness={0.8} />
        </mesh>
      </group>

      {/* 7. Ergonomic Office Chair */}
      <group position={[0, 0, 0.44]}>
        {/* Chair 5-star base center */}
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.06, 12]} />
          <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Central hydraulic lift pole */}
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.22, 12]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Chair Seat Cushion */}
        <mesh position={[0, 0.38, 0]} castShadow>
          <boxGeometry args={[0.46, 0.08, 0.44]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        {/* Chair Curved Backrest */}
        <mesh position={[0, 0.68, 0.2]} rotation={[0.08, 0, 0]} castShadow>
          <boxGeometry args={[0.42, 0.54, 0.06]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
      </group>

      {/* 8. The Seated AI Employee Character */}
      <AgentCharacter
        agent={agent}
        isSelected={isSelected}
        onSelect={onSelect}
      />
    </group>
  );
};
