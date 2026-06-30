# Roxy Smart-Bus — AI Agent Context Document

> Import this file into any AI agent, Claude Project, or RAG pipeline to give it complete knowledge of the Roxy Smart-Bus application: its architecture, student roster, data schema, APIs, deployment, and known issues.

---

## 1. Project Overview

**App name:** Roxy Smart-Bus (ROXY SMART-BUS)  
**Purpose:** School bus route planning and student attendance tracking for a Coptic church Sunday school bus operating in the Roxy / Heliopolis sector of Cairo, Egypt.  
**Primary user:** A teacher who rides the bus, checks in students, and calls parents.  
**Deployed at:** Vercel (auto-deploy from GitHub)  
**Stack:** React 19 + TypeScript + Vite (frontend) · Express/Node.js + Python (backend APIs) · Firebase Firestore (optional sync) · Tailwind CSS v4  
**Repo:** `school-bus-route-planner---attendance-tracker`

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend (Vite/Vercel static)                    │
│  ├── App.tsx              — root state, routing logic   │
│  ├── InteractiveMap.tsx   — Directions + 2D/3D SVG map  │
│  ├── StudentBoardingList  — attendance desk             │
│  ├── SmartBriefing        — AI dispatch co-pilot        │
│  ├── RoutePlanner         — TSP solver + hub selector   │
│  ├── AIEngineerLab        — developer tools panel       │
│  └── DelayAlertPanel      — traffic alert system        │
├─────────────────────────────────────────────────────────┤
│  Vercel Serverless Functions (api/)                     │
│  ├── dispatch-brief.ts    — AI briefing (Anthropic/Gemini)│
│  └── compute_route.py     — Google Routes API v2 proxy  │
├─────────────────────────────────────────────────────────┤
│  External APIs                                          │
│  ├── Google Maps JS SDK   — map tiles (Bus_App_Frontend_Key)│
│  ├── Google Routes API    — server-side routing (Bus_App_Backend_Key)│
│  ├── OSRM (public)        — free road routing in browser│
│  ├── OpenStreetMap tiles  — free map tiles in Directions tab│
│  ├── Anthropic Claude     — AI dispatch briefing        │
│  └── Firebase Firestore   — cross-device boarding sync  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Environment Variables (Vercel)

| Variable | Key Name | Used By |
|---|---|---|
| Google Maps (frontend) | `VITE_GOOGLE_MAPS_PLATFORM_KEY` | React map display, DirectionsService JS SDK |
| Google Maps (backend) | `GOOGLE_MAPS_PLATFORM_KEY` | `api/compute_route.py` → Routes API v2 |
| Anthropic | `ANTHROPIC_API_KEY` | `api/dispatch-brief.ts` → Claude AI briefing |
| Gemini (optional fallback) | `GEMINI_API_KEY` | `api/dispatch-brief.ts` fallback |
| Firebase (all VITE_ prefixed) | `VITE_FIREBASE_*` | Firestore cross-device sync |

**Google Cloud Console key names:**
- `Bus_App_Frontend_Key` → Maps JavaScript API + Directions API, Application restriction: None
- `Bus_App_Backend_Key` → Routes API only, Application restriction: None (IP restriction removed)

---

## 4. Student Roster — Monday Roxy Sector

**Total students:** 16 (stud_1 through stud_16)  
**Route:** Roxy Square → [16 student stops] → St. Mary Church Complex  
**Coordinate source:** GPS-resolved via HTTP redirect from parent-submitted Google Maps goo.gl links (Tier 2), inline URL extraction (Tier 1), or verified lookup table (Tier 3)

### Complete Student Data

