import { decode } from '@googlemaps/polyline-codec';

interface Point {
    lat: number;
    lng: number;
}
  
export const GRAPH_NODES: { [key: string]: Point } = {
    // Khalifa St
    'k1': { lat: 30.0910, lng: 31.3100 },
    'k2': { lat: 30.0916, lng: 31.3125 },
    'k3': { lat: 30.0922, lng: 31.3150 }, // Intersection Khalifa & Ashgar
    'k4': { lat: 30.0931, lng: 31.3175 },
    'k5': { lat: 30.0945, lng: 31.3200 },
  
    // Selahdar St
    's1': { lat: 30.0942, lng: 31.3138 },
    's2': { lat: 30.0950, lng: 31.3142 },
    's3': { lat: 30.0958, lng: 31.3148 },
    's4': { lat: 30.0965, lng: 31.3160 }, // Intersection Selahdar & Noweiry / St. Mary Church
  
    // Mokrizi St
    'm1': { lat: 30.0900, lng: 31.3150 },
    'm2': { lat: 30.0915, lng: 31.3170 },
    'm3': { lat: 30.0928, lng: 31.3185 },
    'm4': { lat: 30.0938, lng: 31.3200 },
  
    // Ashgar St
    'a2': { lat: 30.0935, lng: 31.3165 }, // Intersection Ashgar & Abu Nour
    'a3': { lat: 30.0942, lng: 31.3185 },
  
    // Abu Nour St
    'b1': { lat: 30.0950, lng: 31.3120 },
    'b2': { lat: 30.0940, lng: 31.3145 },
  
    // Noweiry St
    'w2': { lat: 30.0958, lng: 31.3180 },
    'w3': { lat: 30.0950, lng: 31.3200 }
};
  
  // Bidirectional street graph adjacency
export const ADJACENCY: { [key: string]: string[] } = {
    'k1': ['k2'],
    'k2': ['k1', 'k3'],
    'k3': ['k2', 'k4', 'a2'],
    'k4': ['k3', 'k5', 'm2'],
    'k5': ['k4'],
  
    's1': ['s2', 'b2'],
    's2': ['s1', 's3'],
    's3': ['s2', 's4'],
    's4': ['s3', 'w2'],
  
    'm1': ['m2'],
    'm2': ['m1', 'm3', 'k4'],
    'm3': ['m2', 'm4'],
    'm4': ['m3', 'w3'],
  
    'a2': ['k3', 'a3', 'b2'],
    'a3': ['a2'],
  
    'b1': ['b2'],
    'b2': ['b1', 'a2', 's1'],
  
    'w2': ['s4', 'w3'],
    'w3': ['w2', 'm4']
};
  
export const SEGMENTS: [string, string][] = [
    ['k1', 'k2'], ['k2', 'k3'], ['k3', 'k4'], ['k4', 'k5'],
    ['s1', 's2'], ['s2', 's3'], ['s3', 's4'],
    ['m1', 'm2'], ['m2', 'm3'], ['m3', 'm4'],
    ['k3', 'a2'], ['a2', 'a3'],
    ['b1', 'b2'], ['b2', 'a2'],
    ['s4', 'w2'], ['w2', 'w3'],
    ['s1', 'b2'], ['m2', 'k4'], ['w3', 'm4']
];
  
export function projectPointOnSegment(p: Point, a: Point, b: Point): Point {
    const abLat = b.lat - a.lat;
    const abLng = b.lng - a.lng;
    const apLat = p.lat - a.lat;
    const apLng = p.lng - a.lng;
  
    const abSq = abLat * abLat + abLng * abLng;
    if (abSq === 0) return { ...a };
  
    let t = (apLat * abLat + apLng * abLng) / abSq;
    t = Math.max(0, Math.min(1, t));
  
    return {
      lat: a.lat + t * abLat,
      lng: a.lng + t * abLng
    };
}
  
export function snapToRoadNetwork(p: Point): { point: Point; segment: [string, string]; dist: number } {
    let minPoint = { ...p };
    let minSegment: [string, string] = ['k1', 'k2'];
    let minDist = Infinity;
  
    for (const seg of SEGMENTS) {
      const a = GRAPH_NODES[seg[0]];
      const b = GRAPH_NODES[seg[1]];
      if (!a || !b) continue;
  
      const projected = projectPointOnSegment(p, a, b);
      const dist = Math.pow(p.lat - projected.lat, 2) + Math.pow(p.lng - projected.lng, 2);
      if (dist < minDist) {
        minDist = dist;
        minPoint = projected;
        minSegment = seg;
      }
    }
  
    return { point: minPoint, segment: minSegment, dist: Math.sqrt(minDist) };
}
  
export function findNearestNodeId(pt: Point): string {
    let minNode = 'k1';
    let minDist = Infinity;
    for (const [id, nodePt] of Object.entries(GRAPH_NODES)) {
      const dist = Math.sqrt(Math.pow(pt.lat - nodePt.lat, 2) + Math.pow(pt.lng - nodePt.lng, 2));
      if (dist < minDist) {
        minDist = dist;
        minNode = id;
      }
    }
    return minNode;
}
  
export function findShortestPath(startId: string, endId: string): string[] {
    if (startId === endId) return [startId];
    const queue: string[] = [startId];
    const visited = new Set<string>([startId]);
    const parent: { [key: string]: string } = {};
  
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === endId) {
        const path: string[] = [];
        let curr = endId;
        while (curr !== startId) {
          path.push(curr);
          curr = parent[curr];
        }
        path.push(startId);
        return path.reverse();
      }
  
      const neighbors = ADJACENCY[current] || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent[neighbor] = current;
          queue.push(neighbor);
        }
      }
    }
  
    return [];
}
  
