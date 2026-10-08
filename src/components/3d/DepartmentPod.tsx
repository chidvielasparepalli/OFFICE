import React, { useState } from 'react';
import { Html } from '@react-three/drei';
import { DepartmentInfo, OfficeAgent } from '../../types';
import { Workstation } from './Workstation';

interface DepartmentPodProps {
  department: DepartmentInfo;
  agents: OfficeAgent[];
  isSelected: boolean;
  selectedAgentId: string | null;
  onSelectDepartment: () => void;
  onSelectAgent: (agentId: string) => void;
}

export const DepartmentPod: React.FC<DepartmentPodProps> = ({
  department,
  agents,
  isSelected,
  selectedAgentId,
  onSelectDepartment,
  onSelectAgent
}) => {
  const [hovered, setHovered] = useState(false);
  const [width, depth] = department.size;
  const [x, y, z] = department.position;

  const activeAgents = agents.filter(a => a.status === 'WORKING').length;
  const sleepingAgents = agents.filter(a => a.status === 'SLEEPING').length;
  const pendingApprovals = agents.filter(a => !!a.pendingApproval).length;

  return (
    <group position={[x, y, z]}>
      {/* 1. Floating Department Info Card / Billboard (matches ref_frame_1.jpg & ref_frame_2.jpg) */}
      <Html
        position={[0, 4.2, -depth / 2 - 0.8]}
        center
        distanceFactor={28}
        zIndexRange={[20, 10]}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelectDepartment();
          }}
          className={`p-3 rounded-2xl shadow-xl backdrop-blur-md transition-all duration-200 cursor-pointer select-none border min-w-[210px] ${
            isSelected
              ? 'bg-white/95 border-blue-500 ring-4 ring-blue-500/20 scale-105'
              : 'bg-white/90 border-slate-200 hover:border-slate-400 hover:scale-105'
          }`}
          style={{
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            fontFamily: 'Inter, system-ui, sans-serif'
          }}
        >
          {/* Header Row: Dot + Department Name */}
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: department.color }}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                {department.name}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              {agents.length} AGENTS
            </span>
          </div>

          {/* Metrics Preview */}
          <div className="py-2 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-600">
              <span>{department.metrics.metricLabel1}</span>
              <span className="font-semibold text-slate-800">{department.metrics.metricValue1}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{department.metrics.metricLabel2}</span>
              <span className="font-semibold text-slate-800">{department.metrics.metricValue2}</span>
            </div>
          </div>

          {/* Activity Status Bar */}
          <div className="pt-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500 border-t border-slate-100">
            <div className="flex items-center gap-1">
              <span className="text-slate-400">DOING</span>
              <span className="font-bold text-emerald-600">{activeAgents}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">REST</span>
              <span className="font-bold text-slate-700">{sleepingAgents}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">DONE</span>
              <span className="font-bold text-slate-700">{department.metrics.completedTasks}</span>
            </div>
          </div>

          {/* Pending Approval Badge (from ref_frame_2.jpg) */}
          {pendingApprovals > 0 && (
            <div className="mt-2 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold flex items-center justify-center gap-1.5 animate-pulse">
              <span>⚠️</span>
              <span>{pendingApprovals} WAITING APPROVAL</span>
            </div>
          )}
        </div>
      </Html>

      {/* 2. Elevated Architectural Platform Slab */}
      <mesh
        position={[0, 0, 0]}
        receiveShadow
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectDepartment();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => {
          setHovered(false);
        }}
      >
        <boxGeometry args={[width, 0.35, depth]} />
        <meshStandardMaterial
          color={hovered || isSelected ? '#ffffff' : '#f8fafc'}
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>

      {/* Pod Perimeter Accent Inlay */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[width + 0.08, 0.03, depth + 0.08]} />
        <meshStandardMaterial
          color={department.color}
          roughness={0.3}
          metalness={0.2}
          emissive={department.color}
          emissiveIntensity={isSelected ? 0.35 : 0.08}
        />
      </mesh>

      {/* Floor Tile Grid Line Decal */}
      <mesh position={[0, 0.19, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - 0.4, depth - 0.4]} />
        <meshStandardMaterial
          color="#f1f5f9"
          roughness={0.8}
        />
      </mesh>

      {/* Workstations for this Department */}
      {agents.map((agent) => (
        <Workstation
          key={agent.id}
          agent={agent}
          isSelected={selectedAgentId === agent.id}
          onSelect={() => onSelectAgent(agent.id)}
        />
      ))}
    </group>
  );
};
