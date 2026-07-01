/**
 * BusGlobe3D — Pure CSS + SVG animated globe. Zero external 3-D deps.
 *
 * Renders a dark spinning globe with:
 * - Rotating meridian/parallel lines via CSS animation
 * - A small bus icon orbiting the equator
 * - Glowing atmosphere ring
 * - Respects prefers-reduced-motion
 */

import React from 'react';
import { Bus } from 'lucide-react';

export interface BusGlobe3DProps {
  className?: string;
  size?: number;
}

export default function BusGlobe3D({ className = '', size = 160 }: BusGlobe3DProps) {
  const r = size / 2;
  const cx = r;
  const cy = r;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="3D spinning globe"
    >
      {/* ── Outer atmosphere glow ── */}
      <div
        className="absolute inset-0 rounded-full animate-glow-pulse"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.15) 60%, transparent 80%)',
          borderRadius: '50%',
        }}
      />

      {/* ── Globe SVG ── */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ overflow: 'visible' }}
      >
        <defs>
          {/* Clip to circle */}
          <clipPath id="globe-clip">
            <circle cx={cx} cy={cy} r={r * 0.88} />
          </clipPath>
          {/* Atmosphere gradient */}
          <radialGradient id="globe-fill" cx="40%" cy="35%">
            <stop offset="0%"   stopColor="#1e3a5f" />
            <stop offset="60%"  stopColor="#0d1f35" />
            <stop offset="100%" stopColor="#060e1a" />
          </radialGradient>
          {/* Rim highlight */}
          <radialGradient id="rim-glow" cx="50%" cy="50%">
            <stop offset="70%" stopColor="transparent" />
            <stop offset="100%" stopColor="rgba(59,130,246,0.5)" />
          </radialGradient>
        </defs>

        {/* Globe base */}
        <circle cx={cx} cy={cy} r={r * 0.88} fill="url(#globe-fill)" />

        {/* Grid lines clipped to globe */}
        <g clipPath="url(#globe-clip)" opacity="0.35">
          {/* Static parallels (latitude lines) */}
          {[-0.6, -0.35, 0, 0.35, 0.6].map((offset, i) => {
            const latY = cy + offset * r * 0.88;
            const latRx = Math.sqrt(Math.max(0, (r * 0.88) ** 2 - (offset * r * 0.88) ** 2));
            return (
              <ellipse
                key={`lat-${i}`}
                cx={cx} cy={latY}
                rx={latRx} ry={latRx * 0.12}
                fill="none" stroke="#3b82f6" strokeWidth="0.8"
              />
            );
          })}

          {/* Animated spinning meridians (longitude lines) */}
          <g style={{ animation: 'globe-spin 8s linear infinite', transformOrigin: `${cx}px ${cy}px` }}>
            {[0, 45, 90, 135].map((angle, i) => (
              <ellipse
                key={`lon-${i}`}
                cx={cx} cy={cy}
                rx={r * 0.25} ry={r * 0.88}
                fill="none" stroke="#3b82f6" strokeWidth="0.8"
                transform={`rotate(${angle} ${cx} ${cy})`}
              />
            ))}
          </g>
        </g>

        {/* Rim glow overlay */}
        <circle cx={cx} cy={cy} r={r * 0.88} fill="url(#rim-glow)" />

        {/* Equator highlight line */}
        <ellipse
          cx={cx} cy={cy}
          rx={r * 0.88} ry={r * 0.10}
          fill="none" stroke="rgba(59,130,246,0.4)" strokeWidth="1"
        />
      </svg>

      {/* ── Orbiting bus icon ── */}
      <div
        className="absolute"
        style={{
          animation: 'bus-orbit 6s linear infinite',
          transformOrigin: '50% 50%',
          top: 0, left: 0, width: '100%', height: '100%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="w-6 h-6 rounded-full bg-[#3b82f6]/20 border border-[#3b82f6]/60 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Bus className="w-3.5 h-3.5 text-[#3b82f6]" />
          </div>
        </div>
      </div>

      {/* Keyframes injected inline */}
      <style>{`
        @keyframes globe-spin {
          from { transform: rotateY(0deg); }
          to   { transform: rotateY(360deg); }
        }
        @keyframes bus-orbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bus-globe-reduced * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