export async function getGoogleMapsRoute(stops: Point[], apiKey: string): Promise<Point[]> {
    if (stops.length < 2) return stops;
  
    const origin = stops[0];
    const destination = stops[stops.length - 1];
    const intermediates = stops.slice(1, -1);
  
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.legs.polyline.encodedPolyline'
      },
      body: JSON.stringify({
        origin: { location: { latLng: origin } },
        destination: { location: { latLng: destination } },
        intermediates: intermediates.map(stop => ({ location: { latLng: stop } })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        departureTime: new Date().toISOString(),
        computeAlternativeRoutes: false,
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'ENCODED_POLYLINE'
      })
    });
  
    if (!response.ok) {
      console.error('Google Maps route request failed:', response.status, response.statusText);
      return [];
    }
  
    const data = await response.json();
  
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];

      // Try the top-level route polyline first (works for single-leg routes)
      if (route.polyline?.encodedPolyline) {
        return decode(route.polyline.encodedPolyline).map(([lat, lng]) => ({ lat, lng }));
      }

      // For multi-stop routes, stitch together each leg polyline in order
      if (route.legs && route.legs.length > 0) {
        const stitched: {lat: number; lng: number}[] = [];
        for (const leg of route.legs) {
          if (leg.polyline?.encodedPolyline) {
            const pts = decode(leg.polyline.encodedPolyline).map(([lat, lng]) => ({ lat, lng }));
            // Avoid duplicating the junction point between legs
            const start = stitched.length > 0 ? 1 : 0;
            stitched.push(...pts.slice(start));
          }
        }
        if (stitched.length > 0) return stitched;
      }
    }
  
    return [];
}
  
/**
 * Route from snapped S1 to snapped S2 strictly along street segments.
 */
function getStreetRoutedPath(from: Point, to: Point): Point[] {
    const snapFrom = snapToRoadNetwork(from);
    const snapTo = snapToRoadNetwork(to);
  
    const S1 = snapFrom.point;
    const S2 = snapTo.point;
  
    // If S1 and S2 are practically identical, return just one point
    if (Math.abs(S1.lat - S2.lat) < 0.00001 && Math.abs(S1.lng - S2.lng) < 0.00001) {
      return [S1];
    }
  
    // If they are on the same road segment
    const seg1 = snapFrom.segment;
    const seg2 = snapTo.segment;
    const isSameSeg = (seg1[0] === seg2[0] && seg1[1] === seg2[1]) || (seg1[0] === seg2[1] && seg1[1] === seg2[0]);
  
    if (isSameSeg) {
      return [S1, S2];
    }
  
    // Find nearest intersections to route along the street network
    const N1 = findNearestNodeId(S1);
    const N2 = findNearestNodeId(S2);
  
    const path: Point[] = [S1];
  
    if (N1 === N2) {
      const ptN1 = GRAPH_NODES[N1];
      if (ptN1) {
        path.push(ptN1);
      }
    } else {
      const nodePath = findShortestPath(N1, N2);
      if (nodePath.length > 0) {
        nodePath.forEach(nodeId => {
          const pt = GRAPH_NODES[nodeId];
          if (pt) {
            const last = path[path.length - 1];
            if (!last || Math.abs(last.lat - pt.lat) > 0.00001 || Math.abs(last.lng - pt.lng) > 0.00001) {
              path.push(pt);
            }
          }
        });
      }
    }
  
    // Finally append S2
    const last = path[path.length - 1];
    if (!last || Math.abs(last.lat - S2.lat) > 0.00001 || Math.abs(last.lng - S2.lng) > 0.00001) {
      path.push(S2);
    }
  
    return path;
}
  
/**
 * Computes a high-resolution path of coordinate points between a list of stops.
 * Snaps consecutive stops to the Heliopolis/Roxy street grid and finds the street path.
 */
function getOfflineRoutePath(stops: Point[]): Point[] {
    if (stops.length === 0) return [];
    if (stops.length === 1) {
      const snap = snapToRoadNetwork(stops[0]);
      return [snap.point];
    }
  
    const finalPath: Point[] = [];
  
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to = stops[i + 1];
  
      const subPath = getStreetRoutedPath(from, to);
      subPath.forEach((pt) => {
        if (finalPath.length === 0) {
          finalPath.push(pt);
        } else {
          const last = finalPath[finalPath.length - 1];
          if (Math.abs(last.lat - pt.lat) > 0.00001 || Math.abs(last.lng - pt.lng) > 0.00001) {
            finalPath.push(pt);
          }
        }
      });
    }
  
    return finalPath;
}
  
/**
 * Computes a high-resolution path of coordinate points between a list of stops.
 * This function will use the Google Maps Routes API if an API key is provided,
 * otherwise it will fall back to the local offline routing.
 */
export async function getHighResolutionRoutePath(
    stops: Point[],
    apiKey?: string
): Promise<Point[]> {
    if (apiKey) {
      try {
        const googleMapsPath = await getGoogleMapsRoute(stops, apiKey);
        if (googleMapsPath.length > 0) {
          return googleMapsPath;
        }
      } catch (error) {
        console.error("Failed to fetch route from Google Maps, falling back to offline routing.", error);
      }
    }
    return getOfflineRoutePath(stops);
}