| # | ID | Name (Arabic) | Street | Building | Grade | Building Key | Lat | Lng |
|---|---|---|---|---|---|---|---|---|
| 1 | stud_1 | ماريتشا مايكل نادي | السلحدار | ١١ | ثانية ابتدائي | wanas | 30.0910882 | 31.3179237 |
| 2 | stud_2 | جوني مينا جميل عبدالملك | السلحدار | 15 | ثالثة ابتدائي | wanas | 30.0913290 | 31.3137360 |
| 3 | stud_3 | اميلي مينا مدحت فرج | السلحدار | 16 | كي چي 2 | hadra | 30.0945 | 31.3142 |
| 4 | stud_4 | هولي مينا وجدي صابر | المفازة | ٣ | رابعة ابتدائي | wanas | 30.0932 | 31.3151 |
| 5 | stud_5 | كارين اسامه ابراهيم اسحق | الخليفه المامون | 78 | سادسة ابتدائي | nagar | 30.0916 | 31.3112 |
| 6 | stud_6 | كاراس اسامه ابراهيم اسحق | الخليفه المامون | 78 | ثالثة ابتدائي | wanas | 30.0916 | 31.3112 |
| 7 | stud_7 | صوفيا كريم جرجس فهمي | الخليفة المامون | ٤٥ | أولى ابتدائي | wanas | 30.091980 | 31.314333 |
| 8 | stud_8 | ريتا كريم جرجس فهمي | الخليفة المأمون | ٤٥ أ | رابعة ابتدائي | wanas | 30.091980 | 31.314333 |
| 9 | stud_9 | بارثنيا باسم عطيه عبده | الاشجار | ٧ | ثانية ابتدائي | wanas | 30.093182 | 31.313541 |
| 10 | stud_10 | ديماس باسم عطيه | الاشجار | 7 | كي چي 1 | hadra | 30.093182 | 31.313541 |
| 11 | stud_11 | بيرلا جون جميل حليم | الأشجار | ٧ | كي چي 2 | hadra | 30.0931580 | 31.3136230 |
| 12 | stud_12 | بيرلا رامي مهاب شكري | الشهيد حسين سليمان | ٣ | خامسة ابتدائي | nagar | 30.092979 | 31.312038 |
| 13 | stud_13 | يوسف رامي مهاب شكري | الشهيد حسين سليمان | ٣ | ثالثة ابتدائي | wanas | 30.092979 | 31.312038 |
| 14 | stud_14 | ماريا رامي جرجس بشاي | الشيخ ابو النور | 11 | رابعة ابتدائي | nagar | 30.0935100 | 31.3135080 |
| 15 | stud_15 | لاتويا بيتر هديه قريصه | الشيخ ابو النور | ٩ | ثانية ابتدائي | wanas | 30.0938510 | 31.3101190 |
| 16 | stud_16 | ماثيو فادي صفنات سعيد | الادفاوي | ٤ | خامسة ابتدائي | nagar | 30.0938510 | 31.3101190 |

### Parent Contact Numbers

| ID | Name | Parent 1 | Parent 2 | Child Phone | Home Phone |
|---|---|---|---|---|---|
| stud_1 | ماريتشا مايكل نادي | +201201287386 | +201063329736 | — | — |
| stud_2 | جوني مينا جميل عبدالملك | +201270700182 | +201282532032 | +201277702793 | — |
| stud_3 | اميلي مينا مدحت فرج | +201229291385 | +201229291385 | +201275455549 | 24509243 |
| stud_4 | هولي مينا وجدي صابر | +201283099541 | +201226832790 | +201117520150 | 22565288 |
| stud_5 | كارين اسامه ابراهيم اسحق | +201223320756 | +201222610039 | — | 24554360 |
| stud_6 | كاراس اسامه ابراهيم اسحق | +201223320756 | +201222610039 | — | 24554360 |
| stud_7 | صوفيا كريم جرجس فهمي | +201288889718 | +201225529368 | — | 22566663 |
| stud_8 | ريتا كريم جرجس فهمي | +201288889718 | +201229967767 | +201225529368 | 22566663 |
| stud_9 | بارثنيا باسم عطيه عبده | +201204995005 | +201204995005 | — | — |
| stud_10 | ديماس باسم عطيه | +201204995005 | +201225709990 | — | — |
| stud_11 | بيرلا جون جميل حليم | +201208963844 | +201222552226 | — | — |
| stud_12 | بيرلا رامي مهاب شكري | +201272660338 | +20100104105 | +201227211136 | 24548196 |
| stud_13 | يوسف رامي مهاب شكري | +201272660338 | +201001014105 | +201227211132 | 24548196 |
| stud_14 | ماريا رامي جرجس بشاي | +201011052642 | +201226508462 | +201227357651 | — |
| stud_15 | لاتويا بيتر هديه قريصه | +201022442752 | +201001020643 | +201036138511 | — |
| stud_16 | ماثيو فادي صفنات سعيد | +201273301000 | +201007836210 | +201551524165 | — |

