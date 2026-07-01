/**
 * BusGlobe3D — Canvas-rendered animated 3D globe with:
 * - Full perspective-projected lat/lng grid (meridians + parallels)
 * - Animated auto-spin
 * - Glowing atmosphere layers
 * - Orbiting bus icon with trail
 * - Pulsing glow rings
 * - Respects prefers-reduced-motion
 */

import React, { useEffect, useRef } from 'react';
import { Bus } from 'lucide-react';

export interface BusGlobe3DProps {
  className?: string;
  size?: number;
}

export default function BusGlobe3D({ className = '', size = 200 }: BusGlobe3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const spinRef   = useRef(0);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = window.devicePixelRatio || 1;
    const S   = size * DPR;
    canvas.width  = S;
    canvas.height = S;
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;

    const cx = S / 2;
    const cy = S / 2;
    const R  = S * 0.42;   // globe radius in canvas px

    /** Project a lat/lng + current spin angle to canvas 2D */
    function project(
      latDeg: number,
      lonDeg: number,
      spin: number,
    ): { x: number; y: number; visible: boolean } {
      const lat = (latDeg * Math.PI) / 180;
      const lon = (lonDeg * Math.PI) / 180 + spin;
      // 3D globe point (Y-up sphere)
      const px = Math.cos(lat) * Math.sin(lon);
      const py = Math.sin(lat);
      const pz = Math.cos(lat) * Math.cos(lon);
      return {
        x: cx + R * px,
        y: cy - R * py,
        visible: pz > -0.05,   // front hemisphere
      };
    }

    function drawFrame(timestamp: number) {
      ctx.clearRect(0, 0, S, S);

      if (!reducedMotion) {
        spinRef.current = timestamp * 0.00035;
      }
      const spin = spinRef.current;

      // ── Outer atmosphere glow ──────────────────────────────────
      const atm = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.22);
      atm.addColorStop(0,   'rgba(59,130,246,0.22)');
      atm.addColorStop(0.5, 'rgba(37,99,235,0.08)');
      atm.addColorStop(1,   'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2);
      ctx.fillStyle = atm;
      ctx.fill();

      // ── Globe base ────────────────────────────────────────────
      const globe = ctx.createRadialGradient(cx - R * 0.28, cy - R * 0.25, 0, cx, cy, R);
      globe.addColorStop(0,   '#1e3a5f');
      globe.addColorStop(0.5, '#0d1f35');
      globe.addColorStop(1,   '#060e1a');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = globe;
      ctx.fill();

      // ── Grid lines ────────────────────────────────────────────
      // Parallels (latitudes)
      const latitudes  = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
      const longitudes = Array.from({ length: 12 }, (_, i) => i * 30);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      // Draw parallels
      for (const lat of latitudes) {
        const steps = 120;
        let started = false;
        for (let i = 0; i <= steps; i++) {
          const lon = (i / steps) * 360 - 180;
          const pt = project(lat, lon, spin);
          if (!pt.visible) { started = false; continue; }
          const alpha = 0.2 + 0.12 * Math.abs(Math.cos((lat * Math.PI) / 180));
          ctx.strokeStyle = `rgba(59,130,246,${alpha.toFixed(2)})`;
          ctx.lineWidth   = 0.6 * DPR;
          if (!started) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        if (started) ctx.stroke();
      }

      // Draw meridians
      for (const lon of longitudes) {
        const steps = 90;
        let started = false;
        for (let i = 0; i <= steps; i++) {
          const lat = (i / steps) * 180 - 90;
          const pt = project(lat, lon, spin);
          if (!pt.visible) { started = false; continue; }
          ctx.strokeStyle = 'rgba(59,130,246,0.2)';
          ctx.lineWidth   = 0.6 * DPR;
          if (!started) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        if (started) ctx.stroke();
      }

      // Equator highlight
      {
        let started = false;
        for (let i = 0; i <= 160; i++) {
          const lon = (i / 160) * 360 - 180;
          const pt  = project(0, lon, spin);
          if (!pt.visible) { started = false; continue; }
          ctx.strokeStyle = 'rgba(59,130,246,0.55)';
          ctx.lineWidth   = 1.2 * DPR;
          if (!started) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        }
        if (started) ctx.stroke();
      }

      ctx.restore();

      // ── Rim highlight ──────────────────────────────────────────
      const rim = ctx.createRadialGradient(cx, cy, R * 0.68, cx, cy, R);
      rim.addColorStop(0,   'transparent');
      rim.addColorStop(0.8, 'transparent');
      rim.addColorStop(1,   'rgba(59,130,246,0.55)');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(59,130,246,0.3)';
      ctx.lineWidth   = 1.5 * DPR;
      ctx.stroke();
      ctx.fillStyle = rim;
      ctx.fill();

      // ── Specular highlight (lens flare) ───────────────────────
      const spec = ctx.createRadialGradient(
        cx - R * 0.3, cy - R * 0.3, 0,
        cx - R * 0.3, cy - R * 0.3, R * 0.55
      );
      spec.addColorStop(0,   'rgba(255,255,255,0.07)');
      spec.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      spec.addColorStop(1,   'transparent');
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, S, S);
      ctx.restore();

      // ── Pulsing outer ring ─────────────────────────────────────
      const pulse = 0.7 + 0.3 * Math.sin(timestamp * 0.0025);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(59,130,246,${(pulse * 0.25).toFixed(3)})`;
      ctx.lineWidth   = 1 * DPR;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.28, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(59,130,246,${(pulse * 0.12).toFixed(3)})`;
      ctx.lineWidth   = 0.8 * DPR;
      ctx.stroke();

      animRef.current = requestAnimationFrame(drawFrame);
    }

    animRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animRef.current);
  }, [size, reducedMotion]);

  // Orbiting bus orbit angle
  const orbitAngle = reducedMotion ? -90 : undefined;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="3D spinning globe"
    >
      {/* Canvas globe */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', borderRadius: '50%' }}
      />

      {/* Orbiting bus icon */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: 0, left: 0, width: '100%', height: '100%',
          animation: reducedMotion ? undefined : 'bus-orbit-3d 5s linear infinite',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '7%',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <div
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'rgba(59,130,246,0.18)',
              border: '1.5px solid rgba(59,130,246,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 12px rgba(59,130,246,0.55), 0 0 4px rgba(59,130,246,0.9)',
            }}
          >
            <Bus style={{ width: 13, height: 13, color: '#60a5fa' }} />
          </div>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes bus-orbit-3d {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
