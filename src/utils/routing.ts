/**
 * routing.ts — unified route computation layer
 *
 * Priority chain (each falls back to the next on failure):
 *   1. /api/compute-route  (Python backend → Routes API v2 with sideOfRoad)
 *   2. DirectionsService   (Google Maps JS SDK, works with free/demo key)
 *   3. getOfflineRoutePath (20-node Heliopolis street graph, always available)
 */

import { decode } from '@googlemaps/polyline-codec';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Point {
  lat: number;
  lng: number;
}

// ── Offline street graph (Heliopolis/Roxy, used as last-resort fallback) ──────
export const GRAPH_NODES: Record<string, Point> = {
  k1: { lat: 30.0910, lng: 31.3100 },
  k2: { lat: 30.0916, lng: 31.3125 },
  k3: { lat: 30.0922, lng: 31.3150 },
  k4: { lat: 30.0931, lng: 31.3175 },
  k5: { lat: 30.0945, lng: 31.3200 },
  s1: { lat: 30.0942, lng: 31.3138 },
  s2: { lat: 30.0950, lng: 31.3142 },
  s3: { lat: 30.0958, lng: 31.3148 },
  s4: { lat: 30.0965, lng: 31.3160 },
  m1: { lat: 30.0900, lng: 31.3150 },
  m2: { lat: 30.0915, lng: 31.3170 },
  m3: { lat: 30.0928, lng: 31.3185 },
  m4: { lat: 30.0938, lng: 31.3200 },
  a2: { lat: 30.0935, lng: 31.3165 },
  a3: { lat: 30.0942, lng: 31.3185 },
  b1: { lat: 30.0950, lng: 31.3120 },
  b2: { lat: 30.0940, lng: 31.3145 },
  w2: { lat: 30.0958, lng: 31.3180 },
  w3: { lat: 30.0950, lng: 31.3200 },
};

export const ADJACENCY: Record<string, string[]> = {
  k1: ['k2'], k2: ['k1','k3'], k3: ['k2','k4','a2'], k4: ['k3','k5','m2'], k5: ['k4'],
  s1: ['s2','b2'], s2: ['s1','s3'], s3: ['s2','s4'], s4: ['s3','w2'],
  m1: ['m2'], m2: ['m1','m3','k4'], m3: ['m2','m4'], m4: ['m3','w3'],
  a2: ['k3','a3','b2'], a3: ['a2'],
  b1: ['b2'], b2: ['b1','a2','s1'],
  w2: ['s4','w3'], w3: ['w2','m4'],
};

export const SEGMENTS: [string, string][] = [
  ['k1','k2'],['k2','k3'],['k3','k4'],['k4','k5'],
  ['s1','s2'],['s2','s3'],['s3','s4'],
  ['m1','m2'],['m2','m3'],['m3','m4'],
  ['k3','a2'],['a2','a3'],
  ['b1','b2'],['b2','a2'],
  ['s4','w2'],['w2','w3'],
  ['s1','b2'],['m2','k4'],['w3','m4'],
];

export function projectPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  const sq = dLat * dLat + dLng * dLng;
  if (sq === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * dLat + (p.lng - a.lng) * dLng) / sq));
  return { lat: a.lat + t * dLat, lng: a.lng + t * dLng };
}

export function snapToRoadNetwork(p: Point): { point: Point; segment: [string, string]; dist: number } {
  let minPoint = { ...p }, minSegment: [string, string] = ['k1','k2'], minDist = Infinity;
  for (const seg of SEGMENTS) {
    const a = GRAPH_NODES[seg[0]], b = GRAPH_NODES[seg[1]];
    if (!a || !b) continue;
    const proj = projectPointOnSegment(p, a, b);
    const d = Math.pow(p.lat - proj.lat, 2) + Math.pow(p.lng - proj.lng, 2);
    if (d < minDist) { minDist = d; minPoint = proj; minSegment = seg; }
  }
  return { point: minPoint, segment: minSegment, dist: Math.sqrt(minDist) };
}

function findNearestNodeId(pt: Point): string {
  let best = 'k1', bestDist = Infinity;
  for (const [id, node] of Object.entries(GRAPH_NODES)) {
    const d = Math.pow(pt.lat - node.lat, 2) + Math.pow(pt.lng - node.lng, 2);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return best;
}

function findShortestPath(startId: string, endId: string): string[] {
  if (startId === endId) return [startId];
  const queue = [startId], visited = new Set([startId]), parent: Record<string, string> = {};
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === endId) {
      const path: string[] = []; let c = endId;
      while (c !== startId) { path.push(c); c = parent[c]; }
      return [...path.push(startId) && path].reverse();
    }
    for (const nb of ADJACENCY[cur] || []) {
      if (!visited.has(nb)) { visited.add(nb); parent[nb] = cur; queue.push(nb); }
    }
  }
  return [];
}

function getOfflineRoutePath(stops: Point[]): Point[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) return [snapToRoadNetwork(stops[0]).point];
  const out: Point[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const sA = snapToRoadNetwork(stops[i]), sB = snapToRoadNetwork(stops[i + 1]);
    const A = sA.point, B = sB.point;
    const sub: Point[] = [A];
    const sameSegBase = (sA.segment[0] === sB.segment[0] && sA.segment[1] === sB.segment[1]);
    const sameSegRev  = (sA.segment[0] === sB.segment[1] && sA.segment[1] === sB.segment[0]);
    if (!sameSegBase && !sameSegRev) {
      const n1 = findNearestNodeId(A), n2 = findNearestNodeId(B);
      if (n1 !== n2) {
        findShortestPath(n1, n2).forEach(id => {
          const pt = GRAPH_NODES[id];
          if (pt) sub.push(pt);
        });
      }
    }
    sub.push(B);
    sub.forEach(pt => {
      const last = out[out.length - 1];
      if (!last || Math.abs(last.lat - pt.lat) > 1e-5 || Math.abs(last.lng - pt.lng) > 1e-5) {
        out.push(pt);
      }
    });
  }
  return out;
}