### Servant (Class Teacher/Servant) Contacts

| ID | Name | Servant | Servant Phone |
|---|---|---|---|
| stud_1 | ماريتشا | مس اوليفيا | +201226749379 |
| stud_2 | جوني | أ/ مرقس | +201229197247 |
| stud_3 | اميلي | ا/مريم و ا/كارين و ا/مارينا | +201280142982 |
| stud_4 | هولي | مهرائيل - كرستين - ايريني | +201550565729 |
| stud_5 | كارين | سارة | +20127156582 |
| stud_6 | كاراس | يوسف | +201210392382 |
| stud_7 | صوفيا | maria-vava | +201200046367 |
| stud_8 | ريتا | justine | +201066391391 |
| stud_9 | بارثنيا | القديسة مرثا | +201279114004 |
| stud_10 | ديماس | الملاك سوريال | +201288892677 |
| stud_11 | بيرلا جون | مس جاسمين رأفت - مس ماريا كريم | +201276447610 |
| stud_12 | بيرلا رامي | ماريا جورج جولي عاطف و ميريت نبيه و كارول نادر | +201272627009 |
| stud_13 | يوسف | يوسف فايق و يوسف شريف و كيرلس سامر | +201210392382 |
| stud_14 | ماريا | انسطاسيه | +201279007411 |
| stud_15 | لاتويا | مارينا تامر | +201204253887 |
| stud_16 | ماثيو | مستر مينا توفيق | +201223549262 |

---

## 5. Data Schema (TypeScript)

```typescript
type BoardingStatus = 'waiting' | 'boarded' | 'absent' | 'arrived';
type BuildingKey = 'wanas' | 'hadra' | 'nagar' | 'new' | 'demiana';

interface Student {
  id: string;                    // 'stud_1' through 'stud_16'
  order: number;                 // CSV sequence order
  name: string;                  // Arabic full name
  gender: 'boy' | 'girl';
  zone: string;                  // neighbourhood zone
  street: string;                // Arabic street name
  buildingNo: string;            // building number (may be Arabic numerals)
  landmark: string;              // parent-provided landmark description
  mapUrl: string;                // Google Maps URL (goo.gl or maps.google.com)
  lat: number;                   // GPS-resolved latitude
  lng: number;                   // GPS-resolved longitude
  parentPhonePrimary?: string;   // primary parent mobile (+20...)
  parentPhoneSecondary?: string; // secondary parent mobile
  childPhone?: string;           // child's own mobile (optional)
  homePhone?: string;            // landline (optional)
  dateOfBirth: string;           // DD/MM/YYYY
  grade: string;                 // Arabic grade name
  notes?: string;
  servantName: string;           // Sunday school class servant
  servantPhone: string;
  classLocation: string;         // e.g. 'مبنى الأنبا ونس'
  buildingKey: BuildingKey;      // which school building they go to
  boardingStatus: BoardingStatus;
  boardingTime?: string;
}

interface RouteStop {
  id: string;             // 'start', studentId, or 'end'
  name: string;
  type: 'hub' | 'pickup' | 'drop';
  lat: number;
  lng: number;
  studentId?: string;
  eta: string;
  distanceFromPrev: number; // km
  durationFromPrev: number; // minutes
}
```

---

## 6. Building Keys & Drop Sequence

The church complex has 5 buildings. The optimal drop sequence is:

