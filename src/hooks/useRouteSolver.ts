import { useMemo } from 'react';
import { Student, RouteStop, TrafficSegment, SolverConfig } from '../types';
import { START_HUBS, END_HUBS } from '../data/students';

// Haversine formula
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

function formatTimeFromOffset(minutesOffset: number, startHour = 8) {
  const totalMinutes = startHour * 60 + minutesOffset;
  const hours = Math.floor(totalMinutes / 60) % 12 || 12;
  const mins = Math.floor(totalMinutes % 60);
  const ampm = (Math.floor(totalMinutes / 60) % 24) >= 12 ? 'PM' : 'AM';
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
}

export const useRouteSolver = (
  students: Student[],
  startHubId: string,
  endHubId: string,
  isOptimized: boolean,
  routeType: 'morning' | 'afternoon',
  manualStudentIds: string[],
  trafficSegments: TrafficSegment[],
  liveDriverPos: { lat: number; lng: number } | null,
  solverConfig: SolverConfig
): RouteStop[] => {

  return useMemo((): RouteStop[] => {
    const startHub = routeType === 'morning'
      ? (START_HUBS.find(h => h.id === startHubId) || START_HUBS[0])
      : (END_HUBS.find(h => h.id === endHubId) || END_HUBS[0]);
    const endHub = routeType === 'morning'
      ? (END_HUBS.find(h => h.id === endHubId) || END_HUBS[0])
      : (START_HUBS.find(h => h.id === startHubId) || START_HUBS[0]);

    const activeStudents = students.filter(s => s.boardingStatus !== 'absent');
    const baseHour = routeType === 'morning' ? 8 : 14;
    const startEtaStr = routeType === 'morning' ? '08:00 AM' : '02:00 PM';

    if (activeStudents.length === 0) {
      return [
        { id: 'start', name: startHub.name, type: 'hub', lat: startHub.lat, lng: startHub.lng, eta: startEtaStr, distanceFromPrev: 0, durationFromPrev: 0 },
        { id: 'end', name: endHub.name, type: 'hub', lat: endHub.lat, lng: endHub.lng, eta: '08:05 AM', distanceFromPrev: 1.5, durationFromPrev: 5 }
      ];
    }

    let orderedStudents: Student[] = [];

    // Helper for traffic lookup
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

    if (isOptimized) {
      const routeOrigin = liveDriverPos || { lat: startHub.lat, lng: startHub.lng };
      let currentPos = { lat: routeOrigin.lat, lng: routeOrigin.lng };
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
            cost += (delay * 0.15) * solverConfig.beta;
          }

          if (solverConfig.type === 'priority') {
            const buildingWeight = 
              student.buildingKey === 'hadra' ? 0.8 : 
              student.buildingKey === 'wanas' ? 0.6 : 
              student.buildingKey === 'nagar' ? 0.3 : 
              student.buildingKey === 'demiana' ? 0.2 : 0.1;
            cost -= buildingWeight * solverConfig.gamma;
          }

          if (cost < minCost) {
            minCost = cost;
            closestIdx = i;
          }
        }

        const nextStud = unvisited.splice(closestIdx, 1)[0];
        orderedStudents.push(nextStud);
        const sameSpotStudents = unvisited.filter(s => Math.abs(s.lat - nextStud.lat) < 0.0001 && Math.abs(s.lng - nextStud.lng) < 0.0001);
        sameSpotStudents.forEach(s => {
          orderedStudents.push(s);
          const sIdx = unvisited.findIndex(u => u.id === s.id);
          if (sIdx !== -1) unvisited.splice(sIdx, 1);
        });

        currentPos = { lat: nextStud.lat, lng: nextStud.lng };
      }
    } else {
      const mapped = manualStudentIds
        .map(id => activeStudents.find(s => s.id === id))
        .filter((s): s is Student => s !== undefined);
      
      activeStudents.forEach(s => {
        if (!mapped.some(m => m.id === s.id)) {
          mapped.push(s);
        }
      });
      orderedStudents = mapped;
    }

    const stops: RouteStop[] = [];
    const routeOriginPos = liveDriverPos || { lat: startHub.lat, lng: startHub.lng };
    const routeOriginName = liveDriverPos ? `📍 Live Driver Location` : startHub.name;
    
    stops.push({
      id: 'start',
      name: routeOriginName,
      type: 'hub',
      lat: routeOriginPos.lat,
      lng: routeOriginPos.lng,
      eta: startEtaStr,
      distanceFromPrev: 0,
      durationFromPrev: 0
    });

    let accumulatedMinutes = 0;
    const busSpeedKmh = 25;

    orderedStudents.forEach((student) => {
      const prevStop = stops[stops.length - 1];
      const isSameCoordinates = prevStop &&
        Math.abs(prevStop.lat - student.lat) < 0.0001 &&
        Math.abs(prevStop.lng - student.lng) < 0.0001;

      if (isSameCoordinates) return;

      const dist = getHaversineDistance(prevStop.lat, prevStop.lng, student.lat, student.lng);
      let transitMinutes = (dist / busSpeedKmh) * 60;
      
      const segmentId = getStreetSegmentId(student.street);
      const segmentTraffic = trafficSegments.find(t => t.id === segmentId);
      if (segmentTraffic) transitMinutes += segmentTraffic.delayMinutes;
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
  }, [students, startHubId, endHubId, isOptimized, routeType, manualStudentIds, trafficSegments, liveDriverPos, solverConfig]);
};
