export type BoardingStatus = 'waiting' | 'boarded' | 'absent' | 'arrived';
export type BuildingKey = 'wanas' | 'hadra' | 'nagar' | 'new' | 'demiana';

export interface Student {
  id: string;
  order: number; // original CSV sequence
  name: string;
  gender: 'boy' | 'girl';
  zone: string;
  street: string;
  buildingNo: string;
  landmark: string;
  mapUrl: string;
  lat: number; // simulated coordinates for the map
  lng: number; // simulated coordinates for the map
  parentPhonePrimary: string;
  parentPhoneSecondary: string;
  childPhone?: string;
  homePhone?: string;
  dob: string;
  grade: string;
  notes?: string;
  servantName: string;
  servantPhone: string;
  classLocation: string; // e.g. "مبنى الأنبا ونس", "مبنى أنبا هدرا", "مبنى يوسف النجار"
  buildingKey: BuildingKey;
  boardingStatus: BoardingStatus;
  boardingTime?: string;
  dataSource?: 'inline' | 'redirect' | 'lookup';
}

export interface TrafficSegment {
  id: string;
  streetName: string;
  status: 'clear' | 'moderate' | 'heavy';
  delayMinutes: number;
}

export interface DelayAlert {
  id: string;
  timestamp: string;
  streetName: string;
  severity: 'moderate' | 'severe';
  message: string;
  isRead: boolean;
}

export interface RouteStop {
  id: string; // can be 'start', studentId, or 'end'
  name: string;
  type: 'hub' | 'pickup' | 'drop';
  lat: number;
  lng: number;
  studentId?: string; // if type === 'pickup'
  eta: string; // Estimated Time of Arrival
  distanceFromPrev: number; // km
  durationFromPrev: number; // minutes
}

export interface RouteConfiguration {
  startHub: string; // 'roxy_square' etc.
  endHub: string; // 'church_school'
  stopIds: string[]; // ordered sequence of student IDs / stops
  isOptimized: boolean;
}

export interface SolverConfig {
  type: 'distance' | 'traffic' | 'priority';
  alpha: number; // distance weight multiplier
  beta: number; // traffic weight multiplier
  gamma: number; // class priority weight multiplier
}

export interface AttendanceLog {
  id: string;
  date: string;
  routeName: string;
  boardedCount: number;
  absentCount: number;
  totalCount: number;
  records: {
    studentId: string;
    name: string;
    status: BoardingStatus;
    time?: string;
  }[];
}