| Key | Arabic Name | Color | Priority | Students |
|---|---|---|---|---|
| `hadra` | مبنى الأنبا هدرا | Blue `#3B82F6` | 1st (KG/Grade 1-2, youngest) | stud_3, stud_10, stud_11 |
| `wanas` | مبنى الأنبا ونس | Green `#10B981` | 2nd | stud_1,2,4,6,7,8,9,13,15 |
| `nagar` | مبنى يوسف النجار | Amber `#F59E0B` | 3rd | stud_5, stud_12, stud_14, stud_16 |
| `demiana` | مبنى القديسة دميانة | Purple `#8B5CF6` | 4th | (future students) |
| `new` | المبنى الجديد | Red `#EF4444` | 5th | (future students) |

---

## 7. Route Hubs

### Start Hubs
| ID | Name | Lat | Lng |
|---|---|---|---|
| `roxy_square` | ميدان روكسي | 30.0900 | 31.3100 |
| `saint_mark_church` | كنيسة مارمرقس كليوباترا | 30.0935 | 31.3296 |
| `heliopolis_club` | نادي الجزيرة هليوبوليس | 30.0880 | 31.3220 |

### End Hubs
| ID | Name | Lat | Lng |
|---|---|---|---|
| `church_complex` | مجمع الكنيسة - روكسي | 30.0965 | 31.3160 |
| `saint_mark_church` | كنيسة مارمرقس كليوباترا | 30.0935 | 31.3296 |
| `roxy_square` | ميدان روكسي | 30.0900 | 31.3100 |

**Default route:** `roxy_square` → students → `church_complex`

---

## 8. Routing System

### Three-Tier Fallback Chain

```
Tier 1: /api/compute-route (Python → Google Routes API v2)
         ↓ fails if GOOGLE_MAPS_PLATFORM_KEY not set or Routes API not enabled
Tier 2: DirectionsService JS SDK (Google Maps, requires frontend key)
         ↓ fails if demo key or key restrictions block it
Tier 3: Offline Heliopolis street graph (always works, lowest accuracy)
```

### TSP Algorithm
- Type: Greedy nearest-neighbour with configurable cost function
- Solver config: `{ type: 'priority' | 'distance' | 'traffic', alpha, beta, gamma }`
- `alpha` = distance weight, `beta` = traffic weight, `gamma` = building priority weight

### Google Routes API Payload Structure
```json
{
  "origin": { "location": { "latLng": { "latitude": 30.09, "longitude": 31.31 } } },
  "destination": { "location": { "latLng": { "latitude": 30.0965, "longitude": 31.316 } } },
  "intermediates": [
    {
      "location": { "latLng": { "latitude": 30.091, "longitude": 31.318 } },
      "vehicleStopover": true,
      "sideOfRoad": true
    }
  ],
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE",
  "optimizeWaypointOrder": true,
  "regionCode": "EG",
  "languageCode": "ar"
}
```

`sideOfRoad: true` on every intermediate waypoint prevents the bus from being routed across road medians and eliminates illegal U-turns — the core fix for the road-crossing problem.

---

## 9. Map Views

| Tab | Technology | Requires Key | Status |
|---|---|---|---|
| **Directions** | Leaflet.js + OSRM (self-contained iframe) | ❌ None | ✅ Working |
| **2D Flat** | Custom SVG with Heliopolis road graph | ❌ None | ✅ Working |
| **3D View** | Same SVG with CSS 3D transform | ❌ None | ✅ Working |
| ~~Google Map~~ | ~~@vis.gl/react-google-maps~~ | ~~✅ Frontend Key~~ | 🗑️ Removed |

### Directions Tab — Step-by-Step Navigation
- Shows a **START ROUTE** button with a preview of all stops
- Routes one leg at a time (current stop → next stop) via OSRM
- Eliminates road-crossing by sending only 2 coordinates per OSRM request
- **NEXT →** / **← PREV** buttons navigate between stops
- Progress dots show current position in the route
- **Navigate** button opens the current leg in Google Maps (for phone turn-by-turn)
- **Full Route** button opens the entire route in Google Maps
- Stop strip at the bottom shows the full ordered pickup sequence

