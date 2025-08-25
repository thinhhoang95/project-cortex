"use client";
import { useSimStore } from "@/components/useSimStore";
import { useEffect, useState } from "react";

export default function LeftControl1Regulation() {
  const { t, range, setRange, playing, setPlaying, speed, setSpeed, showFlightLineLabels, setShowFlightLineLabels, showFlightLines, setShowFlightLines, flLowerBound, flUpperBound, setFlLowerBound, setFlUpperBound, showHotspots, setShowHotspots, fetchHotspots, hotspotsLoading, hotspots, setT, setSelectedTrafficVolume } = useSimStore();
  // Local draft time to avoid spamming global state (and API calls) while dragging
  const [isDraggingTime, setIsDraggingTime] = useState(false);
  const [draftT, setDraftT] = useState<number | null>(null);
  
  // Fetch hotspots when show hotspots is turned on
  useEffect(() => {
    if (showHotspots) {
      fetchHotspots();
    }
  }, [showHotspots, fetchHotspots]);

  // Utility function to parse time string (HH:MM) to seconds
  const parseTimeToSeconds = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 3600 + minutes * 60;
  };

  // Handle clicking on hotspot row
  const handleHotspotRowClick = (hotspot: any) => {
    const [startTime] = hotspot.time_bin.split('-');
    const startSeconds = parseTimeToSeconds(startTime);
    setT(startSeconds);

    // Open the Regulation Design panel (select the TV)
    setSelectedTrafficVolume(hotspot.traffic_volume_id, null);

    // Pan to the TV
    const event = new CustomEvent('traffic-volume-search-select', { detail: { trafficVolumeId: hotspot.traffic_volume_id } });
    window.dispatchEvent(event);
  };
  
  // Commit draft time on pointer/mouse/touch release anywhere
  useEffect(() => {
    if (!isDraggingTime) return;
    const handleUp = () => {
      if (draftT !== null) setT(draftT);
      setIsDraggingTime(false);
      setDraftT(null);
    };
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDraggingTime, draftT, setT]);
  
  return (
    <div className="w-full flex-1 min-h-0
                    rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                    shadow-xl text-slate-900 text-white flex flex-col overflow-hidden">
      
      <div className="overflow-y-auto no-scrollbar p-4 space-y-4 flex-1 min-h-0">
      
      <div className="bg-white/5 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Time of day</h2>
          <button
            onClick={() => setPlaying(!playing)}
            className="px-3 py-1.5 rounded-xl border border-white/30 bg-white/30 hover:bg-white/40 text-sm"
          >
            {playing ? "Pause" : "Play"}
          </button>
        </div>

        <div className="text-2xl font-bold mb-3 text-center bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent drop-shadow-lg">
          T = {fmt(isDraggingTime && draftT !== null ? draftT : t)}
        </div>

        <input
          type="range"
          min={range[0]} max={range[1]} step={1}
          value={isDraggingTime && draftT !== null ? draftT : t}
          onPointerDown={() => { setIsDraggingTime(true); setDraftT(t); }}
          onChange={(e) => {
            const next = Number(e.currentTarget.value);
            setDraftT(next);
          }}
          className="w-full"
        />

        <div className="mt-3 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <label className="text-sm">Speed</label>
          </div>
          <select
            className="rounded-lg bg-white/50 px-2 py-1 text-sm"
            value={speed}
            onChange={(e) => setSpeed(Number(e.currentTarget.value))}
          >
            {[0.5,1,2,5,10].map(x => <option key={x} value={x}>{x}×</option>)}
          </select>
          <span className="text-xs text-gray-400 ml-auto">Time in UTC</span>
        </div>
      </div>

      <div className="bg-white/5 rounded-lg p-4">
        <h2 className="font-semibold mb-3">View Options</h2>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <label className="text-sm">Flight Line Labels</label>
          </div>
          <button
            onClick={() => setShowFlightLineLabels(!showFlightLineLabels)}
            className={`px-3 py-1.5 rounded-xl border border-white/30 text-sm transition-colors ${
              showFlightLineLabels 
                ? "bg-white/40 hover:bg-white/50" 
                : "bg-white/20 hover:bg-white/30"
            }`}
          >
            {showFlightLineLabels ? "On" : "Off"}
          </button>
        </div>
        
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
            </svg>
            <label className="text-sm">Flight Lines</label>
          </div>
          <button
            onClick={() => setShowFlightLines(!showFlightLines)}
            className={`px-3 py-1.5 rounded-xl border border-white/30 text-sm transition-colors ${
              showFlightLines 
                ? "bg-white/40 hover:bg-white/50" 
                : "bg-white/20 hover:bg-white/30"
            }`}
          >
            {showFlightLines ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="bg-white/5 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Airspace</h2>
        
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <label className="text-sm">Lower FL</label>
              </div>
              <span className="text-sm opacity-80">{flLowerBound}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={flLowerBound}
              onChange={(e) => setFlLowerBound(Number(e.currentTarget.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                <label className="text-sm">Upper FL</label>
              </div>
              <span className="text-sm opacity-80">{flUpperBound}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={10}
              value={flUpperBound}
              onChange={(e) => setFlUpperBound(Number(e.currentTarget.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      <div className="bg-white/5 rounded-lg p-4 flex-1 flex flex-col">
        <h2 className="font-semibold mb-3">Dynamic Capacity Balancing</h2>
        
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => fetchHotspots()}
            disabled={hotspotsLoading}
            className={`p-1.5 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-opacity ${
              hotspotsLoading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title="Refresh Hotspots"
          >
            <svg className={`w-4 h-4 ${hotspotsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          
          <div className="flex items-center justify-between flex-1">
            <label className="text-sm">Show Hotspots</label>
            <button
              onClick={() => setShowHotspots(!showHotspots)}
              className={`px-3 py-1.5 rounded-xl border border-white/30 text-sm transition-colors ${
                showHotspots 
                  ? "bg-white/40 hover:bg-white/50" 
                  : "bg-white/20 hover:bg-white/30"
              }`}
            >
              {showHotspots ? "On" : "Off"}
            </button>
          </div>
        </div>

        {showHotspots && (
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-medium text-sm opacity-90">Hotspots</h4>
              {hotspotsLoading && (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border border-white/20 border-t-white"></div>
                  <span className="ml-1 text-xs opacity-70">Loading...</span>
                </div>
              )}
            </div>
            
            {hotspots.length > 0 && !hotspotsLoading ? (
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-red-900 text-white">
                      <th className="text-left p-2 font-semibold">TV ID</th>
                      <th className="text-left p-2 font-semibold">Time Bin</th>
                      <th className="text-left p-2 font-semibold">Z Max</th>
                      <th className="text-left p-2 font-semibold">Occupancy</th>
                      <th className="text-left p-2 font-semibold">Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotspots.map((hotspot, index) => (
                      <tr 
                        key={`${hotspot.traffic_volume_id}-${hotspot.time_bin}`} 
                        className={`border-b border-white/10 hover:bg-white/10 cursor-pointer transition-colors ${index % 2 === 0 ? 'bg-white/2' : ''}`}
                        onClick={() => handleHotspotRowClick(hotspot)}
                        title="Click to set time and pan to traffic volume"
                      >
                        <td className="p-2 font-mono text-xs">{hotspot.traffic_volume_id}</td>
                        <td className="p-2 font-mono text-xs">{hotspot.time_bin}</td>
                        <td className="p-2 font-mono">{hotspot.z_max.toFixed(1)}</td>
                        <td className="p-2 font-mono">{hotspot.hourly_occupancy.toFixed(0)}</td>
                        <td className="p-2 font-mono">{hotspot.hourly_capacity.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !hotspotsLoading ? (
              <p className="text-xs opacity-70 text-center py-4">No hotspots found</p>
            ) : null}
          </div>
        )}
      </div>

      </div>
    </div>
  );
}

function fmt(sec: number) {
  const h = Math.floor(sec/3600).toString().padStart(2,"0");
  const m = Math.floor((sec%3600)/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${h}:${m}:${s}`;
}


