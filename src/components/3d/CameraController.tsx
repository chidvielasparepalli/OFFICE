import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import gsap from 'gsap';
import * as THREE from 'three';
import { useOfficeState } from '../../context/OfficeContext';

export const CameraController: React.FC = () => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { cameraTarget, resetCameraOverview } = useOfficeState();
  const currentTweenRef = useRef<gsap.core.Tween | null>(null);

  // Keyboard shortcut listener: Space or Esc to reset overview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' || e.key === 'Escape') {
        e.preventDefault();
        resetCameraOverview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [resetCameraOverview]);

  // Smooth cinematic camera transition whenever cameraTarget changes
  useEffect(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;

    if (currentTweenRef.current) {
      currentTweenRef.current.kill();
    }

    const duration = cameraTarget.mode === 'agent' ? 1.4 : 1.2;
    const ease = 'power3.out';

    const [tx, ty, tz] = cameraTarget.targetPos;
    const [cx, cy, cz] = cameraTarget.cameraPos;

    // Animate camera position and orbit target simultaneously
    const animObj = {
      cx: camera.position.x,
      cy: camera.position.y,
      cz: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z
    };

    currentTweenRef.current = gsap.to(animObj, {
      cx,
      cy,
      cz,
      tx,
      ty,
      tz,
      duration,
      ease,
      onUpdate: () => {
        camera.position.set(animObj.cx, animObj.cy, animObj.cz);
        controls.target.set(animObj.tx, animObj.ty, animObj.tz);
        controls.update();
      }
    });

    return () => {
      if (currentTweenRef.current) {
        currentTweenRef.current.kill();
      }
    };
  }, [cameraTarget, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.06}
      minDistance={2.5}
      maxDistance={65}
      minPolarAngle={Math.PI / 8}
      maxPolarAngle={Math.PI / 2.3} // Keep camera above floor
      maxTargetRadius={35} // Don't let user pan out into void
    />
  );
};
