import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, writeBatch, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';

// Firebase Sandbox credentials provisioned for this app
const firebaseConfig = {
  apiKey: "AIzaSyCliiTrXlgePt0N-M9Mazu-UsMP4M2bzSM",
  authDomain: "light-castle-swjrd.firebaseapp.com",
  projectId: "light-castle-swjrd",
  storageBucket: "light-castle-swjrd.firebasestorage.app",
  messagingSenderId: "610019087843",
  appId: "1:610019087843:web:f0fb874e7dac3b38b63cd6"
};

// Target Named Firestore Database ID
const databaseId = "ai-studio-schoolbusroutepl-6144e8d8-2b0b-450b-8386-219f40e3ac5d";

// Initialize standard Firebase app lazily
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, databaseId);

// Check if Firebase is successfully configured (it is configured by default with sandbox credentials)
export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

// Sync all 1-16 students to Firebase Firestore
export async function syncStudentsToFirebase(students: any[]): Promise<{ success: boolean; error?: string }> {
  try {
    const batch = writeBatch(db);
    const colRef = collection(db, 'roxy_students');

    students.forEach((student) => {
      const docRef = doc(colRef, student.id);
      batch.set(docRef, {
        id: student.id,
        order: student.order,
        name: student.name,
        gender: student.gender,
        zone: student.zone,
        street: student.street,
        buildingNo: student.buildingNo || '',
        landmark: student.landmark || '',
        lat: student.lat,
        lng: student.lng,
        dob: student.dob || '',
        grade: student.grade || '',
        servantName: student.servantName || '',
        servantPhone: student.servantPhone || '',
        classLocation: student.classLocation || '',
        buildingKey: student.buildingKey || '',
        boardingStatus: student.boardingStatus,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    });

    await batch.commit();
    return { success: true };
  } catch (err: any) {
    console.error('Firebase Firestore sync failed:', err);
    return { success: false, error: err.message || String(err) };
  }
}

// Update a single student boarding status in Firebase
export async function updateStudentBoardingStatusInFirebase(
  studentId: string,
  boardingStatus: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const docRef = doc(db, 'roxy_students', studentId);
    await updateDoc(docRef, {
      boardingStatus,
      updatedAt: new Date().toISOString()
    });
    return { success: true };
  } catch (err: any) {
    console.error(`Firebase single-student update failed for ${studentId}:`, err);
    return { success: false, error: err.message || String(err) };
  }
}

// Subscribe to real-time updates for all students
export function subscribeToStudents(
  onUpdate: (students: any[]) => void,
  onError?: (err: any) => void
): () => void {
  const colRef = collection(db, 'roxy_students');
  return onSnapshot(
    colRef,
    (querySnapshot) => {
      const students: any[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        students.push({
          id: data.id,
          order: data.order,
          name: data.name,
          gender: data.gender,
          zone: data.zone,
          street: data.street,
          buildingNo: data.buildingNo || '',
          landmark: data.landmark || '',
          lat: data.lat,
          lng: data.lng,
          dob: data.dob || '',
          grade: data.grade || '',
          servantName: data.servantName || '',
          servantPhone: data.servantPhone || '',
          classLocation: data.classLocation || '',
          buildingKey: data.buildingKey || '',
          boardingStatus: data.boardingStatus
        });
      });
      // Sort students by their proper order (1-16)
      students.sort((a, b) => a.order - b.order);
      onUpdate(students);
    },
    (error) => {
      console.error('Firebase Firestore subscription error:', error);
      if (onError) onError(error);
    }
  );
}

// Fetch all student states from Firebase Firestore
export async function fetchStudentsFromFirebase(): Promise<{ success: boolean; data?: any[]; error?: string }> {
  try {
    const colRef = collection(db, 'roxy_students');
    const querySnapshot = await getDocs(colRef);
    const students: any[] = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      students.push({
        id: data.id,
        order: data.order,
        name: data.name,
        gender: data.gender,
        zone: data.zone,
        street: data.street,
        buildingNo: data.buildingNo,
        landmark: data.landmark,
        lat: data.lat,
        lng: data.lng,
        dob: data.dob,
        grade: data.grade,
        servantName: data.servantName,
        servantPhone: data.servantPhone,
        classLocation: data.classLocation,
        buildingKey: data.buildingKey,
        boardingStatus: data.boardingStatus
      });
    });

    // Sort students by their proper order (1-16)
    students.sort((a, b) => a.order - b.order);
    return { success: true, data: students };
  } catch (err: any) {
    console.error('Firebase Firestore fetch failed:', err);
    return { success: false, error: err.message || String(err) };
  }
}
