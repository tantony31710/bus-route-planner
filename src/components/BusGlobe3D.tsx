/**
 * BusGlobe3D — Animated 3-D globe showing the school-bus route.
 *
 * • Rotating Earth-like sphere (dark navy + GLSL grid lines)
 * • Glowing yellow bus marker orbiting the route arc
 * • Orange pickup-stop dots
 * • Green hub dots
 * • OrbitControls (drag / zoom)
 * • Starfield backdrop
 * • Atmosphere shell
 * • Graceful fallback when WebGL is unavailable
 * • Respects prefers-reduced-motion (pauses all animation)
 *
 * `routeStops` is optional: when absent, a set of fake demo stops are used so
 * the globe always renders something interesting on first load.
 */

import React, { useRef, useMemo, Suspense, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useReducedMotion } from 'motion/react';
import { RouteStop } from '../types';

// ── Fake demo stops (used when no routeStops prop is provided) ───────────────
const DEMO_STOPS: RouteStop[] = [
  { id: 'start',  name: 'Roxy Square',        type: 'hub',    lat: 30.0960, lng: 31.3320, eta: '08:00 AM', distanceFromPrev: 0,   durationFromPrev: 0 },
  { id: 's1',     name: 'Stop A',             type: 'pickup', lat: 30.0950, lng: 31.3290, eta: '08:04 AM', distanceFromPrev: 0.3, durationFromPrev: 3 },
  { id: 's2',     name: 'Stop B',             type: 'pickup', lat: 30.0935, lng: 31.3275, eta: '08:07 AM', distanceFromPrev: 0.2, durationFromPrev: 3 },
  { id: 's3',     name: 'Stop C',             type: 'pickup', lat: 30.0920, lng: 31.3260, eta: '08:10 AM', distanceFromPrev: 0.2, durationFromPrev: 3 },
  { id: 's4',     name: 'Stop D',             type: 'pickup', lat: 30.0908, lng: 31.3244, eta: '08:13 AM', distanceFromPrev: 0.2, durationFromPrev: 3 },
  { id: 's5',     name: 'Stop E',             type: 'pickup', lat: 30.0895, lng: 31.3230, eta: '08:16 AM', distanceFromPrev: 0.2, durationFromPrev: 3 },
  { id: 'end',    name: 'Church Complex',     type: 'hub',    lat: 30.0880, lng: 31.3210, eta: '08:20 AM', distanceFromPrev: 0.3, durationFromPrev: 4 },
];

// ── Utilities ────────────────────────────────────────────────────────────────

function latLngToVector3(lat: number, lng: number, radius = 1): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta),
  );
}

function buildArc(
  from: { lat: number; lng: number },
  to:   { lat: number; lng: number },
  segments = 32,
  radius   = 1.01,
): THREE.Vector3[] {
  const start  = latLngToVector3(from.lat, from.lng, radius);
  const end    = latLngToVector3(to.lat,   to.lng,   radius);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t    = i / segments;
    const v    = new THREE.Vector3().lerpVectors(start, end, t).normalize();
    const alt  = radius + Math.sin(t * Math.PI) * 0.07;
    points.push(v.multiplyScalar(alt));
  }
  return points;
}

// ── WebGL detection ──────────────────────────────────────────────────────────

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

// ── Scene sub-components ─────────────────────────────────────────────────────

