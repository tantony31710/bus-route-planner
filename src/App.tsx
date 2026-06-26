import React, { useState, useEffect, useMemo, useRef } from 'react';
import { INITIAL_STUDENTS, BUILDINGS_INFO, START_HUBS, END_HUBS } from './data/students';
import { Student, BoardingStatus, TrafficSegment, DelayAlert, RouteStop, SolverConfig } from './types';
import InteractiveMap from './components/InteractiveMap';
import StudentBoardingList from './components/StudentBoardingList';
import RoutePlanner from './components/RoutePlanner';
import DelayAlertPanel from './components/DelayAlertPanel';
import SmartBriefing from './components/SmartBriefing';
import AIEngineerLab from './components/AIEngineerLab';
import { Bus, Bell, ShieldAlert, CheckCircle, Navigation, Users, Clock, Compass, HelpCircle, Volume2 } from 'lucide-react';
import { isFirebaseConfigured, subscribeToStudents, syncStudentsToFirebase, updateStudentBoardingStatusInFirebase } from './lib/firebase';

// Haversine formula to find distance in kilometers between two points
function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Convert minute offsets to a nice 12-hour AM/PM string
function formatTimeFromOffset(minutesOffset: number, startHour = 8) {
  const startMinute = 0;
  const totalMinutes = startHour * 60 + startMinute + minutesOffset;
  const hours = Math.floor(totalMinutes / 60) % 12 || 12;
  const mins = Math.floor(totalMinutes % 60);
  const ampm = (Math.floor(totalMinutes / 60) % 24) >= 12 ? 'PM' : 'AM';
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
}

