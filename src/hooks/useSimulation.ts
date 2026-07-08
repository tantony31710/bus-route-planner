import { useState, useEffect, useRef } from 'react';
import { Student, BoardingStatus, RouteStop } from '../types';

export const useSimulation = (
  routeStops: RouteStop[],
  isSimulating: boolean,
  setIsSimulating: (val: boolean) => void,
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>,
  playSystemBeep: (freq?: number, duration?: number) => void,
  isFirebaseConfigured: () => boolean,
  syncStudentsToFirebase: (students: Student[]) => Promise<void>
) => {
  const [currentStopIndex, setCurrentStopIndex] = useState(0);

  useEffect(() => {
    let timer: any = null;
    if (isSimulating) {
      timer = setInterval(() => {
        setCurrentStopIndex(prev => {
          const next = prev + 1;
          if (next >= routeStops.length) {
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
            playSystemBeep(523.25, 0.25);
          }

          return next;
        });
      }, 4000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isSimulating, routeStops, setStudents, setIsSimulating, playSystemBeep, isFirebaseConfigured, syncStudentsToFirebase]);

  const handleResetSimulation = () => {
    setIsSimulating(false);
    setCurrentStopIndex(0);
    setStudents(current => {
        const resetStudents = current.map(s => {
            if (s.boardingStatus !== 'absent') {
              return { ...s, boardingStatus: 'waiting' as BoardingStatus };
            }
            return s;
          });
          if (isFirebaseConfigured()) {
            syncStudentsToFirebase(resetStudents).catch(err => console.error(err));
          }
          return resetStudents;
    });
    playSystemBeep(587.33, 0.2);
  };

  return { currentStopIndex, setCurrentStopIndex, handleResetSimulation };
};
