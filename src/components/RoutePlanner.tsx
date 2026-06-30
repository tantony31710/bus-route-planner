import React, { useState } from 'react';
import { Student, RouteStop } from '../types';
import { START_HUBS, END_HUBS } from '../data/students';
import { Navigation, Compass, Clock, Play, Square, RotateCcw, Zap, MoveUp, MoveDown, MapPin, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface RoutePlannerProps {
  students: Student[];
  routeType: 'morning' | 'afternoon';
  onChangeRouteType: (type: 'morning' | 'afternoon') => void;
  startHubId: string;
  endHubId: string;
  routeStops: RouteStop[];
  currentStopIndex: number;
  isSimulating: boolean;
  isOptimized: boolean;
  onUpdateStartHub: (id: string) => void;
  onUpdateEndHub: (id: string) => void;
  onToggleOptimize: (optimize: boolean) => void;
  onManualReorder: (fromIndex: number, direction: 'up' | 'down') => void;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  onResetSimulation: () => void;
  totalDistance: number;
  totalDuration: number;
}

export default function RoutePlanner({
  students,
  routeType,
  onChangeRouteType,
  startHubId,
  endHubId,
  routeStops,
  currentStopIndex,
  isSimulating,
  isOptimized,
  onUpdateStartHub,
  onUpdateEndHub,
  onToggleOptimize,
  onManualReorder,
  onStartSimulation,
  onStopSimulation,
  onResetSimulation,
  totalDistance,
  totalDuration
}: RoutePlannerProps) {

  const selectedStart = START_HUBS.find(h => h.id === startHubId) || START_HUBS[0];
  const selectedEnd = END_HUBS.find(h => h.id === endHubId) || END_HUBS[0];
  const [rippleActive, setRippleActive] = useState(false);

  const handleStartSimulation = () => {
    setRippleActive(true);
    setTimeout(() => setRippleActive(false), 600);
    onStartSimulation();
  };

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10 animate-slide-up stagger-2" id="route-planner-panel">
      <div className="mb-5">
        <h2 className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide font-display">
          <Navigation className="w-5 h-5 text-[#3B82F6]" />
          Smart Route Engine & Simulator
        </h2>
        <p className="text-xs text-[#8E9299]">
          Decide optimal start/end terminals, compute sequential coordinates & simulate the trip
        </p>
      </div>

      {/* Route Type Segment Selector */}
      <div className="grid grid-cols-2 p-1 bg-[#0A0A0C] border border-[#2A2A30] rounded-2xl mb-5 gap-1.5">
        <button
          onClick={() => onChangeRouteType('morning')}
          className={`py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
            routeType === 'morning'
              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-500 shadow-md shadow-amber-500/5'
              : 'border border-transparent text-[#8E9299] hover:text-white hover:bg-[#121217]'
          }`}
        >
          <span>☀️</span>
          Morning Pickups
        </button>
        <button
          onClick={() => onChangeRouteType('afternoon')}
          className={`py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
            routeType === 'afternoon'
              ? 'bg-[#3B82F6]/10 border border-[#3B82F6]/30 text-[#3B82F6] shadow-md shadow-[#3B82F6]/5'
              : 'border border-transparent text-[#8E9299] hover:text-white hover:bg-[#121217]'
          }`}
        >
          <span>🌙</span>
          Afternoon Drop-offs
        </button>
      </div>

      {/* Starting & Ending Terminals Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#8E9299] block uppercase tracking-wider">
            🛫 Starting Terminal Point
          </label>
          <select
            className="w-full px-3 py-2.5 text-xs border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#3B82F6] bg-[#0A0A0C] text-[#F0F0F0]"
            value={startHubId}
            onChange={(e) => onUpdateStartHub(e.target.value)}
          >
            {START_HUBS.map(hub => (
              <option key={hub.id} value={hub.id}>
                {hub.name}
              </option>
            ))}
          </select>
          {startHubId === 'saint_mark_church' && (
            <div className="text-[10px] text-[#34d399] font-mono flex items-center gap-1 mt-1 bg-[#10B981]/5 p-1.5 rounded-lg border border-[#10B981]/15">
              <MapPin className="w-3 h-3 text-[#34d399]" />
              <span>Verified Link: <a href="https://maps.app.goo.gl/hTUUoMkmw1D28ZaJ9" target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-all font-bold">St. Mark Church Cleopatra</a></span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-[#8E9299] block uppercase tracking-wider">
            🏁 Destination Drop Hub
          </label>
          <select
            className="w-full px-3 py-2.5 text-xs border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#3B82F6] bg-[#0A0A0C] text-[#F0F0F0]"
            value={endHubId}
            onChange={(e) => onUpdateEndHub(e.target.value)}
          >
            {END_HUBS.map(hub => (
              <option key={hub.id} value={hub.id}>
                {hub.name}
              </option>
            ))}
          </select>
          {endHubId === 'saint_mark_church' && (
            <div className="text-[10px] text-[#34d399] font-mono flex items-center gap-1 mt-1 bg-[#10B981]/5 p-1.5 rounded-lg border border-[#10B981]/15">
              <MapPin className="w-3 h-3 text-[#34d399]" />
              <span>Verified Link: <a href="https://maps.app.goo.gl/hTUUoMkmw1D28ZaJ9" target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-all font-bold">St. Mark Church Cleopatra</a></span>
            </div>
          )}
        </div>
      </div>

      {/* Optimisation Toggle Panel */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-4 bg-[#1A1A1E] rounded-2xl border border-[#2A2A30] gap-3 mb-5">
        <div>
          <span className="text-xs font-bold text-[#3B82F6] uppercase tracking-widest flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 fill-[#3B82F6]/20 text-[#3B82F6]" />
            Routing Algorithm Model
          </span>
          <p className="text-[11px] text-[#8E9299] mt-1 leading-relaxed">
            {isOptimized
              ? "TSP (Greedy Nearest Neighbor) auto-calculates shortest path sequences."
              : "Manual Mode: Arrange stops in custom sequences using the ordering keys."}
          </p>
        </div>
        <div className="flex items-center bg-[#0A0A0C] p-1 rounded-xl border border-[#2A2A30] shrink-0">
          <button
            onClick={() => onToggleOptimize(true)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
              isOptimized ? 'bg-[#3B82F6] text-white shadow-sm' : 'text-[#8E9299] hover:text-[#F0F0F0]'
            }`}
          >
            Auto Optimized
          </button>
          <button
            onClick={() => onToggleOptimize(false)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
              !isOptimized ? 'bg-[#3B82F6] text-white shadow-sm' : 'text-[#8E9299] hover:text-[#F0F0F0]'
            }`}
          >
            Manual
          </button>
        </div>
      </div>

      {/* Trip Statistics */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {/* Distance Card */}
        <div className="transform-gpu hover:scale-105 hover:-translate-y-1 transition-all duration-300 flex flex-col items-center text-center p-4 bg-gradient-to-br from-[#1E2230] to-[#141420] rounded-2xl border border-[#2A2A30] border-b-2 border-b-[#3B82F6] shadow-lg shadow-blue-500/10">
          <Compass className="w-4 h-4 text-[#3B82F6] mb-1.5" />
          <div className="text-[9px] uppercase font-bold text-[#8E9299] tracking-wider">Total Distance</div>
          <div className="text-base font-black text-[#F0F0F0] font-mono mt-0.5 tabular-nums">{totalDistance.toFixed(2)} <span className="text-[10px] font-medium text-[#8E9299]">km</span></div>
        </div>
        {/* Duration Card */}
        <div className="transform-gpu hover:scale-105 hover:-translate-y-1 transition-all duration-300 flex flex-col items-center text-center p-4 bg-gradient-to-br from-[#221E14] to-[#141410] rounded-2xl border border-[#2A2A30] border-b-2 border-b-amber-500 shadow-lg shadow-amber-500/10">
          <Clock className="w-4 h-4 text-amber-500 mb-1.5" />
          <div className="text-[9px] uppercase font-bold text-[#8E9299] tracking-wider">Est. Trip Duration</div>
          <div className="text-base font-black text-[#F0F0F0] font-mono mt-0.5 tabular-nums">{totalDuration.toFixed(0)} <span className="text-[10px] font-medium text-[#8E9299]">min</span></div>
        </div>
        {/* Stops Card */}
        <div className="transform-gpu hover:scale-105 hover:-translate-y-1 transition-all duration-300 flex flex-col items-center text-center p-4 bg-gradient-to-br from-[#142018] to-[#101410] rounded-2xl border border-[#2A2A30] border-b-2 border-b-emerald-500 shadow-lg shadow-emerald-500/10">
          <MapPin className="w-4 h-4 text-emerald-500 mb-1.5" />
          <div className="text-[9px] uppercase font-bold text-[#8E9299] tracking-wider">Active Stops</div>
          <div className="text-base font-black text-[#F0F0F0] font-mono mt-0.5 tabular-nums">{routeStops.length} <span className="text-[10px] font-medium text-[#8E9299]">nodes</span></div>
        </div>
      </div>

      {/* Simulation Controllers */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {!isSimulating ? (
          <div className="flex-1 min-w-[140px] relative">
            <button
              onClick={handleStartSimulation}
              className="w-full py-2.5 px-4 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 overflow-hidden relative"
            >
              <Play className="w-4 h-4 fill-white" />
              Start Run Simulation
              {rippleActive && (
                <span className="absolute inset-0 bg-white/10 rounded-xl animate-ripple" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex-1 min-w-[140px] relative">
            <span className="absolute inset-0 rounded-xl ring-2 ring-rose-500/60 animate-ping pointer-events-none" />
            <button
              onClick={onStopSimulation}
              className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 animate-pulse overflow-hidden relative"
            >
              <Square className="w-4 h-4 fill-white" />
              Pause Simulation
            </button>
          </div>
        )}
        <button
          onClick={onResetSimulation}
          className="px-4 py-2.5 bg-[#1A1A1E] hover:bg-[#222227] text-[#8E9299] hover:text-[#F0F0F0] text-xs font-bold rounded-xl transition-all border border-[#2A2A30] flex items-center gap-1.5"
          title="Reset Sequence"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Run
        </button>
      </div>

      {/* Stop Sequencing Details Timeline */}
      <div className="space-y-3">
        <h3 className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest block">
          Stop Sequences timeline
        </h3>

        <div className="border border-[#2A2A30] rounded-xl bg-[#0A0A0C] p-4 max-h-[300px] overflow-y-auto space-y-3">
          {routeStops.map((stop, index) => {
            const isCurrent = index === currentStopIndex;
            const isPassed = index < currentStopIndex;
            const isNext = index === currentStopIndex + 1;

            return (
              <motion.div
                key={stop.id}
                layout
                transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                className="space-y-1"
              >
                <div
                  className={`relative flex items-center justify-between p-3 rounded-xl border transition-all ${
                    isCurrent
                      ? 'bg-[#3B82F6]/10 border-[#3B82F6]/40 ring-1 ring-[#3B82F6]/20 border-l-4 border-l-[#3B82F6] animate-glow-pulse shadow-lg shadow-blue-500/20'
                      : isPassed
                      ? 'bg-[#121217]/50 border-[#1A1A22] opacity-50'
                      : isNext
                      ? 'bg-amber-500/5 border-[#2A2A30] border-l-4 border-l-amber-500/60'
                      : 'bg-[#1A1A1E] border-[#2A2A30]'
                  }`}
                >
                  {isPassed && (
                    <CheckCircle2 className="absolute top-2 right-2 w-3.5 h-3.5 text-emerald-500/60 pointer-events-none" />
                  )}
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono ${
                      isCurrent ? 'bg-[#3B82F6] text-white shadow-md' : 'bg-[#1A1A1E] border border-[#2A2A30] text-[#8E9299]'
                    }`}>
                      {index + 1}
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-[#F0F0F0] flex items-center gap-1.5">
                        {stop.name}
                        {isCurrent && <span className="text-[9px] text-[#3B82F6] bg-[#3B82F6]/10 border border-[#3B82F6]/20 px-1.5 py-0.5 rounded-md font-mono uppercase font-bold animate-pulse">Bus Here</span>}
                      </h4>
                      <p className="text-[10px] text-[#8E9299] mt-0.5 font-mono">
                        ETA: {stop.eta} • +{stop.durationFromPrev.toFixed(1)} mins • {stop.distanceFromPrev.toFixed(2)} km
                      </p>
                    </div>
                  </div>

                  {/* Manual sequence buttons (only visible if optimize is off and not first/last stop) */}
                  {!isOptimized && index > 0 && index < routeStops.length - 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onManualReorder(index, 'up')}
                        disabled={index === 1}
                        className="p-1 rounded bg-[#121217] hover:bg-[#1A1A1E] disabled:opacity-30 border border-[#2A2A30] text-[#8E9299] hover:text-[#F0F0F0] cursor-pointer"
                        title="Move Up"
                      >
                        <MoveUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onManualReorder(index, 'down')}
                        disabled={index === routeStops.length - 2}
                        className="p-1 rounded bg-[#121217] hover:bg-[#1A1A1E] disabled:opacity-30 border border-[#2A2A30] text-[#8E9299] hover:text-[#F0F0F0] cursor-pointer"
                        title="Move Down"
                      >
                        <MoveDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {index < routeStops.length - 1 && (
                  <div className="flex justify-center my-1">
                    <div className={`w-0.5 h-4 rounded-full ${
                      isPassed
                        ? 'bg-emerald-500/50'
                        : isCurrent
                        ? 'bg-[#3B82F6] animate-pulse'
                        : 'bg-[#2A2A30]'
                    }`} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