// ── Decode a pipe-joined or single encoded polyline ──────────────────────────
function decodePolylineResult(raw: string): Point[] {
  const parts = raw.split('|').filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    return decode(parts[0]).map(([lat, lng]) => ({ lat, lng }));
  }
  // Stitch legs: skip first point of each subsequent leg to avoid duplication
  const out: Point[] = [];
  parts.forEach((encoded, idx) => {
    const pts = decode(encoded).map(([lat, lng]): Point => ({ lat, lng }));
    out.push(...(idx === 0 ? pts : pts.slice(1)));
  });
  return out;
}

// ── Tier 1: Python backend → Routes API v2 with sideOfRoad ───────────────────
async function getRouteFromBackend(stops: Point[]): Promise<Point[]> {
  const response = await fetch('/api/compute-route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stops }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Backend /api/compute-route returned ${response.status}: ${err.error ?? 'unknown'}`);
  }

  const data = await response.json();
  if (!data.polyline) throw new Error('Backend returned no polyline field.');

  const pts = decodePolylineResult(data.polyline);
  if (pts.length < 2) throw new Error('Backend polyline decoded to fewer than 2 points.');

  console.info(
    `[routing] Backend route: ${data.stopCount} stops, ` +
    `${(data.distanceMeters / 1000).toFixed(2)} km, ` +
    `${Math.round(data.durationSecs / 60)} min`
  );
  return pts;
}

// ── Tier 2: Google Maps JS SDK DirectionsService ──────────────────────────────
function getRouteFromDirectionsService(stops: Point[]): Promise<Point[]> {
  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google?.maps?.DirectionsService) {
      reject(new Error('Google Maps JS SDK not loaded.'));
      return;
    }

    const svc = new google.maps.DirectionsService();
    const MAX_WP = 23;

    // Chunk into batches of MAX_WP + 2 (origin + destination)
    const chunks: Point[][] = [];
    for (let i = 0; i < stops.length - 1; i += MAX_WP + 1) {
      const chunk = stops.slice(i, Math.min(i + MAX_WP + 2, stops.length));
      if (chunk.length >= 2) chunks.push(chunk);
    }
    if (chunks.length === 0) chunks.push(stops);

    const fetchChunk = (chunk: Point[]): Promise<Point[]> =>
      new Promise(res => {
        svc.route(
          {
            origin:      { lat: chunk[0].lat,              lng: chunk[0].lng },
            destination: { lat: chunk[chunk.length-1].lat, lng: chunk[chunk.length-1].lng },
            waypoints: chunk.slice(1, -1).map(s => ({
              location: { lat: s.lat, lng: s.lng },
              stopover: true,
            })),
            travelMode:        google.maps.TravelMode.DRIVING,
            optimizeWaypoints: false,
            region:            'EG',
          },
          (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
              const pts: Point[] = [];
              result.routes[0].legs.forEach(leg =>
                leg.steps.forEach(step =>
                  step.path.forEach(pt => pts.push({ lat: pt.lat(), lng: pt.lng() }))
                )
              );
              res(pts);
            } else {
              console.warn('[routing] DirectionsService chunk failed:', status);
              res(chunk); // straight line fallback for this chunk
            }
          }
        );
      });

    (async () => {
      try {
        const all: Point[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const pts = await fetchChunk(chunks[i]);
          all.push(...(i === 0 ? pts : pts.slice(1)));
        }
        if (all.length < 2) { reject(new Error('DirectionsService returned fewer than 2 points.')); return; }
        resolve(all);
      } catch (e) {
        reject(e);
      }
    })();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Compute a road-following path through the given stops.
 *
 * Tries (in order):
 *   1. /api/compute-route  — Routes API v2, sideOfRoad modifiers, highest accuracy
 *   2. DirectionsService   — Google Maps JS SDK, good accuracy, requires map key
 *   3. getOfflineRoutePath — 20-node street graph, always works, lowest accuracy
 */
export async function getHighResolutionRoutePath(
  stops: Point[],
  _apiKey?: string   // kept for signature compatibility, no longer used directly
): Promise<Point[]> {
  if (stops.length < 2) return stops;

  // ── Tier 1: backend ───────────────────────────────────────────────────────
  try {
    const pts = await getRouteFromBackend(stops);
    console.info('[routing] ✅ Using Routes API v2 (backend, sideOfRoad)');
    return pts;
  } catch (e) {
    console.warn('[routing] Tier 1 (backend) failed:', (e as Error).message);
  }

  // ── Tier 2: DirectionsService ─────────────────────────────────────────────
  try {
    const pts = await getRouteFromDirectionsService(stops);
    console.info('[routing] ✅ Using DirectionsService (JS SDK)');
    return pts;
  } catch (e) {
    console.warn('[routing] Tier 2 (DirectionsService) failed:', (e as Error).message);
  }

  // ── Tier 3: offline graph ─────────────────────────────────────────────────
  console.warn('[routing] ⚠️ Using offline street graph (lowest accuracy)');
  return getOfflineRoutePath(stops);
}
