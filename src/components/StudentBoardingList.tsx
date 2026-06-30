import React, { useState, useEffect } from 'react';
import { Student, BoardingStatus, BuildingKey, AttendanceLog } from '../types';
import { BUILDINGS_INFO } from '../data/students';
import { Search, Phone, MessageSquare, Check, X, User, MapPin, Building, GraduationCap, ShieldCheck, FileSpreadsheet, History, Calendar, Trash2 } from 'lucide-react';

interface StudentBoardingListProps {
  students: Student[];
  onUpdateStatus: (studentId: string, status: BoardingStatus) => void;
  activeRouteIds: string[];
}

export default function StudentBoardingList({
  students,
  onUpdateStatus,
  activeRouteIds
}: StudentBoardingListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBuilding, setFilterBuilding] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Historical Logging States
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>(() => {
    const saved = localStorage.getItem('roxy_bus_attendance_logs');
    return saved ? JSON.parse(saved) : [];
  });
  const [showHistoryTab, setShowHistoryTab] = useState(false);
  const [selectedLogForReview, setSelectedLogForReview] = useState<AttendanceLog | null>(null);
  const [logSuccessMsg, setLogSuccessMsg] = useState<string | null>(null);

  // Sync historical logs to localStorage
  useEffect(() => {
    localStorage.setItem('roxy_bus_attendance_logs', JSON.stringify(attendanceLogs));
  }, [attendanceLogs]);

  // Search and filter logic for active desk list
  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          student.street.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          student.servantName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBuilding = filterBuilding === 'all' || student.buildingKey === filterBuilding;
    const matchesStatus = filterStatus === 'all' || student.boardingStatus === filterStatus;

    return matchesSearch && matchesBuilding && matchesStatus;
  });

  // Attendance progress ring computation
  const boardedPct = Math.round((students.filter(s => s.boardingStatus === 'boarded' || s.boardingStatus === 'arrived').length / Math.max(1, students.length - students.filter(s => s.boardingStatus === 'absent').length)) * 100);
  const ringColor = boardedPct >= 80 ? '#10B981' : boardedPct >= 50 ? '#F59E0B' : '#EF4444';
  const ringCircumference = 125.66;
  const ringOffset = ringCircumference - (boardedPct / 100) * ringCircumference;

  // Stats counters for summary badges
  const waiting = students.filter(s => s.boardingStatus === 'waiting').length;
  const boarded = students.filter(s => s.boardingStatus === 'boarded').length;
  const arrived = students.filter(s => s.boardingStatus === 'arrived').length;
  const absent  = students.filter(s => s.boardingStatus === 'absent').length;

  // Handle saving the current boarding state to historical log
  const handleArchiveAttendance = () => {
    const boardedCount = students.filter(s => s.boardingStatus === 'boarded' || s.boardingStatus === 'arrived').length;
    const absentCount = students.filter(s => s.boardingStatus === 'absent').length;
    const dateStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const newLog: AttendanceLog = {
      id: `log_${Date.now()}`,
      date: dateStr,
      routeName: `Heliopolis Route (Roxy to Church)`,
      boardedCount,
      absentCount,
      totalCount: students.length,
      records: students.map(s => ({
        studentId: s.id,
        name: s.name,
        status: s.boardingStatus,
        time: s.boardingTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }))
    };

    setAttendanceLogs(prev => [newLog, ...prev]);
    setLogSuccessMsg(`Attendance logged successfully for ${dateStr}!`);
    setTimeout(() => setLogSuccessMsg(null), 4000);
  };

  const handleDeleteLog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAttendanceLogs(prev => prev.filter(l => l.id !== id));
    if (selectedLogForReview?.id === id) {
      setSelectedLogForReview(null);
    }
  };

  // Helper for WhatsApp click with pre-filled message
  const triggerWhatsApp = (phone: string, studentName: string, status: BoardingStatus, street: string) => {
    const formattedPhone = phone.replace('+', '');
    let text = '';
    if (status === 'waiting') {
      text = encodeURIComponent(`مرحباً، باص مدرسة الأحد قادم في الطريق إلى شارع ${street}. يرجى تجهيز الطفل ${studentName} لركوب الباص الآن.`);
    } else if (status === 'boarded') {
      text = encodeURIComponent(`مرحباً، تم ركوب الطفل ${studentName} الباص بنجاح وهو الآن في طريقه إلى الكنيسة بأمان.`);
    } else {
      text = encodeURIComponent(`مرحباً، بخصوص حضور الطفل ${studentName} في رحلة الباص اليوم.`);
    }
    window.open(`https://wa.me/${formattedPhone}?text=${text}`, '_blank');
  };

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10" id="boarding-list-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          {/* Attendance Progress Ring */}
          <div className="relative flex-shrink-0" title={`${boardedPct}% boarded`}>
            <svg width="52" height="52" viewBox="0 0 52 52">
              {/* Track */}
              <circle cx="26" cy="26" r="20" fill="none" stroke="#2A2A30" strokeWidth="5" />
              {/* Progress arc */}
              <circle
                cx="26" cy="26" r="20"
                fill="none"
                stroke={ringColor}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease', transformOrigin: '26px 26px', transform: 'rotate(-90deg)' }}
              />
            </svg>
            <span
              className="absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono"
              style={{ color: ringColor }}
            >
              {boardedPct}%
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide font-display">
              <User className="w-5 h-5 text-[#3B82F6]" />
              Teacher Attendance Boarding Desk
            </h2>
            <p className="text-xs text-[#8E9299]">
              Monitor real-time student presence, trigger boarding check-ins & archive trip logs
            </p>
          </div>
        </div>

        {/* View Archive vs Active Desk Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowHistoryTab(!showHistoryTab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-all ${
              showHistoryTab
                ? 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30'
                : 'bg-[#1A1A1E] text-[#8E9299] border-[#2A2A30] hover:text-[#F0F0F0]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            {showHistoryTab ? "Show Live Boarding" : `View Logs (${attendanceLogs.length})`}
          </button>

          {!showHistoryTab && (
            <button
              onClick={handleArchiveAttendance}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#10B981] hover:bg-emerald-600 text-white flex items-center gap-1.5 transition-all shadow-md"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Save Attendance Log
            </button>
          )}
        </div>
      </div>

      {logSuccessMsg && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 border-l-4 border-l-emerald-500 rounded-xl text-emerald-400 text-xs font-bold animate-bounce-in flex items-center gap-2">
          <Check className="w-4 h-4" />
          {logSuccessMsg}
        </div>
      )}

      {/* HISTORICAL ARCHIVE VIEW */}
      {showHistoryTab ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Logs List */}
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#8E9299] flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Logged Trips
              </h3>
              {attendanceLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#8E9299] bg-[#0A0A0C] border border-[#2A2A30] rounded-xl">
                  No previous attendance records submitted. Use "Save Attendance Log" to create.
                </div>
              ) : (
                attendanceLogs.map((log) => (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLogForReview(log)}
                    className={`p-3 bg-[#0A0A0C] border rounded-xl hover:border-[#3B82F6] transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      selectedLogForReview?.id === log.id ? 'border-[#3B82F6] bg-[#3B82F6]/5' : 'border-[#2A2A30]'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-xs text-[#F0F0F0]">{log.date}</div>
                      <div className="text-[10px] text-[#8E9299] mt-0.5">{log.routeName}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-[10px] font-mono">
                        <span className="text-emerald-400 font-bold">{log.boardedCount} present</span>
                        <span className="mx-1 text-[#2A2A30]">•</span>
                        <span className="text-rose-400">{log.absentCount} absent</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteLog(log.id, e)}
                        className="p-1.5 hover:bg-rose-500/10 text-[#8E9299] hover:text-rose-400 rounded-lg transition-colors"
                        title="Delete Log"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Detailed Log Review */}
            <div className="bg-[#0A0A0C] border border-[#2A2A30] rounded-xl p-4 min-h-[150px] flex flex-col justify-between">
              {selectedLogForReview ? (
                <div className="space-y-3 flex-1 flex flex-col">
                  <div className="border-b border-[#2A2A30] pb-2">
                    <h4 className="font-bold text-xs text-[#F0F0F0]">{selectedLogForReview.date} Details</h4>
                    <p className="text-[10px] text-[#8E9299]">{selectedLogForReview.routeName}</p>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto max-h-[220px] space-y-1.5 pr-1">
                    {selectedLogForReview.records.map((rec, rIdx) => (
                      <div key={`${rec.studentId}-${rIdx}`} className="p-2 bg-[#121217] rounded-lg border border-[#2A2A30] flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#F0F0F0]">{rec.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                          rec.status === 'boarded' || rec.status === 'arrived'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : rec.status === 'absent'
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {rec.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-[#2A2A30] text-[10px] text-[#8E9299] flex justify-between font-mono">
                    <span>Attendance Rate:</span>
                    <span className="font-bold text-emerald-400">
                      {((selectedLogForReview.boardedCount / selectedLogForReview.totalCount) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-xs text-[#8E9299]">
                  <History className="w-8 h-8 mb-2 text-[#2A2A30]" />
                  Select an attendance log on the left to review detailed pupil boarding records.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* LIVE BOARDING TABLE VIEW */
        <>
          {/* Quick status tags */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#1A1A1E] text-[#8E9299] border border-[#2A2A30] font-mono">
              Filtered Pupils: {filteredStudents.length}
            </span>
          </div>

          {/* Filters bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-[#8E9299]" />
              <input
                type="text"
                placeholder="Search name, street, landmarks..."
                className="w-full pl-10 pr-4 py-2.5 text-xs border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#3B82F6] focus:border-[#3B82F6] bg-[#0A0A0C] text-[#F0F0F0] placeholder-[#8E9299]/50"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div>
              <select
                className="w-full px-3 py-2.5 text-xs border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#3B82F6] focus:border-[#3B82F6] bg-[#0A0A0C] text-[#F0F0F0]"
                value={filterBuilding}
                onChange={(e) => setFilterBuilding(e.target.value)}
              >
                <option value="all">🏢 Classroom Building (All)</option>
                {Object.entries(BUILDINGS_INFO).map(([key, info]) => (
                  <option key={key} value={key} className="bg-[#0A0A0C] text-[#F0F0F0]">
                    {info.name} ({info.desc})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                className="w-full px-3 py-2.5 text-xs border border-[#2A2A30] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#3B82F6] focus:border-[#3B82F6] bg-[#0A0A0C] text-[#F0F0F0]"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">📍 Boarding Status (All)</option>
                <option value="waiting">⏳ Waiting Pick Up</option>
                <option value="boarded">🚌 Boarded on Bus</option>
                <option value="arrived">✅ Arrived & Drop Off</option>
                <option value="absent">❌ Absent Today</option>
              </select>
            </div>
          </div>

          {/* Mini stats summary row */}
          <div className="flex gap-3 mb-3 flex-wrap">
            <span className="animate-bounce-in px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 [animation-delay:0.05s] opacity-0 [animation-fill-mode:forwards]">
              ⏳ {waiting} Waiting
            </span>
            <span className="animate-bounce-in px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 [animation-delay:0.1s] opacity-0 [animation-fill-mode:forwards]">
              🚌 {boarded} Boarded
            </span>
            <span className="animate-bounce-in px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 [animation-delay:0.15s] opacity-0 [animation-fill-mode:forwards]">
              ✅ {arrived} Arrived
            </span>
            <span className="animate-bounce-in px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 [animation-delay:0.2s] opacity-0 [animation-fill-mode:forwards]">
              ❌ {absent} Absent
            </span>
          </div>

          {/* Students list table / stack cards */}
          <div className="overflow-x-auto border border-[#2A2A30] rounded-xl bg-[#0A0A0C]">
            <table className="min-w-full divide-y divide-[#2A2A30] text-left">
              <thead className="bg-[#1A1A1E]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider text-center">Seq</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">Student Name</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">Stop Location & Building</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">Class Target</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider">Family Contacts</th>
                  <th scope="col" className="px-4 py-3 text-[10px] font-bold text-[#8E9299] uppercase tracking-wider text-center">Boarding Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2A30] bg-[#0A0A0C]">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-[#8E9299] font-sans">
                      No registered pupils found matching the active filters.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student, index) => {
                    const activeIndex = activeRouteIds.indexOf(student.id);
                    const showSeq = activeIndex !== -1 ? activeIndex + 1 : student.order;

                    return (
                      <tr
                        key={student.id}
                        className="hover:bg-[#121217] transition-colors text-[#F0F0F0] font-sans text-xs animate-slide-up opacity-0 [animation-fill-mode:forwards]"
                        style={{ animationDelay: `${index * 0.04}s` }}
                      >
                        {/* Seq */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg font-mono text-xs font-bold ${
                            activeIndex !== -1 ? 'bg-[#3B82F6] text-white shadow-sm' : 'bg-[#1A1A1E] text-[#8E9299] border border-[#2A2A30]'
                          }`}>
                            {showSeq}
                          </span>
                        </td>

                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#F0F0F0] flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${student.gender === 'girl' ? 'bg-pink-400' : 'bg-[#3B82F6]'}`}></span>
                            {student.name}
                          </div>
                          <div className="text-[10px] text-[#8E9299] flex items-center gap-1 mt-0.5">
                            <GraduationCap className="w-3.5 h-3.5" />
                            {student.grade} • Birth: {student.dob}
                          </div>
                        </td>

                        {/* Location & Landmark */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-[#F0F0F0] text-xs">
                            <MapPin className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
                            <span>{student.buildingNo}, {student.street} St</span>
                          </div>
                          <div className="text-[10px] text-[#8E9299] mt-1 max-w-[200px] truncate" title={student.landmark}>
                            📍 {student.landmark}
                          </div>
                        </td>

                        {/* Target Class Building */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                            style={{
                              backgroundColor: `${BUILDINGS_INFO[student.buildingKey].color}15`,
                              color: BUILDINGS_INFO[student.buildingKey].color,
                              border: `1px solid ${BUILDINGS_INFO[student.buildingKey].color}30`
                            }}
                          >
                            <Building className="w-3 h-3" />
                            {BUILDINGS_INFO[student.buildingKey].name}
                          </span>
                          <div className="text-[10px] text-[#8E9299] mt-0.5 truncate max-w-[150px]">
                            Servant: {student.servantName}
                          </div>
                        </td>

                        {/* Family Contacts */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <a
                              href={`tel:${student.parentPhonePrimary}`}
                              className="px-2 py-1 rounded bg-[#3B82F6]/5 hover:bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/10 transition-colors flex items-center gap-1 text-[10px]"
                              title="Call Primary Parent"
                            >
                              <Phone className="w-3 h-3" />
                              Primary
                            </a>
                            <button
                              onClick={() => triggerWhatsApp(student.parentPhonePrimary, student.name, student.boardingStatus, student.street)}
                              className="px-2 py-1 rounded bg-[#10B981]/5 hover:bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/10 transition-colors flex items-center gap-1 text-[10px]"
                              title="WhatsApp Pre-fill Alert"
                            >
                              <MessageSquare className="w-3 h-3" />
                              Ping
                            </button>
                          </div>
                          {student.parentPhoneSecondary && (
                            <div className="text-[10px] text-[#8E9299] mt-1">
                              Sec: {student.parentPhoneSecondary}
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {student.boardingStatus === 'waiting' && (
                              <>
                                <button
                                  onClick={() => onUpdateStatus(student.id, 'boarded')}
                                  className="px-2.5 py-1 text-xs font-semibold bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 border border-[#3B82F6]/20 rounded-lg transition-all hover:scale-105 active:scale-95 transition-transform flex items-center gap-1"
                                >
                                  <Check className="w-3.5 h-3.5" /> Check-In
                                </button>
                                <button
                                  onClick={() => onUpdateStatus(student.id, 'absent')}
                                  className="px-2.5 py-1 text-xs font-semibold bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20 border border-[#EF4444]/20 rounded-lg transition-all"
                                >
                                  Absent
                                </button>
                              </>
                            )}

                            {student.boardingStatus === 'boarded' && (
                              <span key={`boarded-${student.id}`} className="animate-bounce-in opacity-0 [animation-fill-mode:forwards] flex items-center gap-1.5">
                                <button
                                  onClick={() => onUpdateStatus(student.id, 'arrived')}
                                  className="px-2.5 py-1 text-xs font-semibold bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 border border-[#10B981]/20 rounded-lg transition-all flex items-center gap-1"
                                >
                                  <Check className="w-3.5 h-3.5" /> Drop Class
                                </button>
                                <button
                                  onClick={() => onUpdateStatus(student.id, 'waiting')}
                                  className="p-1 text-[#8E9299] hover:text-[#F0F0F0] rounded-lg hover:bg-[#1A1A1E] transition-colors"
                                  title="Reset Boarding Status"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            )}

                            {student.boardingStatus === 'arrived' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 rounded-lg glow-green animate-fade-in">
                                <ShieldCheck className="w-3.5 h-3.5" /> Handed Over
                              </span>
                            )}

                            {student.boardingStatus === 'absent' && (
                              <span className="animate-shake inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold bg-[#4A4A52]/20 text-[#8E9299] border border-[#2A2A30] rounded-lg">
                                ❌ Absent
                                <button
                                  onClick={() => onUpdateStatus(student.id, 'waiting')}
                                  className="text-[#8E9299] hover:text-[#F0F0F0] font-bold text-xs"
                                  title="Reset"
                                >
                                  ×
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