export default function App() {
  // Core application states
  const [students, setStudents] = useState<Student[]>(() => {
    // Attempt local storage restore, fallback to initial constants
    const saved = localStorage.getItem('roxy_bus_students');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.length === 16) {
        return parsed;
      }
    }
    return INITIAL_STUDENTS;
  });

  const [startHubId, setStartHubId] = useState(() => {
    const val = localStorage.getItem('roxy_bus_start_hub');
    return (val && val !== 'roxy_square') ? val : 'saint_mark_church';
  });

  const [endHubId, setEndHubId] = useState(() => {
    const val = localStorage.getItem('roxy_bus_end_hub');
    return (val && val !== 'church_complex') ? val : 'saint_mark_church';
  });

  const [isOptimized, setIsOptimized] = useState(() => {
    const saved = localStorage.getItem('roxy_bus_optimized');
    return saved ? JSON.parse(saved) : true;
  });

  const [routeType, setRouteType] = useState<'morning' | 'afternoon'>(() => {
    const saved = localStorage.getItem('roxy_bus_route_type');
    return (saved as 'morning' | 'afternoon') || 'morning';
  });

  // Manual ordering of student pickup stops (only used if isOptimized is false)
  const [manualStudentIds, setManualStudentIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('roxy_bus_manual_ids');
    return saved ? JSON.parse(saved) : INITIAL_STUDENTS.map(s => s.id);
  });

  // Traffic segments states (representing live delay parameters)
  const [trafficSegments, setTrafficSegments] = useState<TrafficSegment[]>([
    { id: 'selahdar', streetName: 'السلحدار', status: 'clear', delayMinutes: 0 },
    { id: 'khalifa', streetName: 'الخليفة المأمون', status: 'clear', delayMinutes: 0 },
    { id: 'ashgar', streetName: 'الأشجار', status: 'clear', delayMinutes: 0 },
    { id: 'abu_nour', streetName: 'الشيخ أبو النور', status: 'clear', delayMinutes: 0 },
    { id: 'mokrizi', streetName: 'المقريزي', status: 'clear', delayMinutes: 0 },
    { id: 'noweiry', streetName: 'النويري', status: 'clear', delayMinutes: 0 }
  ]);

  const [alerts, setAlerts] = useState<DelayAlert[]>([]);
  const [activePush, setActivePush] = useState<DelayAlert | null>(null);

  // AI & Solver parameters
  const [solverConfig, setSolverConfig] = useState<SolverConfig>(() => {
    const saved = localStorage.getItem('roxy_bus_solver_config');
    return saved ? JSON.parse(saved) : {
      type: 'priority',
      alpha: 1.5,
      beta: 2.0,
      gamma: 2.5
    };
  });

  const [systemPrompt, setSystemPrompt] = useState(() => {
    return localStorage.getItem('roxy_bus_system_prompt') || "You are the 'Roxy Smart School Bus Dispatch Co-pilot' for Heliopolis Cairo school routes.";
  });

  const [modelTemp, setModelTemp] = useState(() => {
    const saved = localStorage.getItem('roxy_bus_model_temp');
    return saved ? parseFloat(saved) : 0.4;
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('roxy_bus_solver_config', JSON.stringify(solverConfig));
    localStorage.setItem('roxy_bus_system_prompt', systemPrompt);
    localStorage.setItem('roxy_bus_model_temp', modelTemp.toString());
  }, [solverConfig, systemPrompt, modelTemp]);

  // Simulation states
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedBusPos, setSimulatedBusPos] = useState<{ lat: number; lng: number } | null>(null);

  // Audio elements ref for alerts (using synthetic audio to bypass file issues)
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playSystemBeep = (freq = 440, duration = 0.15) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio Context block / not supported yet.');
    }
  };

  // Local Storage Save effect
  useEffect(() => {
    localStorage.setItem('roxy_bus_students', JSON.stringify(students));
    localStorage.setItem('roxy_bus_start_hub', startHubId);
    localStorage.setItem('roxy_bus_end_hub', endHubId);
    localStorage.setItem('roxy_bus_optimized', JSON.stringify(isOptimized));
    localStorage.setItem('roxy_bus_route_type', routeType);
    localStorage.setItem('roxy_bus_manual_ids', JSON.stringify(manualStudentIds));
  }, [students, startHubId, endHubId, isOptimized, routeType, manualStudentIds]);

  // Real-time Firebase Firestore Sync effect
  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    console.log("Setting up real-time Firebase Firestore listener...");
    const unsubscribe = subscribeToStudents(
      (dbStudents) => {
        if (dbStudents.length === 0) {
          console.log("Firebase student collection is empty, bootstrapping with INITIAL_STUDENTS...");
          syncStudentsToFirebase(INITIAL_STUDENTS).catch(err => {
            console.error("Failed to seed initial students to Firebase:", err);
          });
        } else {
          setStudents(dbStudents);
        }
      },
      (err) => {
        console.error("Failed to subscribe to Firebase students collection:", err);
      }
    );

    return () => unsubscribe();
  }, []);

  // Map street lookup helper
  const getStreetSegmentId = (streetName: string) => {
    const normalized = streetName.toLowerCase();
    if (normalized.includes('سلحدار')) return 'selahdar';
    if (normalized.includes('مأمون') || normalized.includes('مامون')) return 'khalifa';
    if (normalized.includes('أشجار') || normalized.includes('اشجار')) return 'ashgar';
    if (normalized.includes('مقر')) return 'mokrizi';
    if (normalized.includes('نوير')) return 'noweiry';
    if (normalized.includes('شيخ') || normalized.includes('نور')) return 'abu_nour';
    return 'other';
  };

  // 1. Calculate optimal sequence stop points
  const routeStops = useMemo((): RouteStop[] => {
    const startHub = routeType === 'morning'
      ? (START_HUBS.find(h => h.id === startHubId) || START_HUBS[0])
      : (END_HUBS.find(h => h.id === endHubId) || END_HUBS[0]);
    const endHub = routeType === 'morning'
      ? (END_HUBS.find(h => h.id === endHubId) || END_HUBS[0])
      : (START_HUBS.find(h => h.id === startHubId) || START_HUBS[0]);

    // Filter out students marked absent from routing to keep things extremely efficient
    const activeStudents = students.filter(s => s.boardingStatus !== 'absent');

    const baseHour = routeType === 'morning' ? 8 : 14; // 8:00 AM or 2:00 PM
    const startEtaStr = routeType === 'morning' ? '08:00 AM' : '02:00 PM';
    const sampleEndEtaStr = routeType === 'morning' ? '08:05 AM' : '02:05 PM';

    if (activeStudents.length === 0) {
      return [
        { id: 'start', name: startHub.name, type: 'hub', lat: startHub.lat, lng: startHub.lng, eta: startEtaStr, distanceFromPrev: 0, durationFromPrev: 0 },
        { id: 'end', name: endHub.name, type: 'hub', lat: endHub.lat, lng: endHub.lng, eta: sampleEndEtaStr, distanceFromPrev: 1.5, durationFromPrev: 5 }
      ];
    }

    let orderedStudents: Student[] = [];

    if (isOptimized) {
      // Multi-Criteria Nearest Neighbor solver starting from startHub
      let currentPos = { lat: startHub.lat, lng: startHub.lng };
      const unvisited = [...activeStudents];

      while (unvisited.length > 0) {
        let closestIdx = 0;
        let minCost = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
          const student = unvisited[i];
          const dist = getHaversineDistance(currentPos.lat, currentPos.lng, student.lat, student.lng);
          
          let cost = dist * solverConfig.alpha;

          if (solverConfig.type !== 'distance') {
            const segmentId = getStreetSegmentId(student.street);
            const segmentTraffic = trafficSegments.find(t => t.id === segmentId);
            const delay = segmentTraffic ? segmentTraffic.delayMinutes : 0;
            // 1 minute delay is equivalent to 0.15 km of travel
            cost += (delay * 0.15) * solverConfig.beta;
          }

          if (solverConfig.type === 'priority') {
            const buildingWeight = 
              student.buildingKey === 'hadra' ? 0.8 : 
              student.buildingKey === 'wanas' ? 0.6 : 
              student.buildingKey === 'nagar' ? 0.3 : 
              student.buildingKey === 'demiana' ? 0.2 : 0.1;
            // High priority reduces cost, attracting early pickup/dropoff
            cost -= buildingWeight * solverConfig.gamma;
          }

          if (cost < minCost) {
            minCost = cost;
            closestIdx = i;
          }
        }

        const nextStud = unvisited.splice(closestIdx, 1)[0];
        orderedStudents.push(nextStud);
        // If there are other active students living at the exact same building/coordinates, pull them too!
        const sameSpotStudents = unvisited.filter(s => Math.abs(s.lat - nextStud.lat) < 0.0001 && Math.abs(s.lng - nextStud.lng) < 0.0001);
        sameSpotStudents.forEach(s => {
          orderedStudents.push(s);
          const sIdx = unvisited.findIndex(u => u.id === s.id);
          if (sIdx !== -1) unvisited.splice(sIdx, 1);
        });

        currentPos = { lat: nextStud.lat, lng: nextStud.lng };
      }
    } else {
      // Manual sequence sorting using the manualStudentIds array
      const mapped = manualStudentIds
        .map(id => activeStudents.find(s => s.id === id))
        .filter((s): s is Student => s !== undefined);
      
      // If any active student was missing from manual ids list, append them safely
      activeStudents.forEach(s => {
        if (!mapped.some(m => m.id === s.id)) {
          mapped.push(s);
        }
      });
      orderedStudents = mapped;
    }

    // 3. Assemble complete chronological timeline of stops (grouping contiguous coordinates together)
    const stops: RouteStop[] = [];
    stops.push({
      id: 'start',
      name: startHub.name,
      type: 'hub',
      lat: startHub.lat,
      lng: startHub.lng,
      eta: startEtaStr,
      distanceFromPrev: 0,
      durationFromPrev: 0
    });

    let accumulatedMinutes = 0;
    const busSpeedKmh = 25; // 25 km/h average bus speed inside congested streets

    orderedStudents.forEach((student, index) => {
      // Check if previous stop was at the exact same building to avoid duplicate stops
      const prevStop = stops[stops.length - 1];
      const isSameCoordinates = prevStop &&
        Math.abs(prevStop.lat - student.lat) < 0.0001 &&
        Math.abs(prevStop.lng - student.lng) < 0.0001;

      if (isSameCoordinates) {
        // Just append the studentId to tracking if needed, no extra stop node
        return;
      }

      const dist = getHaversineDistance(prevStop.lat, prevStop.lng, student.lat, student.lng);
      
      // Calculate transit time
      let transitMinutes = (dist / busSpeedKmh) * 60;
      
      // Apply active traffic segment delays if any
      const segmentId = getStreetSegmentId(student.street);
      const segmentTraffic = trafficSegments.find(t => t.id === segmentId);
      if (segmentTraffic) {
        transitMinutes += segmentTraffic.delayMinutes;
      }

      // Add a 1.5-minute buffer time for student pick-up/boarding at each stop
      transitMinutes += 1.5;

      accumulatedMinutes += transitMinutes;

      stops.push({
        id: student.id,
        name: `${student.buildingNo} ${student.street} St Stop`,
        type: 'pickup',
        lat: student.lat,
        lng: student.lng,
        studentId: student.id,
        eta: formatTimeFromOffset(accumulatedMinutes, baseHour),
        distanceFromPrev: dist,
        durationFromPrev: transitMinutes
      });
    });

    // Add final school destination hub stop
    const lastStop = stops[stops.length - 1];
    const finalDist = getHaversineDistance(lastStop.lat, lastStop.lng, endHub.lat, endHub.lng);
    let finalTransit = (finalDist / busSpeedKmh) * 60;
    
    accumulatedMinutes += finalTransit;
    stops.push({
      id: 'end',
      name: endHub.name,
      type: 'hub',
      lat: endHub.lat,
      lng: endHub.lng,
      eta: formatTimeFromOffset(accumulatedMinutes, baseHour),
      distanceFromPrev: finalDist,
      durationFromPrev: finalTransit
    });

    return stops;
  }, [students, startHubId, endHubId, isOptimized, routeType, manualStudentIds, trafficSegments]);

  // Aggregate stats
  const totalDistance = useMemo(() => {
    return routeStops.reduce((sum, s) => sum + s.distanceFromPrev, 0);
  }, [routeStops]);

  const totalDuration = useMemo(() => {
    return routeStops.reduce((sum, s) => sum + s.durationFromPrev, 0);
  }, [routeStops]);

  // Classroom building arrivals sequence calculator based on school arrival ETA
  const classroomScheduleList = useMemo(() => {
    const endStop = routeStops[routeStops.length - 1];
    if (!endStop) return [];
    
    // Parse school arrival minutes from ETA
    const [time, ampm] = endStop.eta.split(' ');
    const [h, m] = time.split(':').map(Number);
    let arrivalMinutes = h * 60 + m;
    if (ampm === 'PM' && h !== 12) arrivalMinutes += 720;
    if (ampm === 'AM' && h === 12) arrivalMinutes -= 720;

    const baseHour = routeType === 'morning' ? 8 : 14;
    const baseMinutes = baseHour * 60;

    // Class schedules target sequence (hadra -> wanas -> nagar -> demiana -> new)
    // Hadra has youngest kids (KG) so they must be delivered first!
    const sequenceKeys: ('hadra' | 'wanas' | 'nagar' | 'demiana' | 'new')[] = ['hadra', 'wanas', 'nagar', 'demiana', 'new'];
    
    let currentOffset = 0;
    return sequenceKeys.map(key => {
      const info = BUILDINGS_INFO[key];
      const count = students.filter(s => s.buildingKey === key && s.boardingStatus === 'boarded').length;
      
      // Each building delivery takes 3 minutes to walk the children safely to their classes
      currentOffset += 3;
      const deliveryTime = formatTimeFromOffset((arrivalMinutes - baseMinutes) + currentOffset, baseHour);

      return {
        key,
        name: info.name,
        desc: info.desc,
        count,
        eta: deliveryTime,
        color: info.color
      };
    });
  }, [routeStops, students, routeType]);

  // Simulation timer effect
  useEffect(() => {
    let timer: any = null;
    if (isSimulating) {
      timer = setInterval(() => {
        setCurrentStopIndex(prev => {
          const next = prev + 1;
          if (next >= routeStops.length) {
            // Reached destination! Mark all boarded students as safely arrived
            setStudents(current => {
              const updated = current.map(s => {
                if (s.boardingStatus === 'boarded') {
                  return { ...s, boardingStatus: 'arrived' as BoardingStatus };
                }
                return s;
              });
              if (isFirebaseConfigured()) {
                syncStudentsToFirebase(updated).catch(err => console.error(err));
              }
              return updated;
            });
            playSystemBeep(880, 0.4);
            setIsSimulating(false);
            return prev;
          }

          const currentStop = routeStops[next];
          
          // Auto boarding simulation: find any student at this stop and board them automatically!
          if (currentStop.type === 'pickup') {
            setStudents(current => {
              const updated = current.map(s => {
                if (Math.abs(s.lat - currentStop.lat) < 0.0001 && Math.abs(s.lng - currentStop.lng) < 0.0001 && s.boardingStatus === 'waiting') {
                  return { ...s, boardingStatus: 'boarded' as BoardingStatus, boardingTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
                }
                return s;
              });
              if (isFirebaseConfigured()) {
                syncStudentsToFirebase(updated).catch(err => console.error(err));
              }
              return updated;
            });
            playSystemBeep(523.25, 0.25); // visual boarding ping sound
          }

          return next;
        });
      }, 4000); // 4 seconds per stop simulation
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isSimulating, routeStops]);

  // Update animated bus coordinates smoothly as stop index changes
  useEffect(() => {
    if (routeStops[currentStopIndex]) {
      const stop = routeStops[currentStopIndex];
      setSimulatedBusPos({ lat: stop.lat, lng: stop.lng });
    }
  }, [currentStopIndex, routeStops]);

  // Triggering live traffic delays & push notification triggers
  const handleTriggerIncident = (segmentId: string, severity: 'moderate' | 'severe', delayMins: number, message: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const segment = trafficSegments.find(t => t.id === segmentId);
    const streetName = segment ? segment.streetName : segmentId;

    // 1. Update traffic segments delay
    setTrafficSegments(prev => prev.map(t => {
      if (t.id === segmentId) {
        return { ...t, status: severity === 'severe' ? 'heavy' : 'moderate', delayMinutes: delayMins };
      }
      return t;
    }));

    // 2. Add to active alerts log
    const newAlert: DelayAlert = {
      id: `alert_${Date.now()}`,
      timestamp,
      streetName,
      severity,
      message,
      isRead: false
    };

    setAlerts(prev => [newAlert, ...prev]);
    setActivePush(newAlert);
    playSystemBeep(330, 0.35); // simulated alert ping
  };

  const handleClearAlert = (id: string) => {
    // 1. Find alert and resolve delay
    const alert = alerts.find(a => a.id === id);
    if (alert) {
      const segment = trafficSegments.find(t => t.streetName === alert.streetName);
      if (segment) {
        setTrafficSegments(prev => prev.map(t => {
          if (t.id === segment.id) {
            return { ...t, status: 'clear', delayMinutes: 0 };
          }
          return t;
        }));
      }
    }

    // 2. Mark as read / remove
    setAlerts(prev => prev.filter(a => a.id !== id));
    if (activePush?.id === id) {
      setActivePush(null);
    }
  };

  // Student boarding manual check ins
  const handleUpdateStudentStatus = (studentId: string, status: BoardingStatus) => {
    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        return { ...s, boardingStatus: status };
      }
      return s;
    }));
    playSystemBeep(status === 'boarded' ? 659.25 : 440, 0.1);
    if (isFirebaseConfigured()) {
      updateStudentBoardingStatusInFirebase(studentId, status).catch(err => console.error(err));
    }
  };

  // Manual sorting modifier
  const handleManualReorder = (fromIndex: number, direction: 'up' | 'down') => {
    if (isOptimized) return;
    const targetIdx = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (targetIdx <= 0 || targetIdx >= routeStops.length - 1) return; // limit within bounds of start/end hub

    // Find the student IDs associated with these stops
    const fromStop = routeStops[fromIndex];
    const targetStop = routeStops[targetIdx];
    if (!fromStop.studentId || !targetStop.studentId) return;

    setManualStudentIds(prev => {
      const next = [...prev];
      const fromPos = next.indexOf(fromStop.studentId!);
      const targetPos = next.indexOf(targetStop.studentId!);
      if (fromPos !== -1 && targetPos !== -1) {
        // Swap
        const tmp = next[fromPos];
        next[fromPos] = next[targetPos];
        next[targetPos] = tmp;
      }
      return next;
    });
  };

  const handleResetSimulation = () => {
    setIsSimulating(false);
    setCurrentStopIndex(0);
    // Reset boarding status of all active students back to waiting
    const resetStudents = students.map(s => {
      if (s.boardingStatus !== 'absent') {
        return { ...s, boardingStatus: 'waiting' as BoardingStatus };
      }
      return s;
    });
    setStudents(resetStudents);
    playSystemBeep(587.33, 0.2);
    if (isFirebaseConfigured()) {
      syncStudentsToFirebase(resetStudents).catch(err => console.error(err));
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F0F0F0] flex flex-col font-sans" id="main-app-viewport">
      {/* 1. Header with dynamic brand, telemetry & notification bar */}
      <header className="bg-[#121217] text-[#F0F0F0] sticky top-0 z-50 px-6 py-5 border-b border-[#2A2A30] shadow-xl shadow-black/20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-[#3B82F6]/10 border border-[#3B82F6]/30 rounded-xl flex items-center justify-center">
              <Bus className="w-6 h-6 text-[#3B82F6]" />
            </div>
            <div>
              <h1 id="app-logo-title" className="text-lg font-bold tracking-tight uppercase font-display">
                Roxy <span className="text-[#3B82F6]">Smart-Bus</span>
              </h1>
              <div className="text-[10px] text-[#8E9299] uppercase tracking-widest flex items-center gap-2 mt-0.5">
                <span>Heliopolis Route Planner & Attendance Board</span>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
                <span>Live GPS Feed</span>
              </div>
            </div>
          </div>

          {/* Quick stats on top */}
          <div className="hidden md:flex items-center gap-6 text-xs text-[#8E9299]">
            <div className="flex flex-col items-end border-r border-[#2A2A30] pr-6">
              <span className="text-[9px] uppercase tracking-wider text-[#8E9299]">Checked Boarding</span>
              <span className="font-mono text-sm text-[#10B981] font-bold">
                {students.filter(s => s.boardingStatus === 'boarded').length} / {students.length - students.filter(s => s.boardingStatus === 'absent').length} verified
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-wider text-[#8E9299]">School ETA</span>
              <span className="font-mono text-sm text-[#3B82F6] font-bold">
                {routeStops[routeStops.length - 1]?.eta}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Slide Down Simulated Push Notification Alert Toast */}
        {activePush && (
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-3 w-full max-w-md bg-rose-950/95 backdrop-blur-md text-rose-100 p-4 rounded-2xl shadow-2xl border border-rose-500/40 flex items-start justify-between gap-3 animate-bounce z-50">
            <div className="flex gap-2.5">
              <Bell className="w-5 h-5 mt-0.5 shrink-0 animate-swing text-rose-400" />
              <div>
                <h4 className="font-bold text-xs uppercase tracking-widest text-rose-400">
                  ⚠️ TRAFFIC PUSH ALERT: {activePush.streetName.toUpperCase()}
                </h4>
                <p className="text-xs font-medium mt-1 leading-relaxed">
                  {activePush.message} — Parents and teachers updated via push notification.
                </p>
                <div className="text-[10px] text-rose-300/70 mt-1">
                  Sent to {students.filter(s => getStreetSegmentId(s.street) === getStreetSegmentId(activePush.streetName)).length} registered parents at {activePush.timestamp}
                </div>
              </div>
            </div>
            <button
              onClick={() => setActivePush(null)}
              className="p-1.5 hover:bg-white/10 rounded-lg text-rose-400 hover:text-rose-200 transition-all shrink-0"
            >
              ✕
            </button>
          </div>
        )}
      </header>

      {/* 3. Main Dashboard Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-5 md:py-8 space-y-6">
        {/* Row 1: Left Map, Right Route Engine & AI Dispatch Briefing */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map area (takes 2/3 wide on large displays) */}
          <div className="lg:col-span-2 space-y-6">
            <InteractiveMap
              students={students}
              routeStops={routeStops}
              currentStopIndex={currentStopIndex}
              simulatedBusPos={simulatedBusPos}
              trafficSegments={trafficSegments}
              onSelectStudent={(id) => {
                const s = students.find(stud => stud.id === id);
                if (s) playSystemBeep(440, 0.1);
              }}
            />

            {/* Attendance board table */}
            <StudentBoardingList
              students={students}
              onUpdateStatus={handleUpdateStudentStatus}
              activeRouteIds={routeStops.map(s => s.studentId || '')}
            />
          </div>

          {/* Right rail: Engine Planner & Co-pilot details */}
          <div className="space-y-6">
            {/* AI Dispatch brief card */}
            <SmartBriefing
              students={students}
              routeStops={routeStops}
              alerts={alerts}
              startHubName={START_HUBS.find(h => h.id === startHubId)?.name || 'Roxy Square'}
              endHubName={END_HUBS.find(h => h.id === endHubId)?.name || 'Church'}
              totalDistance={totalDistance}
              totalDuration={totalDuration}
              customSystemPrompt={systemPrompt}
              temperature={modelTemp}
            />

            {/* Route Optimizer timeline & controls */}
            <RoutePlanner
              students={students}
              routeType={routeType}
              onChangeRouteType={setRouteType}
              startHubId={startHubId}
              endHubId={endHubId}
              routeStops={routeStops}
              currentStopIndex={currentStopIndex}
              isSimulating={isSimulating}
              isOptimized={isOptimized}
              onUpdateStartHub={setStartHubId}
              onUpdateEndHub={setEndHubId}
              onToggleOptimize={setIsOptimized}
              onManualReorder={handleManualReorder}
              onStartSimulation={() => setIsSimulating(true)}
              onStopSimulation={() => setIsSimulating(false)}
              onResetSimulation={handleResetSimulation}
              totalDistance={totalDistance}
              totalDuration={totalDuration}
            />

            {/* Classroom delivery sequence & time planning */}
            <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10" id="classroom-schedule-panel">
              <h3 className="text-sm font-bold text-[#F0F0F0] mb-1 flex items-center gap-1.5 font-display uppercase tracking-wide">
                <Clock className="w-4.5 h-4.5 text-[#3B82F6]" />
                Classroom Handover Priority
              </h3>
              <p className="text-xs text-[#8E9299] mb-4 leading-relaxed">
                Determining which child to deliver first to class based on age, building sequence & schedule priorities
              </p>

              <div className="space-y-2.5">
                {classroomScheduleList.map((item, idx) => (
                  <div
                    key={item.key}
                    className="p-3 bg-[#1A1A1E] rounded-xl border border-[#2A2A30] flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-[#8E9299] font-mono">#{idx + 1}</span>
                      <span
                        className="w-2.5 h-2.5 rounded-full ring-4 ring-[#121217]"
                        style={{ backgroundColor: item.color }}
                      ></span>
                      <div>
                        <div className="font-bold text-[#F0F0F0]">{item.name}</div>
                        <div className="text-[10px] text-[#8E9299]">{item.desc}</div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono font-bold text-[#3B82F6]">{item.eta}</div>
                      <div className="text-[10px] text-[#8E9299]">{item.count} pupils onboard</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Traffic alerts console */}
            <DelayAlertPanel
              alerts={alerts}
              trafficSegments={trafficSegments}
              onTriggerIncident={handleTriggerIncident}
              onClearAlert={handleClearAlert}
            />
          </div>
        </div>

        {/* AI & Data Scientist Lab Panel (Developer Brother's telemetry workspace) */}
        <AIEngineerLab
          students={students}
          routeStops={routeStops}
          trafficSegments={trafficSegments}
          solverConfig={solverConfig}
          onUpdateSolverConfig={setSolverConfig}
          systemPrompt={systemPrompt}
          onUpdateSystemPrompt={setSystemPrompt}
          modelTemp={modelTemp}
          onUpdateModelTemp={setModelTemp}
          isRealAI={Boolean(process.env.GEMINI_API_KEY)}
          onUpdateStudents={setStudents}
        />
      </main>

      {/* Footer Controls / Telemetry info */}
      <footer className="bg-[#0A0A0C] border-t border-[#2A2A30] text-[#8E9299] text-xs py-8 mt-12 font-sans">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex space-x-6 text-[10px] uppercase tracking-widest font-medium">
            <span className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-[#3B82F6] mr-2"></span> GPS Status: Active
            </span>
            <span className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-[#10B981] mr-2"></span> SAT Link: Strong
            </span>
            <span className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-[#10B981] mr-2"></span> Heliopolis Grid: Sync
            </span>
          </div>
          <div className="text-center md:text-right space-y-1">
            <p className="text-[11px] font-medium">© 2026 Roxy Smart-Bus Logistics. Heliopolis Hub Transit.</p>
            <p className="text-[9px] text-[#8E9299]/60">
              Computed via modern high-precision Cairo GPS projections, greedy nearest-neighbor TSP, and Gemini 3.5 AI cores.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