function EarthSphere({ reduced }: { reduced: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null!);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv    = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2  vUv;
      varying vec3  vNormal;

      float grid(vec2 uv, float freq, float thickness) {
        vec2  g    = fract(uv * freq);
        float line = min(
          smoothstep(0.0, thickness, g.x) * smoothstep(thickness, 0.0, g.x - (1.0 - thickness)),
          smoothstep(0.0, thickness, g.y) * smoothstep(thickness, 0.0, g.y - (1.0 - thickness))
        );
        return 1.0 - line;
      }

      void main() {
        vec3 base     = vec3(0.04, 0.07, 0.18);
        float g       = grid(vUv, 16.0, 0.04);
        vec3  col     = mix(vec3(0.10, 0.22, 0.55), base, g);

        float pulse   = 0.5 + 0.5 * sin(uTime * 1.5 + vUv.y * 12.0);
        col          += vec3(0.0, 0.10, 0.30) * pulse * 0.08;

        float rim     = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
        rim           = pow(rim, 2.5);
        col           = mix(col, vec3(0.15, 0.45, 1.0), rim * 0.55);

        float pole    = smoothstep(0.35, 0.0, abs(vUv.y - 0.5));
        col          += vec3(0.05, 0.10, 0.30) * pole * 0.40;

        gl_FragColor  = vec4(col, 1.0);
      }
    `,
  }), []);

  useFrame((state) => {
    if (!reduced) meshRef.current.rotation.y += 0.0012;
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 64, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function AtmosphereShell() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color:       new THREE.Color(0.1, 0.4, 1.0),
    transparent: true,
    opacity:     0.045,
    side:        THREE.BackSide,
    depthWrite:  false,
  }), []);

  return (
    <mesh>
      <sphereGeometry args={[1.13, 32, 32]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function RouteArc({ stops, reduced }: { stops: RouteStop[]; reduced: boolean }) {
  const points = useMemo(() => {
    if (stops.length < 2) return [];
    const all: THREE.Vector3[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = buildArc(
        { lat: stops[i].lat,     lng: stops[i].lng },
        { lat: stops[i+1].lat,   lng: stops[i+1].lng },
        24, 1.01,
      );
      if (i > 0) seg.shift();
      all.push(...seg);
    }
    return all;
  }, [stops]);

  if (points.length < 2) return null;
  return (
    <Line
      points={points}
      color="#3B82F6"
      lineWidth={1.5}
      transparent
      opacity={0.75}
    />
  );
}

function StopMarkers({ stops }: { stops: RouteStop[] }) {
  const pickups = useMemo(() => stops.filter(s => s.type === 'pickup'), [stops]);
  return (
    <>
      {pickups.map(stop => {
        const pos = latLngToVector3(stop.lat, stop.lng, 1.025);
        return (
          <mesh key={stop.id} position={pos}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshBasicMaterial color="#F97316" toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

function HubMarkers({ stops }: { stops: RouteStop[] }) {
  const hubs = useMemo(() => stops.filter(s => s.type === 'hub'), [stops]);
  return (
    <>
      {hubs.map(hub => {
        const pos = latLngToVector3(hub.lat, hub.lng, 1.03);
        return (
          <mesh key={hub.id} position={pos}>
            <sphereGeometry args={[0.018, 10, 10]} />
            <meshBasicMaterial color="#10B981" toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

function BusMarker({ stops, reduced }: { stops: RouteStop[]; reduced: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);
  const tRef    = useRef(0);

  const arcPoints = useMemo(() => {
    if (stops.length < 2) return [];
    const all: THREE.Vector3[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = buildArc(
        { lat: stops[i].lat,   lng: stops[i].lng },
        { lat: stops[i+1].lat, lng: stops[i+1].lng },
        48, 1.028,
      );
      if (i > 0) seg.shift();
      all.push(...seg);
    }
    return all;
  }, [stops]);

  useFrame((_, delta) => {
    if (arcPoints.length < 2) return;
    if (!reduced) tRef.current = (tRef.current + delta * 0.06) % 1;
    const idx = Math.floor(tRef.current * (arcPoints.length - 1));
    const pos = arcPoints[Math.min(idx, arcPoints.length - 1)];
    meshRef.current.position.copy(pos);
    glowRef.current.position.copy(pos);
    const pulse = 1 + 0.3 * Math.sin(Date.now() * 0.005);
    glowRef.current.scale.setScalar(pulse);
  });

  if (arcPoints.length < 2) return null;
  return (
    <>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color="#FACC15" transparent opacity={0.25} toneMapped={false} />
      </mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.02, 12, 12]} />
        <meshBasicMaterial color="#FACC15" toneMapped={false} />
      </mesh>
    </>
  );
}

function Stars() {
  const geometry = useMemo(() => {
    const geo   = new THREE.BufferGeometry();
    const count = 600;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const phi   = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const r     = 4 + Math.random() * 2;
      pos[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      pos[i * 3 + 1] = r * Math.cos(theta);
      pos[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial color="#ffffff" size={0.012} sizeAttenuation transparent opacity={0.6} />
    </points>
  );
}

// ── No-WebGL fallback ────────────────────────────────────────────────────────

function NoWebGLFallback() {
  return (
    <div
      className="w-full flex flex-col items-center justify-center gap-3 bg-[#050509] text-[#8E9299] rounded-2xl border border-[#2A2A30]"
      style={{ height: 320 }}
      role="img"
      aria-label="3D globe unavailable"
    >
      <svg className="w-16 h-16 text-[#2A2A30]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" strokeWidth="1.5" />
      </svg>
      <p className="text-xs font-semibold text-[#F0F0F0]/60">3D Globe unavailable</p>
      <p className="text-[10px] text-[#8E9299]/60 max-w-[220px] text-center leading-relaxed">
        WebGL is not supported or disabled in your browser. Enable hardware acceleration to view the 3D globe.
      </p>
    </div>
  );
}

// ── Main exported component ──────────────────────────────────────────────────

interface BusGlobe3DProps {
  /** Live route stops from the route planner. Optional — falls back to demo stops. */
  routeStops?: RouteStop[];
  className?: string;
}

export default function BusGlobe3D({ routeStops, className = '' }: BusGlobe3DProps) {
  const reduced = useReducedMotion() ?? false;

  // WebGL availability check (client-side only)
  const [webGLOk, setWebGLOk] = useState<boolean | null>(null);
  useEffect(() => {
    setWebGLOk(isWebGLAvailable());
  }, []);

  // Resolve effective stops
  const stops: RouteStop[] = (routeStops && routeStops.length >= 2) ? routeStops : DEMO_STOPS;

  // Not yet checked → show nothing to avoid flash
  if (webGLOk === null) {
    return (
      <div
        className={`relative w-full rounded-2xl overflow-hidden border border-[#2A2A30] bg-[#050509] ${className}`}
        style={{ height: 320 }}
        aria-hidden
      />
    );
  }

  if (!webGLOk) return <NoWebGLFallback />;

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden border border-[#2A2A30] bg-[#050509] shadow-2xl shadow-black/50 ${className}`}
      style={{ height: 320 }}
      aria-label="3D animated school bus route globe"
      role="img"
    >
      <Canvas
        camera={{ position: [0, 0, 2.6], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Stars />
          <EarthSphere reduced={reduced} />
          <AtmosphereShell />
          {stops.length >= 2 && (
            <>
              <RouteArc   stops={stops} reduced={reduced} />
              <StopMarkers stops={stops} />
              <HubMarkers  stops={stops} />
              <BusMarker   stops={stops} reduced={reduced} />
            </>
          )}
          <OrbitControls
            enablePan={false}
            enableZoom
            minDistance={1.6}
            maxDistance={4.5}
            rotateSpeed={0.5}
            zoomSpeed={0.6}
            autoRotate={!reduced}
            autoRotateSpeed={0.4}
          />
          <ambientLight intensity={0.15} />
          <pointLight position={[5, 3, 5]} intensity={0.6} color="#4488ff" />
        </Suspense>
      </Canvas>

      {/* HUD legend */}
      <div className="absolute bottom-3 left-4 flex items-center gap-4 pointer-events-none">
        {[
          { color: '#FACC15', shadow: '0 0 6px #FACC15', label: 'Bus Live' },
          { color: '#F97316', label: 'Pickup Stops' },
          { color: '#10B981', label: 'Hubs' },
          { color: '#3B82F6', label: 'Route Arc' },
        ].map(({ color, shadow, label }) => (
          <div key={label} className="flex items-center gap-1.5 text-[10px] text-[#8E9299] font-mono">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color, boxShadow: shadow }}
            />
            {label}
          </div>
        ))}
      </div>

      <div className="absolute top-3 right-4 text-[10px] text-[#8E9299]/60 font-mono pointer-events-none select-none">
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  );
}
