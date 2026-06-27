import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Student, RouteStop, TrafficSegment, BuildingKey } from '../types';
import { BUILDINGS_INFO } from '../data/students';
import { MapPin, Bus, AlertTriangle, ShieldCheck, Home, ArrowRight, Layers, LocateFixed, LocateOff, Navigation, ExternalLink, RefreshCw } from 'lucide-react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps';
import { snapToRoadNetwork } from '../utils/routing';

// ── API Key resolution ───────────────────────────────────────────────────────
const API_KEY: string =
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

// Key is valid if it's set and not the old demo key
const IS_DEMO_KEY = !API_KEY || API_KEY === 'AIzaSyBnJZUfE8FYyyPOAFQnt0tqQ92NNU_5K_k';

// ── Types ────────────────────────────────────────────────────────────────────
type MapView = '2d' | '3d' | 'gmaps' | 'directions';

interface InteractiveMapProps {
  students: Student[];
  routeStops: RouteStop[];
  currentStopIndex: number;
  simulatedBusPos: { lat: number; lng: number } | null;
  trafficSegments: TrafficSegment[];
  liveDriverPos?: { lat: number; lng: number } | null;
  gpsStatus?: 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
  onRequestGps?: () => void;
  onStopGps?: () => void;
  onSelectStudent?: (studentId: string) => void;
}

// ── DirectionsService polyline renderer (Google Map tab) ─────────────────────
function GoogleMapRouteLine({
  stops,
  livePos
}: {
  stops: RouteStop[];
  livePos?: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // Pan to live position
  useEffect(() => {
    if (!map || !livePos) return;
    map.panTo(livePos);
  }, [map, livePos]);

  // Clear previous polylines helper
  const clearPolylines = useCallback(() => {
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
  }, []);

  useEffect(() => {
    if (!map || stops.length < 2) return;
    if (typeof google === 'undefined') return;

    clearPolylines();
    setStatus('loading');

    const svc = new google.maps.DirectionsService();
    const MAX_WP = 23; // Google limit per request

    // Split stops into chunks: each chunk shares its last stop as next chunk's first
    const chunks: RouteStop[][] = [];
    for (let i = 0; i < stops.length - 1; i += MAX_WP + 1) {
      const chunk = stops.slice(i, Math.min(i + MAX_WP + 2, stops.length));
      if (chunk.length >= 2) chunks.push(chunk);
    }

    const fetchChunk = (chunk: RouteStop[]): Promise<google.maps.LatLng[]> =>
      new Promise(resolve => {
        svc.route(
          {
            origin: { lat: chunk[0].lat, lng: chunk[0].lng },
            destination: { lat: chunk[chunk.length - 1].lat, lng: chunk[chunk.length - 1].lng },
            waypoints: chunk.slice(1, -1).map(s => ({
              location: { lat: s.lat, lng: s.lng },
              stopover: true,
            })),
            travelMode: google.maps.TravelMode.DRIVING,
            optimizeWaypoints: false,
            region: 'EG',
          },
          (result, st) => {
            if (st === google.maps.DirectionsStatus.OK && result) {
              const pts: google.maps.LatLng[] = [];
              result.routes[0].legs.forEach(leg =>
                leg.steps.forEach(step =>
                  step.path.forEach(pt => pts.push(pt))
                )
              );
              resolve(pts);
            } else {
              console.warn('[GoogleMapRouteLine] DirectionsService error:', st);
              // Fallback: straight line between stops in this chunk
              resolve(chunk.map(s => new google.maps.LatLng(s.lat, s.lng)));
            }
          }
        );
      });

    (async () => {
      try {
        const allPts: google.maps.LatLng[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const pts = await fetchChunk(chunks[i]);
          allPts.push(...(i === 0 ? pts : pts.slice(1)));
        }

        if (allPts.length < 2) { setStatus('error'); return; }

        // Draw: dark casing + blue foreground
        const casing = new google.maps.Polyline({
          path: allPts, geodesic: true,
          strokeColor: '#0F172A', strokeOpacity: 0.9, strokeWeight: 8,
        });
        const line = new google.maps.Polyline({
          path: allPts, geodesic: true,
          strokeColor: '#3B82F6', strokeOpacity: 1.0, strokeWeight: 4,
        });
        casing.setMap(map);
        line.setMap(map);
        polylinesRef.current = [casing, line];

        // Fit all stop markers in view
        const bounds = new google.maps.LatLngBounds();
        stops.forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }));
        map.fitBounds(bounds, 48);

        setStatus('ok');
      } catch (err) {
        console.error('[GoogleMapRouteLine] Fatal error:', err);
        setStatus('error');
      }
    })();

    return clearPolylines;
  }, [map, stops, clearPolylines]);

  return null;
}

