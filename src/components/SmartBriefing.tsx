import React, { useState, useEffect } from 'react';
import { Student, DelayAlert, RouteStop } from '../types';
import { Sparkles, RefreshCw, Cpu, CheckCircle2, AlertCircle, Download } from 'lucide-react';

interface SmartBriefingProps {
  students: Student[];
  routeStops: RouteStop[];
  alerts: DelayAlert[];
  startHubName: string;
  endHubName: string;
  totalDistance: number;
  totalDuration: number;
  customSystemPrompt?: string;
  temperature?: number;
}

export default function SmartBriefing({
  students,
  routeStops,
  alerts,
  startHubName,
  endHubName,
  totalDistance,
  totalDuration,
  customSystemPrompt,
  temperature
}: SmartBriefingProps) {
  const [brief, setBrief] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealAI, setIsRealAI] = useState(false);
  const [hasKeyButFailed, setHasKeyButFailed] = useState(false);

  // Group classrooms
  const buildingBreakdown = students.reduce((acc: { [key: string]: number }, stud) => {
    acc[stud.buildingKey] = (acc[stud.buildingKey] || 0) + 1;
    return acc;
  }, {});

  const fetchBriefing = async () => {
    setIsLoading(true);
    setError(null);
    setHasKeyButFailed(false);
    try {
      const activeAlerts = alerts.filter(a => !a.isRead).map(a => ({
        streetName: a.streetName,
        severity: a.severity,
        message: a.message
      }));

      const boardedCount = students.filter(s => s.boardingStatus === 'boarded').length;
      const waitingCount = students.filter(s => s.boardingStatus === 'waiting').length;
      const absentCount = students.filter(s => s.boardingStatus === 'absent').length;

      const response = await fetch('/api/dispatch-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startHubName,
          endHubName,
          totalDistance,
          totalDuration,
          boardedCount,
          waitingCount,
          absentCount,
          activeAlerts,
          buildingBreakdown,
          customSystemPrompt,
          temperature
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to communicate with AI Dispatch server.');
      }

      const data = await response.json();
      setBrief(data.brief);
      setIsRealAI(data.isRealAI || false);
      setHasKeyButFailed(data.hasKeyButFailed || false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error loading Smart Dispatch brief.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBriefing();
  }, [startHubName, endHubName, alerts.length]);

  const handleDownloadCSV = () => {
    const headers = ["Stop No.", "Stop Name", "Type", "Latitude", "Longitude", "ETA", "Dist From Prev (km)", "Duration From Prev (min)"];
    const rows = routeStops.map((stop, index) => [
      index + 1,
      `"${stop.name.replace(/"/g, '""')}"`,
      stop.type.toUpperCase(),
      stop.lat,
      stop.lng,
      stop.eta,
      stop.distanceFromPrev.toFixed(2),
      stop.durationFromPrev.toFixed(1)
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `roxy_smart_bus_schedule_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-gradient-to-br from-[#121217] to-[#1A1A1E] text-white rounded-2xl p-5 shadow-xl border border-[#2A2A30] relative overflow-hidden" id="smart-brief-container">
      {/* Decorative ambient blobs */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#3B82F6]/5 rounded-full blur-2xl"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-[#10B981]/5 rounded-full blur-xl"></div>

      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-[#3B82F6]/10 rounded-xl border border-[#3B82F6]/20">
            <Sparkles className="w-5 h-5 text-[#3B82F6] animate-pulse" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#3B82F6] flex items-center gap-1.5 font-display">
              Smart Dispatch Co-pilot
              <span className="text-[9px] bg-[#3B82F6]/10 px-2 py-0.5 rounded-full border border-[#3B82F6]/20 text-[#3B82F6] font-mono lowercase">Gemini powered</span>
            </h2>
            <p className="text-[11px] text-[#8E9299]">
              Live AI-driven traffic synthesis & classroom drop scheduling
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadCSV}
            className="p-1.5 rounded-lg hover:bg-[#1A1A1E] text-[#8E9299] hover:text-[#3B82F6] border border-transparent hover:border-[#2A2A30] transition-all"
            title="Download CSV Route Schedule"
          >
            <Download className="w-4 h-4" />
          </button>
          
          <button
            onClick={fetchBriefing}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-[#1A1A1E] text-[#8E9299] hover:text-[#F0F0F0] border border-transparent hover:border-[#2A2A30] transition-all disabled:opacity-40"
            title="Regenerate Advice"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="relative bg-[#0A0A0C]/50 border border-[#2A2A30] rounded-xl p-4 min-h-[90px] flex items-center">
        {isLoading ? (
          <div className="w-full flex items-center justify-center gap-2.5 py-4 text-xs font-semibold text-[#8E9299]">
            <Cpu className="w-4 h-4 animate-spin text-[#3B82F6]" />
            Synthesizing traffic vectors & drop sequences...
          </div>
        ) : error ? (
          <div className="text-rose-400 text-xs font-medium flex items-start gap-2 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="space-y-2 w-full">
            <p className="text-xs sm:text-sm font-sans leading-relaxed text-[#F0F0F0]">
              {brief}
            </p>
            {isRealAI ? (
              <div className="flex items-center gap-1.5 text-[10px] text-[#10B981] font-mono">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Active live Gemini model 2.0 dispatch intelligence</span>
              </div>
            ) : hasKeyButFailed ? (
              <div className="text-[10px] text-rose-300 leading-snug font-sans bg-rose-500/5 border border-rose-500/15 rounded-lg p-3 mt-2 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-rose-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Gemini API is Currently Busy (503 High Demand)
                </div>
                <p className="text-[11px] text-[#8E9299]">
                  Your <code>GEMINI_API_KEY</code> is correctly configured! However, Google's free-tier Gemini models are currently experiencing heavy regional traffic.
                </p>
                <p className="text-[11px] text-[#8E9299]">
                  We have automatically initialized our custom high-fidelity Roxy dispatcher fallback so you don't experience any downtime. Please click <strong className="text-[#3B82F6] hover:underline cursor-pointer" onClick={() => fetchBriefing()}>Regenerate</strong> in a few moments.
                </p>
              </div>
            ) : (
              <div className="text-[10px] text-amber-400/90 leading-snug font-sans bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 mt-2">
                ⚠️ Co-pilot is in <strong>local routing mode</strong>. To enable raw live Gemini API reasoning, add your <strong>GEMINI_API_KEY</strong> inside the <strong>Settings &gt; Secrets</strong> pane.
              </div>
            )}
            
            {/* Prominent Download Button */}
            <div className="pt-3 border-t border-[#2A2A30]/50 mt-1">
              <button
                onClick={handleDownloadCSV}
                className="w-full py-2.5 px-4 bg-[#3B82F6]/10 hover:bg-[#3B82F6]/25 border border-[#3B82F6]/20 hover:border-[#3B82F6]/40 rounded-xl text-xs font-bold text-[#4da1ff] hover:text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
                id="btn-download-csv-brief"
              >
                <Download className="w-4 h-4" />
                Download Route Schedule (CSV)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