---

## 10. AI Dispatch Co-Pilot

**Endpoint:** `POST /api/dispatch-brief`  
**File:** `api/dispatch-brief.ts` (Vercel serverless TypeScript)

### Priority Chain
1. Anthropic Claude (`claude-haiku-4-5-20251001`) via `ANTHROPIC_API_KEY`
2. Gemini (`gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-flash-8b`) via `GEMINI_API_KEY`
3. Hardcoded fallback brief (local routing mode)

### Request Payload
```json
{
  "startHubName": "ميدان روكسي",
  "endHubName": "مجمع الكنيسة - روكسي",
  "totalDistance": 4.5,
  "totalDuration": 15,
  "boardedCount": 0,
  "waitingCount": 16,
  "absentCount": 0,
  "activeAlerts": [],
  "buildingBreakdown": { "hadra": 3, "wanas": 9, "nagar": 4 },
  "temperature": 0.4
}
```

### System Prompt Context for Dispatch AI
- The AI is the **Roxy Dispatch Co-pilot** for Heliopolis Cairo school routes
- Key streets: El Selahdar, El Mokrizi, Khalifa El Mamoun, Al Ashgar, Abu El Nour
- Building drop priority: Hadra (KG first) → Wanas → Nagar
- Generates 3-sentence audio-ready brief in English with Cairo street names

---

## 11. Python Data Pipeline (`assess_routes.py`)

Standalone script for processing any student roster CSV through Google Routes API.

### Usage
```powershell
# Windows PowerShell
$env:GOOGLE_MAPS_PLATFORM_KEY="AIzaSy...your_backend_key"
python assess_routes.py
```

### Three-Tier Coordinate Resolution
```
Tier 1: Extract lat/lng inline from URL string (?q=lat,lng or @lat,lng)
Tier 2: Follow HTTP redirects on goo.gl shortened URLs → extract coords
Tier 3: Look up student name in KNOWN_STUDENT_COORDS hardcoded table
→ Any row still missing coords is DROPPED with a console warning
```

### CSV Column Mapping (Monday_-_روكسى.csv)
| Arabic Column | Canonical Field |
|---|---|
| الاسم رباعي | name |
| شارع | street |
| رقم العمارة | building |
| السنة الدراسية | grade |
| مكان الفصل | classroom |
| Google Maps Location | map_url |
| رقم موبايل الأهل الأساسي | phone_primary |
| رقم موبايل الأهل الثانوي | phone_secondary |
| رقم موبايل الطفل | phone_child |
| رقم تليفون البيت | phone_home |
| إسم خادم / خادمة الفصل | servant_name |
| رقم تليفون خادم / خادمة الفصل | servant_phone |

---

## 12. Firebase Integration

**Purpose:** Cross-device boarding status sync (teacher's phone ↔ bus coordinator's screen)  
**Collection:** `students` in Firestore  
**Required Firestore rules:** Allow read/write for authenticated users or set open rules for internal use  
**Note:** Firebase errors (`Missing or insufficient permissions`) are non-fatal — the app falls back to localStorage

---

## 13. Key File Locations

```
/
├── src/
│   ├── App.tsx                  — root: state, TSP solver, route calculation
│   ├── types.ts                 — all TypeScript interfaces
│   ├── data/students.ts         — 16 students + hubs + buildings
│   ├── utils/routing.ts         — 3-tier routing fallback chain
│   └── components/
│       ├── InteractiveMap.tsx   — Directions/2D/3D map views
│       ├── StudentBoardingList  — attendance desk with call/WhatsApp buttons
│       ├── SmartBriefing.tsx    — AI dispatch panel
│       ├── RoutePlanner.tsx     — hub selector + route config
│       ├── AIEngineerLab.tsx    — developer tools
│       └── DelayAlertPanel.tsx  — traffic alerts
├── api/
│   ├── dispatch-brief.ts        — Vercel serverless: AI briefing
│   └── compute_route.py         — Vercel serverless: Google Routes API proxy
├── assess_routes.py             — standalone Python pipeline script
├── vercel.json                  — Vercel routing config
└── .env.example                 — all required environment variables
```

