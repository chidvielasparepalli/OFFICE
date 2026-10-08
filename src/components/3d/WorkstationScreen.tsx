import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ScreenType } from '../../types';

interface WorkstationScreenProps {
  screenType: ScreenType;
  snippet: string;
  isWorking: boolean;
  agentName: string;
}

export const WorkstationScreen: React.FC<WorkstationScreenProps> = ({
  screenType,
  snippet,
  isWorking,
  agentName
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.CanvasTexture(canvas);

    // Initial background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 320);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, []);

  // Redraw canvas whenever snippet, isWorking or type changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!isWorking && screenType === 'screensaver') {
      // Dark screensaver / sleep mode
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, 512, 320);

      // Subtle glowing clock
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(timeStr, 256, 150);

      ctx.fillStyle = '#1e293b';
      ctx.font = '14px sans-serif';
      ctx.fillText(`${agentName.toUpperCase()} · STANDBY`, 256, 185);

      texture.needsUpdate = true;
      return;
    }

    // Active Screen
    ctx.fillStyle = screenType === 'review' ? '#fafafa' : '#0f172a';
    ctx.fillRect(0, 0, 512, 320);

    // Top window bar
    ctx.fillStyle = screenType === 'review' ? '#e2e8f0' : '#1e293b';
    ctx.fillRect(0, 0, 512, 28);

    // Mac-style window dots
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(16, 14, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(32, 14, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(48, 14, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Window title
    ctx.fillStyle = screenType === 'review' ? '#334155' : '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const title = screenType === 'code' ? 'VS Code - main.ts' :
                  screenType === 'terminal' ? 'bash - aether-agent' :
                  screenType === 'design' ? 'Figma - Component Studio' :
                  screenType === 'devops' ? 'Grafana - Edge Cluster' :
                  screenType === 'charts' ? 'Executive Dashboard' : 'Workspace View';
    ctx.fillText(title, 256, 18);

    // Content rows
    ctx.textAlign = 'left';
    const lines = snippet.split('\n');
    ctx.font = screenType === 'code' || screenType === 'terminal' || screenType === 'devops' 
      ? '13px "JetBrains Mono", monospace' 
      : '14px sans-serif';

    lines.forEach((line, idx) => {
      const y = 52 + idx * 22;
      if (y > 300) return;

      if (screenType === 'code') {
        // Line number
        ctx.fillStyle = '#475569';
        ctx.fillText(String(idx + 1).padStart(2, '0'), 14, y);

        // Code coloring
        if (line.includes('function') || line.includes('const') || line.includes('export') || line.includes('import')) {
          ctx.fillStyle = '#38bdf8'; // blue keyword
        } else if (line.includes('return') || line.includes('await') || line.includes('async')) {
          ctx.fillStyle = '#c084fc'; // purple
        } else if (line.includes('//') || line.includes('/*')) {
          ctx.fillStyle = '#64748b'; // comment
        } else {
          ctx.fillStyle = '#e2e8f0'; // default text
        }
        ctx.fillText(line, 42, y);
      } else if (screenType === 'terminal') {
        if (line.startsWith('$')) {
          ctx.fillStyle = '#38bdf8';
        } else if (line.includes('PASSED') || line.includes('[OK]') || line.includes('passed')) {
          ctx.fillStyle = '#4ade80';
        } else if (line.includes('[INFO]')) {
          ctx.fillStyle = '#facc15';
        } else {
          ctx.fillStyle = '#cbd5e1';
        }
        ctx.fillText(line, 16, y);
      } else if (screenType === 'review') {
        ctx.fillStyle = idx === 0 ? '#0f172a' : '#334155';
        if (idx === 0) ctx.font = 'bold 15px Georgia, serif';
        else ctx.font = '13px sans-serif';
        ctx.fillText(line, 16, y);
      } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(line, 16, y);
      }
    });

    // Active cursor blink indicator
    if (isWorking) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(490, 8, 8, 12);
    }

    texture.needsUpdate = true;
  }, [screenType, snippet, isWorking, agentName, texture]);

  return (
    <mesh position={[0, 0, 0.01]}>
      <planeGeometry args={[1.05, 0.65]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
};
