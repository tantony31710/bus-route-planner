import React, { useState } from 'react';
import { DelayAlert, TrafficSegment } from '../types';
import { AlertTriangle, Bell, Check, Plus, AlertCircle, X, ShieldAlert } from 'lucide-react';

interface DelayAlertPanelProps {
  alerts: DelayAlert[];
  trafficSegments: TrafficSegment[];
  onTriggerIncident: (streetName: string, severity: 'moderate' | 'severe', delayMins: number, description: string) => void;
  onClearAlert: (id: string) => void;
}

export default function DelayAlertPanel({
  alerts,
  trafficSegments,
  onTriggerIncident,
  onClearAlert
}: DelayAlertPanelProps) {
  const [selectedStreet, setSelectedStreet] = useState('khalifa');
  const [severity, setSeverity] = useState<'moderate' | 'severe'>('moderate');
  const [customDelay, setCustomDelay] = useState(10);
  const [customDesc, setCustomDesc] = useState('');

  const streetOptions = [
    { id: 'khalifa', name: 'Khalifa El Mamoun St (شارع الخليفة المأمون)', delayRange: [10, 20] },
    { id: 'selahdar', name: 'El Selahdar St (شارع السلحدار)', delayRange: [5, 12] },
    { id: 'ashgar', name: 'Al Ashgar St (شارع الأشجار)', delayRange: [4, 10] },
    { id: 'abu_nour', name: 'Sheikh Abu El Nour St (شارع الشيخ أبو النور)', delayRange: [5, 10] },
    { id: 'mokrizi', name: 'El Mokrizi St (شارع المقريزي)', delayRange: [8, 18] },
    { id: 'noweiry', name: 'El Noweiry St (شارع النويري)', delayRange: [3, 8] }
  ];

  const handleSimulate = (e: React.FormEvent) => {
    e.preventDefault();
    const street = streetOptions.find(s => s.id === selectedStreet);
    if (!street) return;

    const desc = customDesc.trim() || `Heavy congestion reported on ${street.name} causing transit delays.`;
    onTriggerIncident(selectedStreet, severity, Number(customDelay), desc);
    setCustomDesc('');
  };

  const activeAlerts = alerts.filter(a => !a.isRead);

  return (
    <div className="bg-[#121217] rounded-2xl border border-[#2A2A30] p-5 shadow-xl shadow-black/10" id="delay-alert-panel">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-[#F0F0F0] flex items-center gap-2 uppercase tracking-wide font-display">
            <Bell className="w-5 h-5 text-[#3B82F6] animate-swing" />
            Live Traffic Center & Alerts
          </h2>
          <p className="text-xs text-[#8E9299]">
            Configure dynamic road incidents and trigger simulated parent push-notification warnings
          </p>
        </div>
        {activeAlerts.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#EF4444] text-[10px] font-bold text-white animate-pulse">
            {activeAlerts.length}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Incident Injector Form */}
        <div className="p-4 bg-[#1A1A1E] rounded-2xl border border-[#2A2A30]">
          <h3 className="text-xs font-bold text-[#F0F0F0] uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-[#3B82F6]" />
            Inject Live Traffic Incident
          </h3>

          <form onSubmit={handleSimulate} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider block mb-1">Target St / Zone</label>
              <select
                className="w-full px-3 py-2 text-xs border border-[#2A2A30] rounded-xl bg-[#0A0A0C] text-[#F0F0F0] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                value={selectedStreet}
                onChange={(e) => setSelectedStreet(e.target.value)}
              >
                {streetOptions.map(opt => (
                  <option key={opt.id} value={opt.id} className="bg-[#0A0A0C] text-[#F0F0F0]">
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider block mb-1">Severity</label>
                <select
                  className="w-full px-3 py-2 text-xs border border-[#2A2A30] rounded-xl bg-[#0A0A0C] text-[#F0F0F0] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                >
                  <option value="moderate" className="bg-[#0A0A0C] text-[#F0F0F0]">Moderate Delay ⚠️</option>
                  <option value="severe" className="bg-[#0A0A0C] text-[#F0F0F0]">Severe Blockage 🛑</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider block mb-1">Delay (mins)</label>
                <input
                  type="number"
                  min="2"
                  max="45"
                  className="w-full px-3 py-2 text-xs border border-[#2A2A30] rounded-xl bg-[#0A0A0C] text-[#F0F0F0] focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                  value={customDelay}
                  onChange={(e) => setCustomDelay(Number(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-wider block mb-1">Message Description</label>
              <input
                type="text"
                placeholder="e.g., Accident near Arabiata / Construction near El Abd Pastry"
                className="w-full px-3 py-2 text-xs border border-[#2A2A30] rounded-xl bg-[#0A0A0C] text-[#F0F0F0] focus:outline-none focus:ring-1 focus:ring-[#3B82F6] placeholder-[#8E9299]/40"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Simulate & Push Alert
            </button>
          </form>
        </div>

        {/* Dynamic Alerts List */}
        <div className="flex flex-col">
          <h3 className="text-xs font-bold text-[#F0F0F0] uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-[#3B82F6]" />
            Active Warning Desk ({alerts.length})
          </h3>

          <div className="flex-1 border border-[#2A2A30] rounded-2xl p-3 bg-[#0A0A0C] max-h-[220px] overflow-y-auto space-y-2">
            {alerts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[#8E9299] py-8">
                <Check className="w-8 h-8 text-[#10B981] mb-1.5" />
                <span className="text-xs font-semibold text-[#F0F0F0]">All streets are fully clear</span>
                <span className="text-[10px] text-[#8E9299] mt-0.5 max-w-[200px]">Zero active traffic delays detected on Heliopolis roads.</span>
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`p-2.5 rounded-xl border flex items-start justify-between gap-2.5 text-xs font-sans transition-all ${
                    alert.severity === 'severe'
                      ? 'bg-rose-950/20 border-rose-900/50 text-rose-300'
                      : 'bg-amber-950/20 border-amber-900/50 text-amber-300'
                  }`}
                >
                  <div className="flex gap-2">
                    <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                      alert.severity === 'severe' ? 'text-rose-400' : 'text-amber-400'
                    }`} />
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        {alert.streetName.toUpperCase()} INCIDENT
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono ${
                          alert.severity === 'severe' ? 'bg-rose-950/40 border border-rose-900/50 text-rose-300' : 'bg-amber-950/40 border border-amber-900/50 text-amber-300'
                        }`}>
                          {alert.timestamp}
                        </span>
                      </div>
                      <p className="text-[10px] mt-1 opacity-90 leading-relaxed">{alert.message}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onClearAlert(alert.id)}
                    className={`p-1 rounded-md shrink-0 transition-all ${
                      alert.severity === 'severe' ? 'hover:bg-rose-950/40 text-rose-400 hover:text-rose-200' : 'hover:bg-amber-950/40 text-amber-400 hover:text-amber-200'
                    }`}
                    title="Dismiss Incident"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
