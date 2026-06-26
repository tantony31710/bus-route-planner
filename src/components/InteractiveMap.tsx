import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Student, RouteStop, TrafficSegment, BuildingKey } from '../types';
import { BUILDINGS_INFO } from '../data/students';
import { MapPin, Bus, AlertTriangle, ShieldCheck, Home, ArrowRight, Layers, HelpCircle, Key, LocateFixed, LocateOff } from 'lucide-react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps';
import { getHighResolutionRoutePath, snapToRoadNetwork } from '../utils/routing';

// Read API key from environment, fallback to the provided demo key
const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  'AIzaSyBnJZUfE8FYyyPOAFQnt0tqQ92NNU_5K_k';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY' && API_KEY !== '';

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

// Custom polyline renderer for Google Maps tab
function GoogleMapRouteLine({ stops, livePos }: { stops: RouteStop[]; livePos?: { lat: number; lng: number } | null }) {
  const map = useMap();
  const [pathCoords, setPathCoords] = useState<any[]>([]);

  // Pan map to live driver position when it updates
  useEffect(() => {
    if (!map || !livePos) return;
    map.panTo(livePos);
  }, [map, livePos]);

  useEffect(() => {
    if (!map || stops.length < 2) return;

    // Use the JS SDK DirectionsService — works with demo/free API keys,
    // no billing required, snaps to real roads automatically.
    const directionsService = new google.maps.DirectionsService();

    const origin = stops[0];
    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(1, -1).map(s => ({
      location: new google.maps.LatLng(s.lat, s.lng),
      stopover: true
    }));

    // DirectionsService allows max 25 waypoints total (origin + dest + 23 stops).
    // If we exceed that, chunk the stops into batches and stitch the paths.
    const MAX_WAYPOINTS = 23;

    const fetchChunk = (chunkStops: RouteStop[]): Promise<google.maps.LatLng[]> => {
      return new Promise((resolve) => {
        const wps = chunkStops.slice(1, -1).map(s => ({
          location: new google.maps.LatLng(s.lat, s.lng),
          stopover: true
        }));
        directionsService.route({
          origin: new google.maps.LatLng(chunkStops[0].lat, chunkStops[0].lng),
          destination: new google.maps.LatLng(chunkStops[chunkStops.length - 1].lat, chunkStops[chunkStops.length - 1].lng),
          waypoints: wps,
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: false,
        }, (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            const pts: google.maps.LatLng[] = [];
            result.routes[0].legs.forEach(leg => {
              leg.steps.forEach(step => {
                step.path.forEach(pt => pts.push(pt));
              });
            });
            resolve(pts);
          } else {
            console.warn('DirectionsService chunk failed:', status);
            // Fall back to straight lines for this chunk
            resolve(chunkStops.map(s => new google.maps.LatLng(s.lat, s.lng)));
          }
        });
      });
    };

    const run = async () => {
      // Split stops into chunks of MAX_WAYPOINTS + 2 (origin/dest)
      const chunkSize = MAX_WAYPOINTS + 2;
      const chunks: RouteStop[][] = [];
      for (let i = 0; i < stops.length - 1; i += MAX_WAYPOINTS + 1) {
        chunks.push(stops.slice(i, Math.min(i + chunkSize, stops.length)));
        if (chunks[chunks.length - 1].length < 2) chunks.pop();
      }
      if (chunks.length === 0) chunks.push(stops);

      const allPts: google.maps.LatLng[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const pts = await fetchChunk(chunks[i]);
        // Skip first point of subsequent chunks to avoid duplicating junction
        const start = i > 0 ? 1 : 0;
        allPts.push(...pts.slice(start));
      }
      setPathCoords(allPts);
    };

    run();

  }, [map, stops]);

  useEffect(() => {
    if (pathCoords.length === 0) return;

    const polylineBg = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: '#0F172A',
      strokeOpacity: 0.85,
      strokeWeight: 7.5,
    });

    const polylineFg = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: '#3B82F6',
      strokeOpacity: 1.0,
      strokeWeight: 3.5,
    });

    polylineBg.setMap(map);
    polylineFg.setMap(map);

    try {
      const bounds = new google.maps.LatLngBounds();
      stops.map(stop => ({ lat: stop.lat, lng: stop.lng })).forEach(coord => bounds.extend(coord));
      map.fitBounds(bounds);
    } catch (e) {
      console.warn('Could not fit bounds on Map', e);
    }

    return () => {
      polylineBg.setMap(null);
      polylineFg.setMap(null);
    };
  }, [map, pathCoords, stops]);

  return null;
}

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
  onSelectStudent
}: InteractiveMapProps) {
  const [mapViewMode, setMapViewMode] = useState<'2d' | '3d' | 'gmaps'>('2d');
  const [activeStopHover, setActiveStopHover] = useState<string | null>(null);

  // SVG size bounds
  const width = 600;
  const height = 420;

  // Lat/Lng projection bounds based on real coordinates of Heliopolis / Roxy area
  const minLat = 30.0895;
  const maxLat = 30.0985;
  const minLng = 31.3090;
  const maxLng = 31.3205;

  const project = useMemo(() => {
    return (lat: number, lng: number) => {
      // Linear projection with margin
      const x = ((lng - minLng) / (maxLng - minLng)) * (width - 80) + 40;
      const y = (1 - (lat - minLat) / (maxLat - minLat)) * (height - 80) + 40;
      return { x, y };
    };
  }, [minLat, maxLat, minLng, maxLng, width, height]);

  // Major streets drawn as background roads
  const roads = useMemo(() => {
    return [
      {
        name: 'شارع الخليفة المأمون (Khalifa El Mamoun St)',
        points: [
          { lat: 30.0910, lng: 31.3100 },
          { lat: 30.0916, lng: 31.3125 },
          { lat: 30.0922, lng: 31.3150 },
          { lat: 30.0931, lng: 31.3175 },
          { lat: 30.0945, lng: 31.3200 }
        ],
        segmentId: 'khalifa'
      },
      {
        name: 'شارع السلحدار (El Selahdar St)',
        points: [
          { lat: 30.0942, lng: 31.3138 },
          { lat: 30.0950, lng: 31.3142 },
          { lat: 30.0958, lng: 31.3148 },
          { lat: 30.0965, lng: 31.3160 }
        ],
        segmentId: 'selahdar'
      },
      {
        name: 'شارع المقريزي (El Mokrizi St)',
        points: [
          { lat: 30.0900, lng: 31.3150 },
          { lat: 30.0915, lng: 31.3170 },
          { lat: 30.0928, lng: 31.3185 },
          { lat: 30.0938, lng: 31.3200 }
        ],
        segmentId: 'mokrizi'
      },
      {
        name: 'شارع الأشجار (Al Ashgar St)',
        points: [
          { lat: 30.0922, lng: 31.3150 },
          { lat: 30.0935, lng: 31.3165 },
          { lat: 30.0942, lng: 31.3185 }
        ],
        segmentId: 'ashgar'
      },
      {
        name: 'شارع الشيخ أبو النور (Abu El Nour St)',
        points: [
          { lat: 30.0950, lng: 31.3120 },
          { lat: 30.0940, lng: 31.3145 },
          { lat: 30.0935, lng: 31.3165 }
        ],
        segmentId: 'abu_nour'
      },
      {
        name: 'شارع النويري (El Noweiry St)',
        points: [
          { lat: 30.0965, lng: 31.3160 },
          { lat: 30.0958, lng: 31.3180 },
          { lat: 30.0950, lng: 31.3200 }
        ],
        segmentId: 'noweiry'
      }
    ];
  }, []);

  // Helper to get color of road based on traffic segments
  const getRoadColor = (segmentId: string) => {
    const seg = trafficSegments.find(s => s.id === segmentId);
    if (!seg) return 'stroke-slate-200';
    if (seg.status === 'heavy') return 'stroke-rose-500 animate-pulse';
    if (seg.status === 'moderate') return 'stroke-amber-400';
    return 'stroke-emerald-400';
  };

  const getRoadWidth = (segmentId: string) => {
    const seg = trafficSegments.find(s => s.id === segmentId);
    return seg?.status !== 'clear' ? 7 : 5;
  };

  // Group students by unique coordinate stops to show single stop pins
  const studentStops = useMemo(() => {
    const groups: { [key: string]: { lat: number; lng: number; students: Student[]; street: string; bNo: string } } = {};
    students.forEach(s => {
      // Snap coordinates to road network
      const snapped = snapToRoadNetwork({ lat: s.lat, lng: s.lng }).point;
      const key = `${snapped.lat.toFixed(5)},${snapped.lng.toFixed(5)}`;
      if (!groups[key]) {
        groups[key] = {
          lat: snapped.lat,
          lng: snapped.lng,
          students: [],
          street: s.street,
          bNo: s.buildingNo
        };
      }
      groups[key].students.push(s);
    });
    return Object.values(groups);
  }, [students]);

  // Current calculated active path connecting the chosen stop sequence
  const [activePathPoints, setActivePathPoints] = useState<any[]>([]);

  useEffect(() => {
    const rawPoints = routeStops.map(stop => ({ lat: stop.lat, lng: stop.lng }));
    getHighResolutionRoutePath(rawPoints, API_KEY).then(highResPoints => {
      setActivePathPoints(highResPoints.map(p => project(p.lat, p.lng)));
    });
  }, [routeStops, project]);

  // Project bus position if simulated
  const projectedBusPos = useMemo(() => {
    if (simulatedBusPos) {
      return project(simulatedBusPos.lat, simulatedBusPos.lng);
    }
    // Fallback to active stop index
    if (routeStops.length > 0 && currentStopIndex < routeStops.length) {
      const currentStop = routeStops[currentStopIndex];
      const snapped = snapToRoadNetwork({ lat: currentStop.lat, lng: currentStop.lng }).point;
      return project(snapped.lat, snapped.lng);
    }
    return null;
  }, [simulatedBusPos, routeStops, currentStopIndex, project]);

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 id="map-title" className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide font-display">
            <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse"></span>
            Heliopolis Fleet Route Map (3D-Enabled)
          </h2>
          <p className="text-xs text-[#8E9299]">
            Live route visualizations with traffic overlays of Cairo transit sectors
          </p>
        </div>

        {/* GPS Permission Button */}
        <div className="flex items-center gap-2 shrink-0">
          {gpsStatus === 'idle' && (
            <button
              onClick={onRequestGps}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#10B981]/10 hover:bg-[#10B981]/20 border border-[#10B981]/20 text-[#34d399] hover:text-white transition-all"
              title="Use your live GPS location as route start"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              Use My Location
            </button>
          )}
          {gpsStatus === 'requesting' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
              Requesting GPS...
            </span>
          )}
          {gpsStatus === 'active' && (
            <button
              onClick={onStopGps}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-emerald-500/10 hover:bg-rose-500/10 border border-emerald-500/20 hover:border-rose-500/20 text-emerald-400 hover:text-rose-400 transition-all"
              title="Stop using live GPS"
            >
              <LocateFixed className="w-3.5 h-3.5 animate-pulse" />
              GPS Live · Stop
            </button>
          )}
          {gpsStatus === 'denied' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <LocateOff className="w-3.5 h-3.5" />
              GPS Denied
            </span>
          )}
          {gpsStatus === 'unavailable' && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-[#2A2A30] border border-[#2A2A30] text-[#8E9299]">
              <LocateOff className="w-3.5 h-3.5" />
              GPS Unavailable
            </span>
          )}
        </div>

        {/* View Mode Toggle Button Group */}
        <div className="flex bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-1 shrink-0 text-[10px] font-bold">
          <button
            onClick={() => setMapViewMode('2d')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              mapViewMode === '2d'
                ? 'bg-[#3B82F6] text-white'
                : 'text-[#8E9299] hover:text-[#F0F0F0]'
            }`}
          >
            2D Flat
          </button>
          <button
            onClick={() => setMapViewMode('3d')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
              mapViewMode === '3d'
                ? 'bg-[#8B5CF6] text-white shadow'
                : 'text-[#8E9299] hover:text-[#F0F0F0]'
            }`}
          >
            <Layers className="w-3 h-3" />
            3D Isometric
          </button>
          <button
            onClick={() => setMapViewMode('gmaps')}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
              mapViewMode === 'gmaps'
                ? 'bg-emerald-600 text-white'
                : 'text-[#8E9299] hover:text-[#F0F0F0]'
            }`}
          >
            Google Map 3D
          </button>
        </div>
      </div>

      {/* Render Google Map tab when selected */}
      {mapViewMode === 'gmaps' ? (
        <div className="relative border border-[#2A2A30] bg-[#0A0A0C] rounded-xl overflow-hidden h-[420px] shadow-2xl flex items-center justify-center">
          {!hasValidKey ? (
            <div className="p-6 text-center max-w-lg font-sans space-y-4">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-2 animate-pulse">
                <Key className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-[#F0F0F0] uppercase tracking-wider">
                Google Maps Platform Integration
              </h3>
              <p className="text-xs text-[#8E9299] leading-relaxed">
                Connect your key to see this route on a live Google Map overlaid on Heliopolis satellite imagery.
              </p>
              
              {/* Generous Free Tier & Alternative Banner */}
              <div className="bg-[#1A1A22] border border-emerald-500/20 rounded-xl p-3 text-left space-y-1.5 text-xs">
                <h4 className="font-bold text-emerald-400 flex items-center gap-1.5">
                  🛡️ 100% Free Tier Available
                </h4>
                <p className="text-[11px] text-[#8E9299] leading-relaxed">
                  Google provides <strong>$200 in free credits every month</strong> for all Google Cloud accounts (equivalent to ~28,000 map loads/month). Standard development use on free Google Cloud accounts is <strong>completely free</strong> and will never incur charges as long as you stay within the free limit.
                </p>
              </div>

              <div className="bg-[#121217] p-4 rounded-xl border border-[#2A2A30] text-left text-[11px] text-[#8E9299] space-y-2.5">
                <p>
                  <strong>How to set up:</strong>
                </p>
                <p>
                  <strong>Step 1:</strong> Go to the <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noreferrer" className="text-[#3B82F6] hover:underline font-bold">Google Cloud Console</a>, enable the Maps JavaScript API, and generate an API key.
                </p>
                <p>
                  <strong>Step 2:</strong> Click the <strong>Settings</strong> gear (top-right corner of AI Studio) → <strong>Secrets</strong> → add a secret named <code>GOOGLE_MAPS_PLATFORM_KEY</code> with your API key as the value.
                </p>
              </div>

              <div className="p-3 bg-[#3B82F6]/5 border border-[#3B82F6]/15 rounded-xl text-left">
                <p className="text-[11px] text-[#8E9299] leading-relaxed">
                  💡 <strong>No key? No problem!</strong> Use our gorgeous, high-performance custom <strong>2D Flat</strong> and <strong>3D Isometric</strong> vector maps. They are 100% free, offline-capable, and require zero keys or accounts!
                </p>
              </div>
            </div>
          ) : (
            <APIProvider apiKey={API_KEY} version="weekly">
              <GoogleMap
                defaultCenter={liveDriverPos || { lat: 30.0935, lng: 31.3150 }}
                defaultZoom={15}
                mapId="DEMO_MAP_ID"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                style={{ width: '100%', height: '100%' }}
                gestureHandling="greedy"
              >
                {/* Hub Stops */}
                {routeStops.map((stop, index) => {
                  if (stop.type !== 'hub') return null;
                  const isStart = index === 0;
                  const snapped = snapToRoadNetwork({ lat: stop.lat, lng: stop.lng }).point;
                  return (
                    <AdvancedMarker key={`g-hub-${stop.id}-${index}`} position={snapped}>
                      <Pin background={isStart ? '#3B82F6' : '#10B981'} scale={1.1} glyphColor="#fff">
                        {isStart ? '🚌' : '🏛️'}
                      </Pin>
                    </AdvancedMarker>
                  );
                })}

                {/* Student Stops */}
                {studentStops.map((stop, sIdx) => {
                  const names = stop.students.map(s => s.name.split(' ')[0]).join(' & ');
                  const totalAtStop = stop.students.length;
                  const boardedAtStop = stop.students.filter(s => s.boardingStatus === 'boarded').length;
                  const absentAtStop = stop.students.filter(s => s.boardingStatus === 'absent').length;
                  const pinBg = boardedAtStop === totalAtStop - absentAtStop && totalAtStop > absentAtStop ? '#3B82F6' : '#F59E0B';
                  return (
                    <AdvancedMarker key={`g-stud-${sIdx}`} position={{ lat: stop.lat, lng: stop.lng }}>
                      <div className="flex flex-col items-center">
                        <div 
                          className="text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border shadow-lg whitespace-nowrap mb-1"
                          style={{ backgroundColor: '#0A0A0C', borderColor: pinBg }}
                        >
                          {names}
                        </div>
                        <Pin background={pinBg} borderColor="#FFF" scale={0.8} />
                      </div>
                    </AdvancedMarker>
                  );
                })}

                {/* Live Driver GPS Marker */}
                {liveDriverPos && (
                  <AdvancedMarker position={liveDriverPos}>
                    <div className="flex flex-col items-center">
                      <div className="text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border border-emerald-400 bg-[#0A0A0C] shadow-lg mb-1 whitespace-nowrap">
                        📍 You Are Here
                      </div>
                      <div className="w-4 h-4 rounded-full bg-emerald-400 border-2 border-white shadow-lg animate-pulse" />
                    </div>
                  </AdvancedMarker>
                )}

                {/* Route Line Connector */}
                <GoogleMapRouteLine stops={routeStops} livePos={liveDriverPos} />
              </GoogleMap>
            </APIProvider>
          )}
        </div>
      ) : (
        /* Vector SVG Canvas supporting 3D isometric perspectives */
        <div 
          style={{ perspective: mapViewMode === '3d' ? '800px' : 'none' }}
          className="relative border border-[#2A2A30] bg-[#0A0A0C] rounded-xl overflow-hidden shadow-2xl transition-all duration-700"
        >
          <div
            style={{
              transform: mapViewMode === '3d' ? 'rotateX(34deg) rotateY(0deg) rotateZ(-12deg) scale(0.95)' : 'none',
              transformStyle: 'preserve-3d',
              transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none" id="vector-map-canvas">
              {/* Grid Background */}
              <defs>
                <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1A1A22" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mapGrid)" />

              {/* Landmarks / General Area Labels */}
              <text x="35" y="380" className="fill-[#8E9299]/20 font-mono text-[9px] uppercase tracking-[0.2em]">Heliopolis SW Sector</text>
              <text x="480" y="50" className="fill-[#8E9299]/20 font-mono text-[9px] uppercase tracking-[0.2em]">Roxy NE Terminal</text>

              {/* 1. Base Road Network */}
              <g opacity="0.9">
                {roads.map((road, idx) => {
                  const projectedPoints = road.points.map(pt => project(pt.lat, pt.lng));
                  let pathStr = '';
                  projectedPoints.forEach((pt, pIdx) => {
                    pathStr += `${pIdx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`;
                  });

                  return (
                    <g key={road.segmentId || idx}>
                      {/* Outer casing */}
                      <path
                        d={pathStr}
                        fill="none"
                        stroke="#121217"
                        strokeWidth={getRoadWidth(road.segmentId) + 3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Road centerline */}
                      <path
                        d={pathStr}
                        fill="none"
                        stroke="#1A1A22"
                        strokeWidth={getRoadWidth(road.segmentId) + 1}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Traffic flow colored road overlay */}
                      <path
                        d={pathStr}
                        fill="none"
                        className={`${getRoadColor(road.segmentId)} transition-all duration-500`}
                        strokeWidth={getRoadWidth(road.segmentId)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
              </g>

              {/* 2. Active Bus Route Line */}
              {activePathPoints.length > 1 && (
                <g>
                  {/* Glowing wide backing shadow */}
                  <polyline
                    points={activePathPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="10"
                    strokeOpacity="0.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Dark outer casing line for high contrast */}
                  <polyline
                    points={activePathPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#0A0A0C"
                    strokeWidth="6.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Core solid path color */}
                  <polyline
                    points={activePathPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Marching bright dash overlay for motion flow */}
                  <polyline
                    points={activePathPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="10 8"
                    className="animate-dash"
                  />
                </g>
              )}

              {/* 3. Stop Hub Nodes (Start & End Destination Hubs) */}
              {routeStops.map((stop, index) => {
                if (stop.type !== 'hub') return null;
                const snapped = snapToRoadNetwork({ lat: stop.lat, lng: stop.lng }).point;
                const { x, y } = project(snapped.lat, snapped.lng);
                const isStart = index === 0;

                return (
                  <g key={`hub-${stop.id}-${index}`} className="cursor-pointer">
                    <circle cx={x} cy={y} r="14" className={`${isStart ? 'fill-[#3B82F6]/15 stroke-[#3B82F6]' : 'fill-[#10B981]/15 stroke-[#10B981]'} stroke-2`} />
                    <circle cx={x} cy={y} r="5" className={isStart ? 'fill-[#3B82F6]' : 'fill-[#10B981]'} />
                    <text x={x} y={y - 18} textAnchor="middle" className="fill-[#F0F0F0] font-bold text-[9px] uppercase tracking-wide font-display">
                      {isStart ? 'START TERMINAL 🚌' : 'SCHOOL DESTINATION 🏛️'}
                    </text>
                  </g>
                );
              })}

              {/* 4. Student Pickup Stop Pins */}
              {studentStops.map((stop, stopIdx) => {
                const { x, y } = project(stop.lat, stop.lng);
                
                const totalAtStop = stop.students.length;
                const boardedAtStop = stop.students.filter(s => s.boardingStatus === 'boarded').length;
                const arrivedAtStop = stop.students.filter(s => s.boardingStatus === 'arrived').length;
                const absentAtStop = stop.students.filter(s => s.boardingStatus === 'absent').length;

                let pinColor = 'fill-[#F59E0B]'; // Waiting default
                if (boardedAtStop === totalAtStop - absentAtStop && totalAtStop > absentAtStop) {
                  pinColor = 'fill-[#3B82F6]'; // All active boarded
                } else if (arrivedAtStop === totalAtStop - absentAtStop && totalAtStop > absentAtStop) {
                  pinColor = 'fill-[#10B981]'; // Arrived
                } else if (absentAtStop === totalAtStop) {
                  pinColor = 'fill-[#8E9299]/50'; // All absent
                }

                const isHovered = activeStopHover === `${stop.lat}-${stop.lng}`;

                return (
                  <g
                    key={`pickup-${stopIdx}`}
                    className="cursor-pointer"
                    onMouseEnter={() => setActiveStopHover(`${stop.lat}-${stop.lng}`)}
                    onMouseLeave={() => setActiveStopHover(null)}
                    onClick={() => onSelectStudent && onSelectStudent(stop.students[0]?.id)}
                  >
                    {/* Ring glow */}
                    <circle cx={x} cy={y} r="10" className="fill-transparent hover:fill-white/5 stroke-none" />
                    
                    {/* Always visible student name badge above pinpoint */}
                    <g transform={`translate(${x}, ${y - 32})`} className="pointer-events-none select-none">
                      <rect
                        x={-Math.min(90, stop.students.map(s => s.name.split(' ')[0]).join(' & ').length * 4.2 + 8)}
                        y="-8"
                        width={Math.min(180, stop.students.map(s => s.name.split(' ')[0]).join(' & ').length * 8.4 + 16)}
                        height="15"
                        rx="7"
                        fill="#0A0A0C"
                        fillOpacity="0.85"
                        stroke={boardedAtStop > 0 ? '#3B82F6' : '#F59E0B'}
                        strokeWidth="1.2"
                      />
                      <text
                        textAnchor="middle"
                        y="2.5"
                        className="fill-[#F3F4F6] font-sans text-[8px] font-extrabold tracking-wide"
                      >
                        {stop.students.map(s => s.name.split(' ')[0]).join(' & ')}
                      </text>
                    </g>

                    {/* Visual Pin */}
                    <path
                      d={`M ${x} ${y} C ${x - 5} ${y - 12} ${x - 8} ${y - 15} ${x - 8} ${y - 20} A 8 8 0 0 1 ${x + 8} ${y - 20} C ${x + 8} ${y - 15} ${x + 5} ${y - 12} ${x} ${y} Z`}
                      className={`${pinColor} transition-all duration-300 stroke-[#121217] stroke-[1]`}
                    />
                    {/* Inner pin core dot */}
                    <circle cx={x} cy={y - 20} r="2.5" fill="#121217" />

                    {/* Popover overlay tooltip */}
                    <g className={`transition-all duration-300 ${isHovered ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                      <rect
                        x={x - 100}
                        y={y - 100}
                        width="200"
                        height="75"
                        rx="8"
                        fill="#121217"
                        stroke="#2A2A30"
                        strokeWidth="1"
                        className="shadow-2xl"
                      />
                      <text x={x} y={y - 88} textAnchor="middle" className="fill-[#F0F0F0] font-bold text-[11px] font-sans">
                        {stop.bNo} {stop.street} St
                      </text>
                      <text x={x} y={y - 72} textAnchor="middle" className="fill-[#8E9299] text-[10px] font-sans">
                        Landmark: {(stop.students[0]?.landmark || "N/A").slice(0, 28)}...
                      </text>
                      <text x={x} y={y - 56} textAnchor="middle" className="fill-[#3B82F6] font-medium text-[9px] font-sans">
                        Students ({boardedAtStop}/{totalAtStop - absentAtStop} Boarded)
                      </text>
                      <path d={`M ${x} ${y - 30} L ${x - 5} ${y - 35} L ${x + 5} ${y - 35} Z`} fill="#121217" stroke="#2A2A30" strokeWidth="1" />
                    </g>
                  </g>
                );
              })}

              {/* 5. Live Driver GPS Pin */}
              {liveDriverPos && (() => {
                const { x, y } = project(liveDriverPos.lat, liveDriverPos.lng);
                return (
                  <g>
                    <circle cx={x} cy={y} r="16" fill="none" stroke="#10B981" strokeWidth="1.5" className="animate-ping" opacity="0.4" />
                    <circle cx={x} cy={y} r="10" fill="#10B981" stroke="#0A0A0C" strokeWidth="2" />
                    <circle cx={x} cy={y} r="4" fill="white" />
                    <text x={x} y={y - 18} textAnchor="middle" className="fill-[#34d399] font-bold text-[8px] font-mono">
                      📍 YOU
                    </text>
                  </g>
                );
              })()}

              {/* 5. Moving Bus Asset Icon */}
              {projectedBusPos && (
                <g className="transition-all duration-1000 ease-in-out">
                  <circle cx={projectedBusPos.x} cy={projectedBusPos.y} r="20" fill="none" stroke="#3B82F6" strokeWidth="1.5" className="animate-pulse" />
                  <circle cx={projectedBusPos.x} cy={projectedBusPos.y} r="14" fill="#0A0A0C" opacity="0.6" />
                  <circle cx={projectedBusPos.x} cy={projectedBusPos.y} r="12" fill="#3B82F6" stroke="#121217" strokeWidth="2.5" />
                  <g transform={`translate(${projectedBusPos.x - 7}, ${projectedBusPos.y - 7})`}>
                    <path d="M13 8H1V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3z M1 8h12v4H1z" fill="#ffffff" />
                    <circle cx="3.5" cy="12.5" r="1.2" fill="#ffffff" />
                    <circle cx="10.5" cy="12.5" r="1.2" fill="#ffffff" />
                  </g>
                </g>
              )}
            </svg>
          </div>

          {/* Map Legend & Mini overlay panel */}
          <div className="absolute bottom-3 left-3 bg-[#121217]/90 backdrop-blur-md rounded-lg border border-[#2A2A30] p-2.5 shadow-2xl max-w-[200px] text-[10px] text-[#8E9299] font-sans">
            <div className="font-bold text-[#F0F0F0] mb-1.5 flex items-center gap-1 uppercase tracking-wider text-[11px] font-display">
              <Bus className="w-3.5 h-3.5 text-[#3B82F6]" />
              Roxy Grid Fleet {mapViewMode === '3d' && '(3D TILT)'}
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]"></span>
                <span>Waiting Parents & Pupils</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]"></span>
                <span>Onboard & Verified</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]"></span>
                <span>Safe Classroom Handover</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
