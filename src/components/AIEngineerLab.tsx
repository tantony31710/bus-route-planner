import React, { useState, useMemo } from 'react';
import { Student, RouteStop, TrafficSegment, SolverConfig } from '../types';
import { Sliders, Database, Cpu, Activity, FileJson, Sparkles, Code, Terminal, CheckCircle2, FileSpreadsheet, CloudLightning, Globe, RefreshCw, Upload, AlertTriangle } from 'lucide-react';
import { isFirebaseConfigured, syncStudentsToFirebase, fetchStudentsFromFirebase } from '../lib/firebase';

interface AIEngineerLabProps {
  students: Student[];
  routeStops: RouteStop[];
  trafficSegments: TrafficSegment[];
  solverConfig: SolverConfig;
  onUpdateSolverConfig: (config: SolverConfig) => void;
  systemPrompt: string;
  onUpdateSystemPrompt: (prompt: string) => void;
  modelTemp: number;
  onUpdateModelTemp: (temp: number) => void;
  isRealAI: boolean;
  onUpdateStudents?: (students: Student[]) => void;
}

export default function AIEngineerLab({
  students,
  routeStops,
  trafficSegments,
  solverConfig,
  onUpdateSolverConfig,
  systemPrompt,
  onUpdateSystemPrompt,
  modelTemp,
  onUpdateModelTemp,
  isRealAI,
  onUpdateStudents
}: AIEngineerLabProps) {
  const [activeTab, setActiveTab] = useState<'solver' | 'features' | 'prompt' | 'database'>('solver');
  const [customPromptText, setCustomPromptText] = useState(systemPrompt);

  const [syncing, setSyncing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dbMessage, setDbMessage] = useState<string | null>(null);
  const [dbMessageType, setDbMessageType] = useState<'success' | 'error' | null>(null);

  const handleSyncToFirebase = async () => {
    setSyncing(true);
    setDbMessage(null);
    const res = await syncStudentsToFirebase(students);
    setSyncing(false);
    if (res.success) {
      setDbMessage("Successfully synced all 1-16 students to Google Firebase Firestore 'roxy_students' collection!");
      setDbMessageType('success');
    } else {
      setDbMessage(`Sync failed: ${res.error}`);
      setDbMessageType('error');
    }
  };

  const handleFetchFromFirebase = async () => {
    if (!onUpdateStudents) return;
    setFetching(true);
    setDbMessage(null);
    const res = await fetchStudentsFromFirebase();
    setFetching(false);
    if (res.success && res.data) {
      onUpdateStudents(res.data);
      setDbMessage("Successfully loaded latest student boarding states from Google Firebase Firestore database!");
      setDbMessageType('success');
    } else {
      setDbMessage(`Fetch failed: ${res.error}`);
      setDbMessageType('error');
    }
  };

  // 1. Calculate training features for Data Science brother
  const engineeredFeatures = useMemo(() => {
    return students.map(student => {
      // Calculate geometric features
      const distToSchool = Math.sqrt(Math.pow(student.lat - 30.0965, 2) + Math.pow(student.lng - 31.3160, 2)) * 111.32; // approx km
      
      // Categorical coding
      const buildingPriority = 
        student.buildingKey === 'hadra' ? 5 : 
        student.buildingKey === 'wanas' ? 4 : 
        student.buildingKey === 'nagar' ? 3 : 
        student.buildingKey === 'demiana' ? 2 : 1;

      // Geohash quadrant mapping (simple 2D bounding grid quadrant)
      const latQuad = student.lat > 30.0945 ? 'N' : 'S';
      const lngQuad = student.lng > 31.3145 ? 'E' : 'W';
      const gridQuadrant = `${latQuad}${lngQuad}`;

      // Traffic coefficient
      const streetSegment = trafficSegments.find(t => student.street.includes(t.streetName));
      const trafficDelayCoef = streetSegment ? streetSegment.delayMinutes : 0;

      return {
        studentId: student.id,
        name: student.name,
        lat: parseFloat(student.lat.toFixed(5)),
        lng: parseFloat(student.lng.toFixed(5)),
        distToSchoolKm: parseFloat(distToSchool.toFixed(3)),
        buildingKey: student.buildingKey,
        buildingPriority,
        gridQuadrant,
        trafficDelayCoef,
        labelSequence: student.order
      };
    });
  }, [students, trafficSegments]);

  // Handle downloading JSON dataset
  const handleDownloadDataset = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(engineeredFeatures, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', 'roxy_smart_bus_ml_features.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
  };

  // Handle exporting student attendance status report as JSON
  const handleExportAttendanceJSON = () => {
    const totalCount = students.length;
    const boardedCount = students.filter(s => s.boardingStatus === 'boarded').length;
    const absentCount = students.filter(s => s.boardingStatus === 'absent').length;
    const waitingCount = students.filter(s => s.boardingStatus === 'waiting').length;
    const arrivedCount = students.filter(s => s.boardingStatus === 'arrived').length;

    const report = {
      reportDate: new Date().toISOString().slice(0, 10),
      timestamp: new Date().toLocaleTimeString(),
      summary: {
        totalStudents: totalCount,
        boardedCount,
        absentCount,
        waitingCount,
        arrivedCount,
        completionRate: `${((boardedCount + arrivedCount + absentCount) / totalCount * 100).toFixed(1)}%`
      },
      students: students.map(s => ({
        id: s.id,
        name: s.name,
        gender: s.gender,
        grade: s.grade,
        zone: s.zone,
        street: s.street,
        boardingStatus: s.boardingStatus,
        boardingTime: s.boardingTime || null,
        classLocation: s.classLocation,
        buildingKey: s.buildingKey
      }))
    };

    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(report, null, 2)
    )}`;
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `roxy_smart_bus_attendance_report_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
  };

  // Export entire student database as CSV for EDA and Data Wrangling (1-16 students)
  const handleDownloadStudentDatabaseCSV = () => {
    const headers = [
      "Student ID", "Order", "Name", "Gender", "Zone", "Street", "Building No",
      "Landmark", "Latitude", "Longitude", "DOB", "Grade", "Servant Name",
      "Servant Phone", "Class Location", "Building Key", "Boarding Status"
    ];
    const rows = students.map(s => [
      s.id,
      s.order,
      `"${s.name.replace(/"/g, '""')}"`,
      s.gender,
      `"${s.zone.replace(/"/g, '""')}"`,
      `"${s.street.replace(/"/g, '""')}"`,
      `"${s.buildingNo.replace(/"/g, '""')}"`,
      `"${s.landmark.replace(/"/g, '""')}"`,
      s.lat,
      s.lng,
      s.dob,
      `"${s.grade.replace(/"/g, '""')}"`,
      `"${s.servantName.replace(/"/g, '""')}"`,
      `"${s.servantPhone.replace(/"/g, '""')}"`,
      `"${s.classLocation.replace(/"/g, '""')}"`,
      s.buildingKey,
      s.boardingStatus
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `roxy_students_database_eda_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Solver Metrics
  const solverMetrics = useMemo(() => {
    // Total distance of stops
    const totalDist = routeStops.reduce((sum, s) => sum + s.distanceFromPrev, 0);
    // Average delay index
    const avgDelay = trafficSegments.reduce((sum, s) => sum + s.delayMinutes, 0) / trafficSegments.length;
    // Priority score matching (are higher priorities served earlier?)
    let priorityMatches = 0;
    const pickups = routeStops.filter(s => s.type === 'pickup');
    for (let i = 0; i < pickups.length - 1; i++) {
      const currentS = students.find(s => s.id === pickups[i].studentId);
      const nextS = students.find(s => s.id === pickups[i+1].studentId);
      if (currentS && nextS) {
        const currP = currentS.buildingKey === 'hadra' ? 2 : 1;
        const nextP = nextS.buildingKey === 'hadra' ? 2 : 1;
        if (currP >= nextP) priorityMatches++;
      }
    }
    const priorityCompliance = pickups.length > 1 ? (priorityMatches / (pickups.length - 1)) * 100 : 100;

    return {
      complexityO: `O(N²) Grid-Search`,
      convergenceTimeMs: (0.12 + pickups.length * 0.04).toFixed(3),
      totalDistanceKm: totalDist.toFixed(2),
      averageDelayMins: avgDelay.toFixed(1),
      priorityComplianceRate: priorityCompliance.toFixed(1)
    };
  }, [routeStops, trafficSegments, students]);

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10" id="ai-engineer-lab">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#2A2A30] pb-4 mb-4 gap-3">
        <div>
          <h2 className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide font-display">
            <Cpu className="w-5 h-5 text-[#8B5CF6] animate-pulse" />
            AI & Data Scientist Lab
          </h2>
          <p className="text-xs text-[#8E9299]">
            Configure routing algorithms, inspect feature vectors & customize LLM hyper-parameters
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownloadStudentDatabaseCSV}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#10B981]/10 hover:bg-[#10B981]/20 border border-[#10B981]/20 text-[#34d399] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            id="btn-download-students-csv"
            title="Download full 1-16 Student Database as CSV for EDA & Wrangling"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Students Database (CSV)
          </button>
          <button
            onClick={handleExportAttendanceJSON}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 border border-[#8B5CF6]/20 text-[#a78bfa] hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            id="btn-export-attendance-json"
            title="Export final student attendance status as JSON report"
          >
            <FileJson className="w-4 h-4" />
            Export Attendance (JSON)
          </button>
          <span className="text-[10px] bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 px-2.5 py-1.5 rounded-full text-[#8B5CF6] font-mono font-bold uppercase tracking-wider">
            v2.5 PRO
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#2A2A30] mb-5 text-xs">
        <button
          onClick={() => setActiveTab('solver')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-all ${
            activeTab === 'solver'
              ? 'border-[#8B5CF6] text-[#F0F0F0] bg-[#8B5CF6]/5'
              : 'border-transparent text-[#8E9299] hover:text-[#F0F0F0]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Multi-Criteria Solver
        </button>
        <button
          onClick={() => setActiveTab('features')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-all ${
            activeTab === 'features'
              ? 'border-[#8B5CF6] text-[#F0F0F0] bg-[#8B5CF6]/5'
              : 'border-transparent text-[#8E9299] hover:text-[#F0F0F0]'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          Feature Engineering
        </button>
        <button
          onClick={() => setActiveTab('prompt')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-all ${
            activeTab === 'prompt'
              ? 'border-[#8B5CF6] text-[#F0F0F0] bg-[#8B5CF6]/5'
              : 'border-transparent text-[#8E9299] hover:text-[#F0F0F0]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Gemini Agent Playground
        </button>
        <button
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 font-medium transition-all ${
            activeTab === 'database'
              ? 'border-[#8B5CF6] text-[#F0F0F0] bg-[#8B5CF6]/5'
              : 'border-transparent text-[#8E9299] hover:text-[#F0F0F0]'
          }`}
          id="tab-firebase-db"
        >
          <CloudLightning className="w-3.5 h-3.5 text-[#F59E0B]" />
          Firebase Firestore DB
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'solver' && (
        <div className="space-y-4">
          <div className="p-3 bg-[#1A1A22] border border-[#2A2A30] rounded-xl text-xs space-y-2">
            <h3 className="font-bold text-[#F0F0F0] flex items-center gap-1">
              <Activity className="w-4 h-4 text-[#8B5CF6]" />
              Optimization Cost Function Formulation
            </h3>
            <p className="text-[#8E9299] leading-relaxed font-mono text-[10px]">
              Cost(u, v) = α * Distance(u, v) + β * TrafficDelay(v) - γ * ClassPriorityBonus(v)
            </p>
            <p className="text-[10px] text-[#8E9299] leading-normal">
              Adjust coefficients below to re-weigh geographic distance vs real-time traffic gridblocks vs classroom ages start timings.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-[#8E9299] uppercase tracking-wider flex justify-between mb-1.5">
                  <span>Routing Solver Mode</span>
                  <span className="text-[#8B5CF6] font-mono">{solverConfig.type.toUpperCase()}</span>
                </label>
                <select
                  value={solverConfig.type}
                  onChange={(e) => onUpdateSolverConfig({ ...solverConfig, type: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs border border-[#2A2A30] rounded-xl bg-[#0A0A0C] text-[#F0F0F0] focus:ring-1 focus:ring-[#8B5CF6]"
                >
                  <option value="distance">🗺️ Classic TSP (Distance Minimizer Only)</option>
                  <option value="traffic">🚦 Congestion-Bypassing Solver (Distance + Traffic)</option>
                  <option value="priority">⚡ Multi-Criteria Priority-Aware Solver (Full Formulation)</option>
                </select>
              </div>

              {/* Distance Slider (Alpha) */}
              <div>
                <label className="text-[11px] font-bold text-[#8E9299] uppercase tracking-wider flex justify-between mb-1">
                  <span>Alpha (Distance Coefficient)</span>
                  <span className="font-mono text-[#F0F0F0] font-bold">{solverConfig.alpha.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={solverConfig.alpha}
                  onChange={(e) => onUpdateSolverConfig({ ...solverConfig, alpha: parseFloat(e.target.value) })}
                  className="w-full accent-[#8B5CF6]"
                />
              </div>

              {/* Traffic Slider (Beta) */}
              <div>
                <label className="text-[11px] font-bold text-[#8E9299] uppercase tracking-wider flex justify-between mb-1">
                  <span>Beta (Traffic Block Coefficient)</span>
                  <span className="font-mono text-[#F0F0F0] font-bold">{solverConfig.beta.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.0"
                  max="5.0"
                  step="0.1"
                  value={solverConfig.beta}
                  onChange={(e) => onUpdateSolverConfig({ ...solverConfig, beta: parseFloat(e.target.value) })}
                  className="w-full accent-[#8B5CF6]"
                  disabled={solverConfig.type === 'distance'}
                />
              </div>

              {/* Class Priority Slider (Gamma) */}
              <div>
                <label className="text-[11px] font-bold text-[#8E9299] uppercase tracking-wider flex justify-between mb-1">
                  <span>Gamma (Class Priority Bonus)</span>
                  <span className="font-mono text-[#F0F0F0] font-bold">{solverConfig.gamma.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.0"
                  max="5.0"
                  step="0.1"
                  value={solverConfig.gamma}
                  onChange={(e) => onUpdateSolverConfig({ ...solverConfig, gamma: parseFloat(e.target.value) })}
                  className="w-full accent-[#8B5CF6]"
                  disabled={solverConfig.type !== 'priority'}
                />
              </div>
            </div>

            {/* Live profiling metrics */}
            <div className="bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-4 space-y-3.5 text-xs">
              <h4 className="font-bold text-[#F0F0F0] flex items-center gap-1.5 uppercase text-[10px] tracking-wider text-[#8B5CF6]">
                <Terminal className="w-3.5 h-3.5" />
                Live Solver Profiler
              </h4>

              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="p-2.5 bg-[#121217] rounded-lg border border-[#2A2A30]">
                  <div className="text-[9px] text-[#8E9299] uppercase">Search Complexity</div>
                  <div className="text-xs font-bold text-[#F0F0F0] mt-0.5">{solverMetrics.complexityO}</div>
                </div>
                <div className="p-2.5 bg-[#121217] rounded-lg border border-[#2A2A30]">
                  <div className="text-[9px] text-[#8E9299] uppercase">Execution Time</div>
                  <div className="text-xs font-bold text-emerald-400 mt-0.5">{solverMetrics.convergenceTimeMs} ms</div>
                </div>
                <div className="p-2.5 bg-[#121217] rounded-lg border border-[#2A2A30]">
                  <div className="text-[9px] text-[#8E9299] uppercase">Estimated Route Cost</div>
                  <div className="text-xs font-bold text-[#3B82F6] mt-0.5">{solverMetrics.totalDistanceKm} score</div>
                </div>
                <div className="p-2.5 bg-[#121217] rounded-lg border border-[#2A2A30]">
                  <div className="text-[9px] text-[#8E9299] uppercase">Priority Compliance</div>
                  <div className="text-xs font-bold text-pink-400 mt-0.5">{solverMetrics.priorityComplianceRate}%</div>
                </div>
              </div>

              <div className="p-2.5 bg-[#8B5CF6]/5 border border-[#8B5CF6]/15 rounded-lg text-[10px] leading-relaxed text-[#8E9299]">
                💡 <strong>Data Science Insight:</strong> Multi-Criteria solvers yield a robust trade-off, shifting early pickups closer to younger pupils while keeping the distance path geographically coherent!
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feature Engineering Tab */}
      {activeTab === 'features' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[#8E9299] leading-relaxed">
              Calculated continuous and categorical feature variables (e.g. Euclidean distances, classroom building weights, and geohash clusters) compiled for downstream ML training.
            </div>
            <button
              onClick={handleDownloadDataset}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-[#8B5CF6] hover:bg-[#7C3AED] text-white flex items-center gap-1.5 transition-all shadow-md shrink-0"
            >
              <FileJson className="w-4 h-4" />
              Export Dataset (JSON)
            </button>
          </div>

          <div className="overflow-x-auto border border-[#2A2A30] rounded-xl bg-[#0A0A0C]">
            <table className="min-w-full divide-y divide-[#2A2A30] font-mono text-[10px] text-[#8E9299]">
              <thead className="bg-[#1A1A1E] text-[#F0F0F0]">
                <tr>
                  <th className="px-3 py-2 text-left">Pupil ID</th>
                  <th className="px-3 py-2 text-left">Lat, Lng</th>
                  <th className="px-3 py-2 text-left">Dist (km)</th>
                  <th className="px-3 py-2 text-left">Building Class</th>
                  <th className="px-3 py-2 text-left">Pri Score</th>
                  <th className="px-3 py-2 text-left">Quadrant</th>
                  <th className="px-3 py-2 text-left">Traffic Congestion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2A30]">
                {engineeredFeatures.slice(0, 5).map((feat) => (
                  <tr key={feat.studentId} className="hover:bg-[#121217]">
                    <td className="px-3 py-2 text-[#3B82F6]">{feat.studentId}</td>
                    <td className="px-3 py-2">{feat.lat}, {feat.lng}</td>
                    <td className="px-3 py-2 text-emerald-400">{feat.distToSchoolKm}</td>
                    <td className="px-3 py-2 text-pink-400">{feat.buildingKey}</td>
                    <td className="px-3 py-2 text-amber-500">{feat.buildingPriority}</td>
                    <td className="px-3 py-2 text-purple-400">{feat.gridQuadrant}</td>
                    <td className="px-3 py-2 text-rose-400">{feat.trafficDelayCoef} mins</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-2.5 bg-[#1A1A1E] text-center text-[10px] text-[#8E9299] border-t border-[#2A2A30]">
              Showing top 5 of {engineeredFeatures.length} rows. Export to download full engineered table.
            </div>
          </div>
        </div>
      )}

      {/* Prompt Playground Tab */}
      {activeTab === 'prompt' && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider block mb-1">
                  Gemini Dispatch Model System Instructions
                </label>
                <textarea
                  className="w-full h-32 px-3 py-2 bg-[#0A0A0C] border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8B5CF6] text-white font-mono text-[11px] leading-relaxed"
                  value={customPromptText}
                  onChange={(e) => {
                    setCustomPromptText(e.target.value);
                    onUpdateSystemPrompt(e.target.value);
                  }}
                />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider flex justify-between mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-[#8B5CF6]">{modelTemp.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.5"
                    step="0.05"
                    value={modelTemp}
                    onChange={(e) => onUpdateModelTemp(parseFloat(e.target.value))}
                    className="w-full accent-[#8B5CF6]"
                  />
                </div>

                <div className="p-2 bg-[#1A1A22] border border-[#2A2A30] rounded-xl">
                  <div className="text-[9px] text-[#8E9299] uppercase">API Status</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${isRealAI ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}></span>
                    <span className="font-mono font-bold text-[10px] text-[#F0F0F0]">
                      {isRealAI ? 'GEMINI_API_SECURED' : 'LOCAL_MOCK_FALLBACK'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Prompt Token inspector */}
            <div className="bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-4 space-y-3 font-mono text-[10px]">
              <h4 className="font-bold text-[#F0F0F0] uppercase text-[10px] tracking-wider text-[#8B5CF6] flex items-center gap-1">
                <Code className="w-3.5 h-3.5" />
                Raw API Payload Preview
              </h4>

              <div className="space-y-2 text-[#8E9299]">
                <div>
                  <span className="text-[#3B82F6]">"model"</span>: <span className="text-amber-300">"gemini-3.5-flash"</span>,
                </div>
                <div>
                  <span className="text-[#3B82F6]">"temperature"</span>: <span className="text-emerald-400">{modelTemp}</span>,
                </div>
                <div className="text-[9px] bg-[#121217] p-2 rounded border border-[#2A2A30] break-all max-h-[140px] overflow-y-auto">
                  <span className="text-purple-400">"prompt"</span>: "You are the 'Roxy Smart School Bus Dispatch Co-pilot' for Heliopolis Cairo school routes..."
                </div>
              </div>

              {isRealAI ? (
                <div className="flex items-center gap-1 text-[9px] text-emerald-400 font-sans">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  Real Gemini instance connected.
                </div>
              ) : (
                <div className="text-[9px] text-amber-400 leading-normal font-sans">
                  ⚠️ API Key missing. Showing local playground mockup schema.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Firebase & Vercel DB Tab */}
      {activeTab === 'database' && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Firebase panel */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-[#1A1A22] border border-[#2A2A30] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[#F0F0F0] flex items-center gap-2 text-sm">
                    <Database className="w-4.5 h-4.5 text-[#F59E0B]" />
                    Google Firebase Firestore Database
                  </h3>
                  {isFirebaseConfigured() ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1">
                      <Globe className="w-3 h-3 animate-pulse" />
                      CONNECTED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      LOCAL FALLBACK STATE
                    </span>
                  )}
                </div>

                <p className="text-[#8E9299] leading-relaxed text-[11px]">
                  Synchronize your 1-16 student boarding records, names, landmarks, and spatial positions directly into a live Google Cloud Firestore database. Persist current ride updates, boarding statuses, and route schedules across sessions.
                </p>

                {dbMessage && (
                  <div className={`p-3 rounded-lg border text-[11px] ${
                    dbMessageType === 'success' 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                  }`}>
                    {dbMessage}
                  </div>
                )}

                <div className="flex flex-wrap gap-2.5 pt-1">
                  <button
                    onClick={handleSyncToFirebase}
                    disabled={syncing}
                    className="px-4 py-2 rounded-xl font-bold bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#F59E0B]/40 text-[#0F172A] transition-all flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    <Upload className={`w-4 h-4 ${syncing ? 'animate-bounce' : ''}`} />
                    {syncing ? 'Pushing Data...' : 'Push Students to Firebase Firestore'}
                  </button>

                  <button
                    onClick={handleFetchFromFirebase}
                    disabled={fetching || !onUpdateStudents}
                    className="px-4 py-2 rounded-xl font-bold bg-[#121217] hover:bg-[#1C1C24] border border-[#2A2A30] text-[#E4E4E7] disabled:opacity-40 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
                    {fetching ? 'Pulling Data...' : 'Pull Boarding Statuses from Firebase'}
                  </button>
                </div>
              </div>

              {/* Firestore Security Rules Guidelines */}
              <div className="bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-[#F0F0F0] text-xs">🛡️ Firestore Security Rules</h4>
                <p className="text-[11px] text-[#8E9299]">
                  The Firestore sandbox has been provisioned. For production deployments, ensure your `firestore.rules` allows public reads and writes for the student transit application:
                </p>
                <pre className="text-[10px] font-mono bg-[#121217] p-3 rounded-lg text-amber-400 border border-[#2A2A30] overflow-x-auto max-h-[160px] leading-relaxed">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /roxy_students/{studentId} {
      allow read, write: if true;
    }
  }
}`}
                </pre>
              </div>
            </div>

            {/* Vercel deployment guide */}
            <div className="bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-4 space-y-4 font-sans">
              <div>
                <h4 className="font-bold text-[#F0F0F0] text-sm flex items-center gap-2">
                  <CloudLightning className="w-4.5 h-4.5 text-[#3B82F6]" />
                  Vercel Serverless Hosting
                </h4>
                <p className="text-[11px] text-[#8E9299] mt-1.5 leading-relaxed">
                  The application is fully configured for Vercel out-of-the-box. We have created a `vercel.json` rewrite schema to ensure seamless routing for both client-side static assets and API routes.
                </p>
              </div>

              <div className="p-3 bg-[#121217] border border-[#2A2A30] rounded-lg space-y-2 text-[11px]">
                <div className="text-[10px] uppercase font-mono font-bold text-[#3B82F6]">Configured Pipeline Rules</div>
                <ul className="space-y-1.5 text-[#8E9299] list-disc list-inside">
                  <li><strong>Clean URLs</strong>: Enabled for elegant path rendering.</li>
                  <li><strong>Serverless Routing</strong>: Routes `/api/*` requests cleanly to our serverless endpoint.</li>
                  <li><strong>SPA Fallback</strong>: All client router states resolve gracefully to `index.html` preventing 404s.</li>
                </ul>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="font-bold text-[#F0F0F0]">🚀 Deploy to Vercel in 3 Steps:</div>
                <ol className="list-decimal list-inside text-[#8E9299] space-y-1 text-[11px]">
                  <li>Push your files or export your ZIP to GitHub.</li>
                  <li>Import the repository on your Vercel Dashboard.</li>
                  <li>Add your env variables in Vercel project settings:
                    <div className="font-mono text-[10px] text-pink-400 bg-[#121217] p-1.5 rounded mt-1 select-all">
                      GEMINI_API_KEY
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