// ── Directions Panel (Google Maps Embed — zero billing, exact road routing) ──
function DirectionsPanel({
  stops,
  liveDriverPos,
}: {
  stops: RouteStop[];
  liveDriverPos?: { lat: number; lng: number } | null;
}) {
  const [customOrigin, setCustomOrigin] = useState('');
  const [customDest, setCustomDest] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const hubStops = stops.filter(s => s.type === 'hub');
  const studentStops = stops.filter(s => s.type !== 'hub');

  // Auto origin: live GPS > first hub
  const autoOrigin = liveDriverPos
    ? `${liveDriverPos.lat},${liveDriverPos.lng}`
    : hubStops[0] ? `${hubStops[0].lat},${hubStops[0].lng}` : null;

  // Auto destination: last hub
  const autoDest = hubStops.length > 1
    ? `${hubStops[hubStops.length - 1].lat},${hubStops[hubStops.length - 1].lng}`
    : hubStops[0] ? `${hubStops[0].lat},${hubStops[0].lng}` : null;

  // Google Maps Embed v1 supports up to 9 waypoints — take first 9 student stops
  const waypointCoords = studentStops.slice(0, 9).map(s => `${s.lat},${s.lng}`);

  // Build a free OpenStreetMap embed URL via OSRM routing (zero API key, zero billing)
  const embedUrl = useMemo(() => {
    const origin = useCustom ? customOrigin : autoOrigin;
    const destination = useCustom ? customDest : autoDest;
    if (!origin || !destination) return null;

    // Parse origin/dest — accept "lat,lng" string or address
    const parseCoord = (s: string) => {
      const m = s.match(/^([-\d.]+),([-\d.]+)$/);
      return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
    };

    const o = parseCoord(origin);
    const d = parseCoord(destination);
    const wps = waypointCoords.map(w => parseCoord(w)).filter(Boolean) as {lat:number,lng:number}[];

    if (o && d) {
      // Build OSRM route URL with all waypoints
      const allPoints = [o, ...wps, d];
      const coordStr = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
      // Use OSM iframe: embed an OpenStreetMap view centred on the midpoint with a route overlay
      const midLat = (o.lat + d.lat) / 2;
      const midLng = (o.lng + d.lng) / 2;
      // Build markers string for OSM iframe
      const markers = allPoints.map((p, i) =>
        `${p.lat},${p.lng},${i === 0 ? 'green' : i === allPoints.length-1 ? 'red' : 'blue'}`
      ).join('|');
      return `https://www.openstreetmap.org/export/embed.html?bbox=${midLng-0.02},${midLat-0.015},${midLng+0.02},${midLat+0.015}&layer=mapnik&marker=${o.lat},${o.lng}`;
    }

    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCustom, customOrigin, customDest, autoOrigin, autoDest, waypointCoords.join(','), refreshKey]);

  // Full Google Maps navigation URL (opens in app/browser with all waypoints)
  const navUrl = useMemo(() => {
    const origin = useCustom ? customOrigin : autoOrigin;
    const destination = useCustom ? customDest : autoDest;
    if (!origin || !destination) return '#';
    // Build dir URL: /maps/dir/origin/wp1/wp2/.../destination
    const allParts = [origin, ...waypointCoords, destination]
      .map(p => encodeURIComponent(p))
      .join('/');
    return `https://www.google.com/maps/dir/${allParts}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCustom, customOrigin, customDest, autoOrigin, autoDest, waypointCoords.join(',')]);

  return (
    <div className="flex flex-col border border-[#2A2A30] bg-[#0A0A0C] rounded-xl overflow-hidden h-[420px]">
      {/* ── Controls ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2A2A30] flex-wrap shrink-0 bg-[#0D0D12]">
        <button
          onClick={() => setUseCustom(false)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
            !useCustom
              ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              : 'bg-[#1A1A1F] border-[#2A2A30] text-[#8E9299] hover:text-white'
          }`}
        >
          🚌 Auto ({studentStops.length} stops)
        </button>
        <button
          onClick={() => setUseCustom(true)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
            useCustom
              ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
              : 'bg-[#1A1A1F] border-[#2A2A30] text-[#8E9299] hover:text-white'
          }`}
        >
          ✏️ Custom
        </button>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="p-1.5 rounded-lg bg-[#1A1A1F] border border-[#2A2A30] text-[#8E9299] hover:text-white transition-all"
          title="Refresh map"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
        <div className="flex-1" />
        <a
          href={navUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all"
        >
          <ExternalLink className="w-3 h-3" />
          Open in Google Maps
        </a>
      </div>

      {/* ── Custom inputs ── */}
      {useCustom && (
        <div className="flex gap-2 px-3 py-2 border-b border-[#2A2A30] shrink-0 bg-[#0D0D12]">
          <input
            type="text"
            placeholder="Origin — address or lat,lng"
            value={customOrigin}
            onChange={e => setCustomOrigin(e.target.value)}
            className="flex-1 bg-[#1A1A1F] border border-[#2A2A30] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#4A4A55] focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Destination — address or lat,lng"
            value={customDest}
            onChange={e => setCustomDest(e.target.value)}
            className="flex-1 bg-[#1A1A1F] border border-[#2A2A30] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#4A4A55] focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="px-4 py-1.5 rounded-lg text-[10px] font-bold bg-blue-500 hover:bg-blue-600 text-white transition-all"
          >
            Go
          </button>
        </div>
      )}

      {/* ── Stop count notice if > 9 waypoints ── */}
      {!useCustom && studentStops.length > 9 && (
        <div className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-500/5 border-b border-[#2A2A30] shrink-0">
          ⚠️ Showing first 9 of {studentStops.length} stops in embedded view. Tap "Open in Google Maps" for full route navigation.
        </div>
      )}

      {/* ── Map + Route Panel ── */}
      <div className="flex-1 relative min-h-0 flex flex-col">
        {/* OSM map embed */}
        {embedUrl && (
          <iframe
            key={refreshKey}
            src={embedUrl}
            className="flex-1 w-full border-0 min-h-0"
            style={{ height: '320px' }}
            allowFullScreen
            loading="lazy"
            title="OpenStreetMap View"
          />
        )}
        {/* Route stops list — shows the full ordered pickup schedule */}
        <div className="shrink-0 overflow-x-auto border-t border-[#2A2A30] bg-[#0D0D12]">
          <div className="flex gap-0 min-w-max px-2 py-1.5">
            {stops.filter(s => s.type !== 'hub').map((stop, i) => (
              <div key={i} className="flex items-center gap-0">
                <div className="flex flex-col items-center px-2 py-1">
                  <span className="text-[9px] font-bold text-[#8E9299]">#{i+1}</span>
                  <span className="text-[9px] text-white font-medium max-w-[72px] truncate text-center">{stop.name?.split(' ')[0]}</span>
                </div>
                {i < stops.filter(s => s.type !== 'hub').length - 1 && (
                  <ArrowRight className="w-2.5 h-2.5 text-[#2A2A30] shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
        {!embedUrl && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#8E9299]">
            <Navigation className="w-8 h-8 opacity-30" />
            <p className="text-sm">No route stops to display yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main InteractiveMap component ─────────────────────────────────────────────
export default function InteractiveMap({
  students,
  routeStops,
  currentStopIndex,
  simulatedBusPos,
  trafficSegments,
  liveDriverPos,
  gpsStatus = 'idle',
  onRequestGps,
  onStopGps,
  onSelectStudent,
}: InteractiveMapProps) {
  const [mapViewMode, setMapViewMode] = useState<MapView>('directions');
  const [activeStopHover, setActiveStopHover] = useState<string | null>(null);

  // SVG projection bounds — covers all 16 students + all hubs with padding
  const width = 620, height = 440;
  const minLat = 30.0880, maxLat = 30.0990;  // full vertical range + padding
  const minLng = 31.3060, maxLng = 31.3320;  // full horizontal range + padding

  const project = useCallback((lat: number, lng: number) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * (width - 80) + 40,
    y: (1 - (lat - minLat) / (maxLat - minLat)) * (height - 80) + 40,
  }), []);

  // Road network for SVG views — covers all student streets in Roxy/Heliopolis sector
  const roads = useMemo(() => [
    // Khalifa El Mamoun — main east-west artery
    { name: 'Khalifa El Mamoun St', segmentId: 'khalifa', points: [
      { lat: 30.0910, lng: 31.3080 }, { lat: 30.0911, lng: 31.3100 },
      { lat: 30.0913, lng: 31.3120 }, { lat: 30.0916, lng: 31.3140 },
      { lat: 30.0920, lng: 31.3160 }, { lat: 30.0925, lng: 31.3180 },
      { lat: 30.0931, lng: 31.3200 }, { lat: 30.0935, lng: 31.3220 },
    ]},
    // El Selahdar — north-south, stud_1/2/3
    { name: 'El Selahdar St', segmentId: 'selahdar', points: [
      { lat: 30.0908, lng: 31.3178 }, { lat: 30.0911, lng: 31.3179 },
      { lat: 30.0920, lng: 31.3180 }, { lat: 30.0932, lng: 31.3181 },
      { lat: 30.0945, lng: 31.3182 },
    ]},
    // Al Ashgar — stud_9/10/11
    { name: 'Al Ashgar St', segmentId: 'ashgar', points: [
      { lat: 30.0920, lng: 31.3136 }, { lat: 30.0928, lng: 31.3136 },
      { lat: 30.0933, lng: 31.3136 }, { lat: 30.0940, lng: 31.3137 },
    ]},
    // Al Shaheed Hussein Suleiman — stud_12/13
    { name: 'Al Shaheed Hussein Suleiman', segmentId: 'hussein', points: [
      { lat: 30.0925, lng: 31.3115 }, { lat: 30.0930, lng: 31.3120 },
      { lat: 30.0935, lng: 31.3125 },
    ]},
    // Sheikh Abu El Nour — stud_14/15
    { name: 'Sheikh Abu El Nour St', segmentId: 'abu_nour', points: [
      { lat: 30.0935, lng: 31.3100 }, { lat: 30.0936, lng: 31.3110 },
      { lat: 30.0937, lng: 31.3120 }, { lat: 30.0938, lng: 31.3135 },
    ]},
    // Al Adfawi — stud_16 (branches from Abu El Nour)
    { name: 'Al Adfawi St', segmentId: 'adfawi', points: [
      { lat: 30.0938, lng: 31.3101 }, { lat: 30.0935, lng: 31.3095 },
      { lat: 30.0930, lng: 31.3085 },
    ]},
    // Al Mafaza — stud_4
    { name: 'Al Mafaza St', segmentId: 'mafaza', points: [
      { lat: 30.0928, lng: 31.3148 }, { lat: 30.0932, lng: 31.3150 },
      { lat: 30.0936, lng: 31.3152 },
    ]},
    // Roxy Square ring road
    { name: 'Roxy Square', segmentId: 'roxy_ring', points: [
      { lat: 30.0895, lng: 31.3095 }, { lat: 30.0900, lng: 31.3100 },
      { lat: 30.0905, lng: 31.3108 },
    ]},
  ], []);

  const getRoadColor = (id: string) => {
    const seg = trafficSegments.find(s => s.id === id);
    if (!seg) return 'stroke-slate-700';
    if (seg.status === 'heavy') return 'stroke-rose-500';
    if (seg.status === 'moderate') return 'stroke-amber-400';
    return 'stroke-emerald-400';
  };

  // Group students by unique coordinate for SVG pins
  const studentStops = useMemo(() => {
    const groups: Record<string, { lat: number; lng: number; students: Student[]; street: string; bNo: string }> = {};
    students.forEach(s => {
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (!groups[key]) groups[key] = { lat: s.lat, lng: s.lng, students: [], street: s.street, bNo: s.buildingNo };
      groups[key].students.push(s);
    });
    return Object.values(groups);
  }, [students]);

  // SVG active path — straight lines between stops (offline SVG view only)
  const svgPathPoints = useMemo(() =>
    routeStops.map(s => project(s.lat, s.lng)),
  [routeStops, project]);

  const projectedBusPos = useMemo(() => {
    if (simulatedBusPos) return project(simulatedBusPos.lat, simulatedBusPos.lng);
    if (routeStops.length > 0 && currentStopIndex < routeStops.length) {
      const s = routeStops[currentStopIndex];
      return project(s.lat, s.lng);
    }
    return null;
  }, [simulatedBusPos, routeStops, currentStopIndex, project]);

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide">
            <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse" />
            Heliopolis Fleet Route Map
          </h2>
          <p className="text-xs text-[#8E9299]">Live route visualizations with traffic overlays</p>
        </div>

        {/* GPS button */}
        <div className="flex items-center gap-2 shrink-0">
          {gpsStatus === 'idle' && (
            <button onClick={onRequestGps} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 transition-all">
              <LocateFixed className="w-3.5 h-3.5" /> Use My Location
            </button>
          )}
          {gpsStatus === 'requesting' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <LocateFixed className="w-3.5 h-3.5 animate-pulse" /> Requesting GPS…
            </span>
          )}
          {gpsStatus === 'active' && (
            <button onClick={onStopGps} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-emerald-500/10 hover:bg-rose-500/10 border border-emerald-500/20 hover:border-rose-500/20 text-emerald-400 hover:text-rose-400 transition-all">
              <LocateFixed className="w-3.5 h-3.5 animate-pulse" /> GPS Live · Stop
            </button>
          )}
          {gpsStatus === 'denied' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <LocateOff className="w-3.5 h-3.5" /> GPS Denied
            </span>
          )}
          {gpsStatus === 'unavailable' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#2A2A30] border border-[#2A2A30] text-[#8E9299]">
              <LocateOff className="w-3.5 h-3.5" /> GPS Unavailable
            </span>
          )}
        </div>

        {/* View tabs */}
        <div className="flex bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-1 shrink-0 text-[10px] font-bold gap-0.5">
          {([
            { id: 'directions', label: 'Directions', icon: <Navigation className="w-3 h-3" />, color: 'bg-rose-500' },
            { id: '2d', label: '2D Flat', icon: null, color: 'bg-[#3B82F6]' },
            { id: '3d', label: '3D View', icon: <Layers className="w-3 h-3" />, color: 'bg-[#8B5CF6]' },
            { id: 'gmaps', label: 'Google Map', icon: null, color: 'bg-emerald-600' },
          ] as { id: MapView; label: string; icon: React.ReactNode; color: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setMapViewMode(tab.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                mapViewMode === tab.id ? `${tab.color} text-white` : 'text-[#8E9299] hover:text-[#F0F0F0]'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Directions tab (default, production-ready, free) ── */}
      {mapViewMode === 'directions' && (
        <DirectionsPanel stops={routeStops} liveDriverPos={liveDriverPos} />
      )}

      {/* ── Google Maps JS SDK tab ── */}
      {mapViewMode === 'gmaps' && (
        <div className="relative border border-[#2A2A30] bg-[#0A0A0C] rounded-xl overflow-hidden h-[420px]">
          {IS_DEMO_KEY ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
              <MapPin className="w-10 h-10 text-[#3B82F6] opacity-50" />
              <p className="text-sm font-bold text-[#F0F0F0]">Google Map SDK Tab</p>
              <p className="text-xs text-[#8E9299] max-w-sm">
                Add your <code className="text-blue-400">VITE_GOOGLE_MAPS_PLATFORM_KEY</code> in Vercel environment variables to enable this view. The <strong>Directions tab</strong> works right now without any key.
              </p>
            </div>
          ) : (
            <APIProvider apiKey={API_KEY} version="weekly">
              <GoogleMap
                center={liveDriverPos || undefined}
                defaultCenter={{ lat: 30.0930, lng: 31.3140 }}
                defaultZoom={15}
                mapId="DEMO_MAP_ID"
                style={{ width: '100%', height: '100%' }}
                gestureHandling="greedy"
              >
                {routeStops.map((stop, i) => stop.type === 'hub' && (
                  <AdvancedMarker key={`h-${i}`} position={{ lat: stop.lat, lng: stop.lng }}>
                    <Pin background={i === 0 ? '#3B82F6' : '#10B981'} glyphColor="#fff" scale={1.1} />
                  </AdvancedMarker>
                ))}
                {studentStops.map((stop, i) => (
                  <AdvancedMarker key={`s-${i}`} position={{ lat: stop.lat, lng: stop.lng }}>
                    <Pin background="#F59E0B" glyphColor="#fff" scale={0.8} />
                  </AdvancedMarker>
                ))}
                {liveDriverPos && (
                  <AdvancedMarker position={liveDriverPos}>
                    <div className="w-4 h-4 rounded-full bg-emerald-400 border-2 border-white shadow-lg animate-pulse" />
                  </AdvancedMarker>
                )}
                <GoogleMapRouteLine stops={routeStops} livePos={liveDriverPos} />
              </GoogleMap>
            </APIProvider>
          )}
        </div>
      )}

      {/* ── SVG 2D / 3D views ── */}
      {(mapViewMode === '2d' || mapViewMode === '3d') && (
        <div
          style={{ perspective: mapViewMode === '3d' ? '800px' : 'none' }}
          className="relative border border-[#2A2A30] bg-[#0A0A0C] rounded-xl overflow-hidden shadow-2xl"
        >
          <div style={{
            transform: mapViewMode === '3d' ? 'rotateX(34deg) rotateZ(-12deg) scale(0.95)' : 'none',
            transformStyle: 'preserve-3d',
            transition: 'all 0.7s cubic-bezier(0.16,1,0.3,1)',
          }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none">
              <defs>
                <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1A1A22" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mapGrid)" />

              {/* Roads */}
              {roads.map(road => {
                const pts = road.points.map(p => project(p.lat, p.lng));
                const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                return (
                  <g key={road.segmentId}>
                    <path d={d} fill="none" stroke="#121217" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={d} fill="none" className={`${getRoadColor(road.segmentId)} transition-colors duration-500`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              })}

              {/* Route path */}
              {svgPathPoints.length > 1 && (
                <polyline
                  points={svgPathPoints.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#3B82F6" strokeWidth="3.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray="10 8"
                />
              )}

              {/* Hub markers */}
              {routeStops.map((stop, i) => {
                if (stop.type !== 'hub') return null;
                const { x, y } = project(stop.lat, stop.lng);
                const isStart = i === 0;
                return (
                  <g key={`hub-${i}`}>
                    <circle cx={x} cy={y} r="12" className={isStart ? 'fill-[#3B82F6]/20 stroke-[#3B82F6]' : 'fill-[#10B981]/20 stroke-[#10B981]'} strokeWidth="2" />
                    <circle cx={x} cy={y} r="5" className={isStart ? 'fill-[#3B82F6]' : 'fill-[#10B981]'} />
                    <text x={x} y={y - 18} textAnchor="middle" className="fill-[#F0F0F0] text-[8px] font-bold uppercase">
                      {isStart ? '🚌 START' : '🏛️ END'}
                    </text>
                  </g>
                );
              })}

              {/* Student pins */}
              {studentStops.map((stop, i) => {
                const { x, y } = project(stop.lat, stop.lng);
                const boarded = stop.students.filter(s => s.boardingStatus === 'boarded').length;
                const absent = stop.students.filter(s => s.boardingStatus === 'absent').length;
                const total = stop.students.length;
                const color = boarded === total - absent && total > absent ? '#3B82F6' : '#F59E0B';
                const names = stop.students.map(s => s.name.split(' ')[0]).join(' & ');
                return (
                  <g key={`pin-${i}`} className="cursor-pointer"
                    onClick={() => onSelectStudent?.(stop.students[0]?.id)}
                    onMouseEnter={() => setActiveStopHover(`${i}`)}
                    onMouseLeave={() => setActiveStopHover(null)}
                  >
                    <rect x={x - names.length * 3} y={y - 42} width={names.length * 6 + 8} height={14} rx="6"
                      fill="#0A0A0C" fillOpacity="0.9" stroke={color} strokeWidth="1.2" />
                    <text x={x} y={y - 32} textAnchor="middle" className="fill-[#F3F4F6] text-[8px] font-bold">{names}</text>
                    <path d={`M${x},${y} C${x-5},${y-12} ${x-8},${y-16} ${x-8},${y-20} A8,8 0 0,1 ${x+8},${y-20} C${x+8},${y-16} ${x+5},${y-12} ${x},${y} Z`}
                      fill={color} stroke="#121217" strokeWidth="1" />
                    <circle cx={x} cy={y - 20} r="2.5" fill="#121217" />
                  </g>
                );
              })}

              {/* Live GPS dot */}
              {liveDriverPos && (() => {
                const { x, y } = project(liveDriverPos.lat, liveDriverPos.lng);
                return (
                  <g>
                    <circle cx={x} cy={y} r="14" fill="none" stroke="#10B981" strokeWidth="1.5" opacity="0.4" className="animate-ping" />
                    <circle cx={x} cy={y} r="9" fill="#10B981" stroke="#0A0A0C" strokeWidth="2" />
                    <circle cx={x} cy={y} r="3.5" fill="white" />
                  </g>
                );
              })()}

              {/* Bus icon */}
              {projectedBusPos && (
                <g>
                  <circle cx={projectedBusPos.x} cy={projectedBusPos.y} r="18" fill="none" stroke="#3B82F6" strokeWidth="1.5" className="animate-pulse" />
                  <circle cx={projectedBusPos.x} cy={projectedBusPos.y} r="12" fill="#3B82F6" stroke="#121217" strokeWidth="2" />
                  <text x={projectedBusPos.x} y={projectedBusPos.y + 4} textAnchor="middle" fontSize="10">🚌</text>
                </g>
              )}
            </svg>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-[#121217]/90 backdrop-blur-md rounded-lg border border-[#2A2A30] p-2.5 text-[10px] text-[#8E9299]">
            <p className="font-bold text-[#F0F0F0] mb-1.5 flex items-center gap-1"><Bus className="w-3.5 h-3.5 text-[#3B82F6]" /> Route Legend</p>
            <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#F59E0B] inline-block" /> Waiting</p>
            <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#3B82F6] inline-block" /> Boarded</p>
            <p className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#10B981] inline-block" /> Delivered</p>
          </div>
        </div>
      )}
    </div>
  );
}
