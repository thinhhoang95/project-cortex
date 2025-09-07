"use client";
import { useSimStore } from "@/components/useSimStore";
import { useEffect } from "react";
import ShimmeringText from "@/components/ShimmeringText";

type LeftControl1Props = { embedded?: boolean };

export default function LeftControl1({ embedded = false }: LeftControl1Props) {
  const { showHotspots, setShowHotspots, fetchHotspots, hotspotsLoading, hotspots, setT, setSelectedTrafficVolume } = useSimStore();
  
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
    // Set simulation time to the beginning of the time bin
    const [startTime] = hotspot.time_bin.split('-');
    const startSeconds = parseTimeToSeconds(startTime);
    setT(startSeconds);

    // Open the AirspaceInfo panel for this traffic volume
    setSelectedTrafficVolume(hotspot.traffic_volume_id, null);

    // Dispatch event to pan to the traffic volume (similar to traffic volume search)
    const event = new CustomEvent('traffic-volume-search-select', {
      detail: { trafficVolumeId: hotspot.traffic_volume_id }
    });
    window.dispatchEvent(event);
  };
  
  

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "absolute top-20 left-4 z-50 min-w-[280px] max-w-[360px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col overflow-hidden"}>
      
      <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 space-y-4 flex-1"}>

      <div className="bg-white/5 rounded-lg p-4">
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

        {/* Hotspot Table */}
        {showHotspots && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-medium text-sm opacity-90">Hotspots</h4>
              {hotspotsLoading && (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border border-white/20 border-t-white"></div>
                  <ShimmeringText text="Loading..." className="ml-1 text-xs opacity-70" />
                </div>
              )}
            </div>
            
            {hotspots.length > 0 && !hotspotsLoading ? (
              <div className={embedded ? "" : "max-h-32 overflow-y-auto no-scrollbar"}>
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