---

## 14. Known Issues & Status

| Issue | Status | Notes |
|---|---|---|
| Routes API 400 error | ✅ Fixed | Was billing not enabled; now proxied via Python backend |
| `tel:undefined` in contact card | ✅ Fixed | Phone fields made optional, guarded rendering |
| Road-crossing polyline | ✅ Fixed | OSRM one-leg-at-a-time in Directions tab |
| Google Maps tab broken | ✅ Removed | Replaced by Directions tab (Leaflet+OSRM, free) |
| AI dispatch "Failed to communicate" | ✅ Fixed | Added `api/dispatch-brief.ts` Vercel serverless function |
| Wrong Gemini model names | ✅ Fixed | Updated to `gemini-2.0-flash`, `gemini-1.5-flash` |
| `optimizeWaypointOrder` in wrong place | ✅ Fixed | Moved to top level of Routes API payload |
| Default hub wrong (St. Mark far east) | ✅ Fixed | Now defaults to `roxy_square` → `church_complex` |
| localStorage crash on redeploy | ✅ Fixed | All localStorage reads wrapped in try/catch |
| Student coords inaccurate | ✅ Fixed | GPS-resolved via Tier 2 HTTP redirect from goo.gl links |
| Directions tab showing all stops at once | ✅ Fixed | Step-by-step navigation with START button |
| CSV data not fully imported | ✅ Fixed | All 16 students with complete data including all phones |
| `Function Runtimes must have a valid version` | ✅ Fixed | Removed `functions` block from vercel.json |
| SVG map bounds too narrow | ✅ Fixed | Expanded to cover all student coordinates |

---

## 15. Deployment Checklist

When redeploying after changes:

1. **Replace all files** in GitHub repo from the ZIP (excluding `node_modules`, `package-lock.json`, `.git`)
2. **Run `npm install`** locally after extracting (package-lock.json excluded from ZIP)
3. **Vercel environment variables** must include all 5 keys (see Section 3)
4. **Clear browser localStorage** after deploy: F12 → Application → Local Storage → Clear
5. **Google Cloud Console** — ensure `Bus_App_Backend_Key` has Routes API enabled and no IP restrictions
6. **Google Cloud Console** — ensure `Bus_App_Frontend_Key` has Maps JavaScript API + Directions API, Application restriction: None

---

## 16. Geographic Context

**Area:** Roxy / Heliopolis, Cairo, Egypt  
**Bounding box:** lat 30.088–30.100, lng 31.306–31.332  
**Key streets:**
- **El Selahdar (السلحدار)** — stud_1, stud_2, stud_3
- **Al Mafaza (المفازة)** — stud_4
- **Khalifa El Mamoun (الخليفه المامون)** — stud_5, stud_6, stud_7, stud_8
- **Al Ashgar (الاشجار / الأشجار)** — stud_9, stud_10, stud_11
- **Al Shaheed Hussein Suleiman (الشهيد حسين سليمان)** — stud_12, stud_13
- **Sheikh Abu El Nour (الشيخ ابو النور)** — stud_14, stud_15
- **Al Adfawi (الادفاوي)** — stud_16

**Traffic hotspot:** Khalifa El Mamoun street (congestion during school hours — suggest El Selahdar St as alternative)

---

## 17. Adding New Students

To add a student from a new CSV row:

1. Add a new entry to `INITIAL_STUDENTS` array in `src/data/students.ts`
2. Use the next available `stud_N` ID and increment `order`
3. Resolve coordinates via `assess_routes.py` (run against the new CSV)
4. Set `boardingStatus: 'waiting'`
5. Choose `buildingKey` based on classroom building
6. Rebuild and redeploy

**Sibling rule:** Students at the same address share the same `lat`/`lng` but have unique `id` values. They appear as a single pin on the map with a count badge.
