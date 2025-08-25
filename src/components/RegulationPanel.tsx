"use client";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line, ReferenceLine } from 'recharts';
import { useSimStore } from "@/components/useSimStore";

export default function RegulationPanel() {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumeData,
    t,
    flights,
    focusMode,
    setFocusMode,
    setFocusFlightIds,
    setT,
    regulationTargetFlightIds,
    addRegulationTargetFlight,
    removeRegulationTargetFlight,
    clearRegulationTargetFlights,
    setRegulationTargetFlightIds,
    regulationTimeWindow,
    setRegulationTimeWindow,
    regulationRate,
    setRegulationRate,
    setSelectedTrafficVolume,
    addRegulation,
    setIsRegulationPanelOpen,
    regulationEditPayload,
    setRegulationEditPayload
  } = useSimStore();

  const [inputValue, setInputValue] = useState("");
  const [activePreset, setActivePreset] = useState<string>("1h");
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [hourlyCapacity, setHourlyCapacity] = useState<number>(0);
  const [occupancyData, setOccupancyData] = useState<any | null>(null);
  const [flightIdentifiersData, setFlightIdentifiersData] = useState<Record<string, string[]> | null>(null);
  const [orderedFlightsData, setOrderedFlightsData] = useState<any | null>(null);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [flightListError, setFlightListError] = useState<string | null>(null);

  // Load occupancy/capacity and default rate when TV changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedTrafficVolume) { setOccupancyData(null); return; }
      try {
        const res = await fetch(`/api/tv_count_with_capacity?traffic_volume_id=${selectedTrafficVolume}`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (cancelled) return;
        setOccupancyData(data);
        const cap = capacityForTime(data?.hourly_capacity || {}, t);
        setHourlyCapacity(cap ?? 0);
        setRegulationRate(cap ?? 0);
      } catch {
        if (!cancelled) { setOccupancyData(null); setHourlyCapacity(0); }
      }
      clearRegulationTargetFlights();
      // Default active time window anchored at current t unless editing payload provided
      if (!useSimStore.getState().regulationEditPayload) {
        applyPreset(activePreset);
      }
    }
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrafficVolume]);

  // Load flight identifiers for this TV (ordered when possible)
  useEffect(() => {
    let cancelled = false;
    async function loadFlights() {
      if (!selectedTrafficVolume) { setFlightIdentifiersData(null); setOrderedFlightsData(null); return; }
      setFlightListLoading(true);
      setFlightListError(null);
      try {
        const ref = formatTimeForAPI(t);
        const res = await fetch(`/api/tv_flights?traffic_volume_id=${selectedTrafficVolume}&ref_time_str=${ref}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (cancelled) return;
        if (data.ordered_flights && data.details) {
          setOrderedFlightsData(data);
          setFlightIdentifiersData(null);
        } else {
          setFlightIdentifiersData(data);
          setOrderedFlightsData(null);
        }
      } catch (e: any) {
        if (!cancelled) setFlightListError(e?.message || 'Failed to fetch flight identifiers');
        setFlightIdentifiersData(null);
        setOrderedFlightsData(null);
      } finally {
        if (!cancelled) setFlightListLoading(false);
      }
    }
    loadFlights();
    return () => { cancelled = true; };
  }, [selectedTrafficVolume, t]);

  // Recompute current count and capacity when time changes
  useEffect(() => {
    const cap = capacityForTime(occupancyData?.hourly_capacity || {}, t);
    setHourlyCapacity(cap ?? hourlyCapacity);
    const count = currentCountForTime(occupancyData, t);
    if (typeof count === 'number') setCurrentCount(count);
  }, [t, occupancyData]);

  // Build histogram data (rolling hour), then filter to active time window
  const baseChartData: Array<{ time: string; count: number; hour: number; capacity?: number }> = useMemo(() => {
    if (!occupancyData) return [];
    const entries = Object.entries(occupancyData.occupancy_counts || {});
    const arr = entries.map(([timeRange, count]) => {
      const [startTime] = timeRange.split('-');
      const [hours, minutes] = startTime.split(':').map(Number);
      const hour = hours + minutes / 60;
      const hourKey = `${hours.toString().padStart(2, '0')}:00-${(hours + 1).toString().padStart(2, '0')}:00`;
      const capacity = occupancyData.hourly_capacity?.[hourKey];
      return { time: timeRange, count: count as number, hour, capacity };
    }).sort((a,b) => a.hour - b.hour);
    return arr;
  }, [occupancyData]);

  const chartData = useMemo(() => {
    if (baseChartData.length === 0) return [] as typeof baseChartData;
    // Deduce bin minutes
    const timeBinMinutes = (() => {
      const meta = occupancyData?.metadata?.time_bin_minutes;
      if (typeof meta === 'number' && meta > 0) return meta;
      try {
        const [start, end] = baseChartData[0].time.split('-');
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        return Math.max(1, (eh*60+em) - (sh*60+sm));
      } catch { return 60; }
    })();
    const binsPerHour = Math.max(1, Math.round(60 / timeBinMinutes));
    const rolling = baseChartData.map((_, idx) => {
      let rollingSum = 0;
      const endIdx = Math.min(idx + binsPerHour, baseChartData.length);
      for (let j = idx; j < endIdx; j++) rollingSum += baseChartData[j].count;
      return { ...baseChartData[idx], count: rollingSum };
    });
    return rolling;
  }, [baseChartData, occupancyData]);

  const displayChartData = useMemo(() => {
    if (!chartData.length) return [] as typeof chartData;
    const [from, to] = regulationTimeWindow;
    const windowDuration = to - from;
    const currentTime = t;
    
    // Create symmetric range around current time for display,
    // using the full regulation window on each side of t
    const displayFrom = currentTime - windowDuration;
    const displayTo = currentTime + windowDuration;
    
    return chartData.filter(d => {
      const sec = d.hour * 3600;
      return sec >= displayFrom && sec <= displayTo;
    });
  }, [chartData, regulationTimeWindow, t]);

  // Compute filtered flights for active time window, and apply focus filter on the map
  const filteredFlightIds = useMemo(() => {
    const [from, to] = regulationTimeWindow;
    const set = new Set<string>();
    if (orderedFlightsData?.details) {
      orderedFlightsData.details.forEach((d: any) => {
        if (d.arrival_seconds >= from && d.arrival_seconds <= to) set.add(String(d.flight_id));
      });
    } else if (flightIdentifiersData) {
      Object.entries(flightIdentifiersData).forEach(([timeWindow, ids]) => {
        const [startTime] = timeWindow.split('-');
        const [hours, minutes] = startTime.split(':').map(Number);
        const startSec = hours * 3600 + minutes * 60;
        if (startSec >= from && startSec <= to) ids.forEach(id => set.add(String(id)));
      });
    }
    return set;
  }, [orderedFlightsData, flightIdentifiersData, regulationTimeWindow]);

  // Apply focus mode and ids to filter map to only those flights
  useEffect(() => {
    if (!selectedTrafficVolume) return;
    const currentIds = useSimStore.getState().focusFlightIds;
    const same = areSetsEqual(currentIds, filteredFlightIds);
    if (!same) setFocusFlightIds(filteredFlightIds);
    if (!focusMode) setFocusMode(true);
  }, [filteredFlightIds, selectedTrafficVolume, setFocusFlightIds, focusMode, setFocusMode]);

  // derive selected flights
  const selectedFlights = useMemo(() => {
    const idSet = regulationTargetFlightIds;
    return flights.filter(f => idSet.has(String(f.flightId)));
  }, [flights, regulationTargetFlightIds]);

  // time window presets
  const presets = ["15", "30", "45", "1h", "2h", "4h", "6h"];
  useEffect(() => {
    applyPreset(activePreset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, t]);

  function applyPreset(preset: string) {
    const from = Math.floor(t);
    let to = from;
    const n = parseInt(preset);
    if (preset.endsWith("h")) to = from + n * 3600; else to = from + n * 60;
    setRegulationTimeWindow(from, to);
  }

  function handleEnter() {
    const q = inputValue.trim();
    if (!q) return;
    // For now, support callsign/flightId exact match
    const queryLower = q.toLowerCase();
    const flight = flights.find(f => {
      const idMatch = String(f.flightId).toLowerCase() === queryLower;
      const cs = f.callSign;
      const csLower = cs !== undefined && cs !== null ? String(cs).toLowerCase() : undefined;
      const csMatch = csLower ? csLower === queryLower : false;
      return idMatch || csMatch;
    });
    if (flight) {
      addRegulationTargetFlight(String(flight.flightId));
      setInputValue("");
    }
  }

  // Listen for map flight clicks to add to list
  useEffect(() => {
    const handler = (e: any) => {
      const { flightId } = e.detail || {};
      if (flightId) addRegulationTargetFlight(String(flightId));
    };
    window.addEventListener('regulation-add-flight', handler as any);
    return () => window.removeEventListener('regulation-add-flight', handler as any);
  }, [addRegulationTargetFlight]);

  function handlePreviewRegulation() {
    if (!selectedTrafficVolume || selectedFlights.length === 0) return;
    
    const flightCallsigns = selectedFlights.map(f => f.callSign || String(f.flightId));
    
    addRegulation({
      trafficVolume: selectedTrafficVolume,
      activeTimeWindowFrom: regulationTimeWindow[0],
      activeTimeWindowTo: regulationTimeWindow[1],
      flightCallsigns,
      rate: regulationRate
    });

    setIsRegulationPanelOpen(true);
    clearRegulationTargetFlights();
  }

  // Apply pending edit payload (from RegulationPlanPanel) without causing extra API calls
  useEffect(() => {
    const payload = regulationEditPayload;
    if (!payload) return;
    if (payload.trafficVolume !== selectedTrafficVolume) return; // wait until TV matches

    // Apply time window and rate
    setRegulationTimeWindow(payload.activeTimeWindowFrom, payload.activeTimeWindowTo);
    setRegulationRate(payload.rate);

    // Map provided callsigns/ids back to flight IDs present in store
    const want = new Set(payload.flightCallsigns.map(String));
    const idSet = new Set<string>();
    for (const f of flights) {
      const idStr = String(f.flightId);
      const cs = f.callSign != null ? String(f.callSign) : undefined;
      if (want.has(idStr) || (cs && want.has(cs))) {
        idSet.add(idStr);
      }
    }
    setRegulationTargetFlightIds(idSet);

    // Clear payload so it doesn't apply repeatedly
    setRegulationEditPayload(null);
  }, [regulationEditPayload, selectedTrafficVolume, flights, setRegulationTimeWindow, setRegulationRate, setRegulationTargetFlightIds, setRegulationEditPayload]);

  if (!selectedTrafficVolume) return null;

  return (
    <div className="absolute top-20 right-4 z-50 w-[384px] max-h-[calc(100vh-6rem)]
                    rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                    shadow-xl text-slate-900 text-white flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Reference TV</div>
          <div className="text-lg font-semibold">{selectedTrafficVolume}</div>
          {selectedTrafficVolumeData?.properties && (
            <div className="text-xs opacity-80">
              FL{selectedTrafficVolumeData.properties.min_fl.toString().padStart(3,'0')}-FL{selectedTrafficVolumeData.properties.max_fl.toString().padStart(3,'0')}
            </div>
          )}
        </div>
        <button
          onClick={() => { 
            setSelectedTrafficVolume(null);
            setFocusMode(false);
            setFocusFlightIds(new Set());
            window.dispatchEvent(new CustomEvent('clearTrafficVolumeHighlight'));
          }}
          className="px-2 py-1 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-colors"
          title="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto no-scrollbar p-4 flex-1 space-y-4">
        {/* Current count + capacity summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">Current Count</div>
            <div className="text-lg font-semibold">{currentCount}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">Hourly Capacity</div>
            <div className="text-lg font-semibold">{hourlyCapacity}</div>
          </div>
        </div>

        {/* Time window presets */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="font-medium text-sm opacity-90 mb-2">Active Time Window</div>
          <div className="grid grid-cols-4 gap-2">
            {presets.map((p) => (
              <button key={p} onClick={() => setActivePreset(p)} className={`px-3 py-2 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${activePreset === p ? 'bg-blue-500/30 border-blue-400/50 text-blue-200' : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30'}`}>
                {p}
              </button>
            ))}
          </div>
          <div className="text-xs opacity-70 mt-2">
            From {formatTime(regulationTimeWindow[0])} to {formatTime(regulationTimeWindow[1])}
          </div>
        </div>

        {/* Predicate / Flight List input */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm opacity-90">Predicate Syntax or Flight List</div>
          </div>
          <div className="relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleEnter(); }}
              placeholder="Enter callsign or flight id, then press Enter"
              className="w-full px-4 py-2 pr-8 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
            />
            <button onClick={handleEnter} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill="currentColor"/></svg>
            </button>
          </div>
        </div>

        {/* Selected flights table */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm opacity-90">Targeted Flights ({selectedFlights.length})</div>
            {selectedFlights.length > 0 && (
              <button onClick={() => clearRegulationTargetFlights()} className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">Clear</button>
            )}
          </div>
          {selectedFlights.length === 0 ? (
            <div className="text-xs opacity-70">No flights targeted. Click lines on map or enter callsign.</div>
          ) : (
            <div className="max-h-52 overflow-y-auto no-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-blue-900 text-white">
                    <th className="text-left p-2 font-semibold">Callsign</th>
                    <th className="text-left p-2 font-semibold">Origin</th>
                    <th className="text-left p-2 font-semibold">Destination</th>
                    <th className="text-left p-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedFlights.map((f) => (
                    <tr key={String(f.flightId)} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-2 font-mono">{f.callSign || f.flightId}</td>
                      <td className="p-2">{f.origin || 'N/A'}</td>
                      <td className="p-2">{f.destination || 'N/A'}</td>
                      <td className="p-2">
                        <button onClick={() => removeRegulationTargetFlight(String(f.flightId))} className="text-red-300 hover:text-red-200">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[10px] opacity-70 mt-2">Selected flight lines are shown in bright red on the map.</div>
        </div>

        {/* Histogram (Focus Mode style) */}
        {displayChartData.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm opacity-90">Rolling Hour Entrances & Capacity</h4>
              <span className="text-[10px] opacity-70">{formatTime(regulationTimeWindow[0])}–{formatTime(regulationTimeWindow[1])}</span>
            </div>
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={displayChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="time" tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} height={16} />
                  <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} width={26} />
                  <Tooltip content={<RegTooltip />} />
                  <Bar dataKey="count" fill="#06b6d4" radius={[2,2,0,0]} onClick={(_, index: number) => {
                    const point: any = displayChartData[index as any];
                    if (point && point.hour !== undefined) setT(point.hour * 3600);
                  }} style={{ cursor: 'pointer' }} />
                  <Line type="stepAfter" dataKey="capacity" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls={false} name="Capacity" isAnimationActive={false} />
                  <ReferenceLine x={nearestCategoryForTime(displayChartData, t)} stroke="#ef4444" strokeWidth={2} strokeDasharray="0" label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center space-x-4 mt-2 text-xs opacity-70">
              <div className="flex items-center"><div className="w-3 h-3 bg-cyan-500 rounded mr-1"></div><span>Entrances</span></div>
              <div className="flex items-center"><div className="w-3 h-0.5 bg-yellow-400 mr-1"></div><span>Hourly Capacity</span></div>
            </div>
          </div>
        )}

        {/* Rate */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="font-medium text-sm opacity-90 mb-2">Rate (per hour)</div>
          <input
            type="number"
            value={regulationRate}
            onChange={(e) => setRegulationRate(Number(e.currentTarget.value))}
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
          />
          {hourlyCapacity > 0 && (
            <div className="text-[10px] opacity-70 mt-1">Defaulted to hourly capacity: {hourlyCapacity}</div>
          )}
        </div>

        {/* Add Button */}
        <div className="flex justify-end">
          <button 
            onClick={handlePreviewRegulation}
            disabled={!selectedTrafficVolume || selectedFlights.length === 0}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-medium shadow hover:opacity-90 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

function capacityForTime(hourlyCapacity: Record<string, number>, t: number): number | undefined {
  // hourlyCapacity keys like "06:00-07:00"; find the matching range for current hour
  const h = Math.floor(t / 3600);
  const start = `${h.toString().padStart(2,'0')}:00`;
  const end = `${(h+1).toString().padStart(2,'0')}:00`;
  const key = `${start}-${end}`;
  return hourlyCapacity[key];
}

function currentCountForTime(occupancyData: any, t: number): number | undefined {
  if (!occupancyData) return undefined;
  const entries = Object.entries(occupancyData.occupancy_counts || {});
  if (entries.length === 0) return undefined;

  // Build sorted base bins with start/end (in minutes) and counts
  const base = entries.map(([range, count]) => {
    const [startStr, endStr] = range.split('-');
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMinRaw = eh * 60 + em;
    // normalize end >= start by rolling over midnight if needed
    const endMin = endMinRaw < startMin ? endMinRaw + 24 * 60 : endMinRaw;
    return { startStr, endStr, startMin, endMin, count: Number(count) };
  }).sort((a, b) => a.startMin - b.startMin);

  // Deduce bin size in minutes (prefer metadata if present)
  const timeBinMinutes = (() => {
    const meta = occupancyData?.metadata?.time_bin_minutes;
    if (typeof meta === 'number' && meta > 0) return meta;
    try {
      const [sh, sm] = base[0].startStr.split(':').map(Number);
      const [eh, em] = base[0].endStr.split(':').map(Number);
      const s = sh * 60 + sm;
      let e = eh * 60 + em;
      if (e < s) e += 24 * 60;
      return Math.max(1, e - s);
    } catch { return 60; }
  })();
  const binsPerHour = Math.max(1, Math.round(60 / timeBinMinutes));

  // Find index of bin that covers current time t
  const curMinOfDay = Math.floor(t / 60) % (24 * 60);
  let idx = -1;
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    let cur = curMinOfDay;
    // align current minute to same day window as bin if needed
    if (cur < b.startMin) cur += 24 * 60;
    if (cur >= b.startMin && cur < b.endMin) { idx = i; break; }
  }
  if (idx === -1) return undefined;

  // Compute rolling-hour sum starting at this bin
  let sum = 0;
  const endIdx = Math.min(idx + binsPerHour, base.length);
  for (let j = idx; j < endIdx; j++) sum += base[j].count;
  return sum;
}

function nearestCategoryForTime(data: Array<{ time: string; hour: number }>, t: number) {
  if (!data || data.length === 0) return undefined as any;
  const h = t / 3600;
  // pick first bin whose hour >= h, else last
  const found = data.find(d => h <= d.hour) || data[data.length - 1];
  return found.time as any;
}

function RegTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number, payload?: any }>; label?: string }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-slate-800/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 text-white text-sm">
        <p className="font-medium">{label}</p>
        <p className="text-blue-300">Flights: <span className="font-medium">{payload[0].value}</span></p>
        {d?.capacity !== undefined && (
          <p className="text-yellow-300">Capacity: <span className="font-medium">{d.capacity}</span></p>
        )}
      </div>
    );
  }
  return null;
}

function formatTimeForAPI(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}${secs.toString().padStart(2, '0')}`;
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}


