"use client";
import { useSimStore } from "@/components/useSimStore";
import { useEffect, useMemo, useState } from "react";
import ShimmeringText from "@/components/ShimmeringText";

type LeftControl1Props = { embedded?: boolean };

export default function LeftControl1({ embedded = false }: LeftControl1Props) {
  const { showHotspots, setShowHotspots, fetchHotspots, hotspotsLoading, hotspots, setT, setSelectedTrafficVolume } = useSimStore();
  
  // Sorting state for hotspot table
  type SortKey = 'tv' | 'time' | 'occ' | 'cap' | 'ex';
  const [sortBy, setSortBy] = useState<SortKey>('ex');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Show-more toggle for hotspot table
  const [showAllHotspots, setShowAllHotspots] = useState(false);
  
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

  // Compute sorted hotspots based on current sort key and direction
  const sortedHotspots = useMemo(() => {
    const list = [...hotspots];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a: any, b: any) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      switch (sortBy) {
        case 'tv':
          av = String(a.traffic_volume_id || '');
          bv = String(b.traffic_volume_id || '');
          return (av as string).localeCompare(bv as string) * dir;
        case 'time': {
          const [aStart] = String(a.time_bin || '').split('-');
          const [bStart] = String(b.time_bin || '').split('-');
          av = parseTimeToSeconds(aStart || '00:00');
          bv = parseTimeToSeconds(bStart || '00:00');
          break;
        }
        case 'occ':
          av = Number(a.hourly_occupancy || 0);
          bv = Number(b.hourly_occupancy || 0);
          break;
        case 'cap':
          av = Number(a.hourly_capacity || 0);
          bv = Number(b.hourly_capacity || 0);
          break;
        case 'ex':
          av = Number(a.hourly_occupancy || 0) - Number(a.hourly_capacity || 0);
          bv = Number(b.hourly_occupancy || 0) - Number(b.hourly_capacity || 0);
          break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tie-break: by TV then time start
      const tvCmp = String(a.traffic_volume_id || '').localeCompare(String(b.traffic_volume_id || ''));
      if (tvCmp !== 0) return tvCmp;
      const [aStart] = String(a.time_bin || '').split('-');
      const [bStart] = String(b.time_bin || '').split('-');
      return parseTimeToSeconds(aStart || '00:00') - parseTimeToSeconds(bStart || '00:00');
    });
    return list;
  }, [hotspots, sortBy, sortDir]);

  // Determine which hotspots to display based on show-more state
  const displayedHotspots = useMemo(() => {
    if (showAllHotspots) return sortedHotspots;
    return sortedHotspots.slice(0, 20);
  }, [sortedHotspots, showAllHotspots]);

  const handleHeaderClick = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
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
              type="button"
              role="switch"
              aria-checked={showHotspots}
              aria-label={showHotspots ? "Hide hotspots" : "Show hotspots"}
              onClick={() => setShowHotspots(!showHotspots)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                showHotspots
                  ? "border-emerald-200/70 bg-emerald-400/80 hover:bg-emerald-400/90"
                  : "border-white/30 bg-white/20 hover:bg-white/30"
              }`}
            >
              <span className="sr-only">{showHotspots ? "Disable hotspots" : "Enable hotspots"}</span>
              <span
                aria-hidden="true"
                className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  showHotspots ? "translate-x-5" : "translate-x-0"
                }`}
              />
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
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <div className={embedded 
                  ? "overflow-x-auto"
                  : "max-h-32 overflow-y-auto no-scrollbar overflow-x-auto"}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white/10 select-none">
                      <SortableTh label="TV" active={sortBy === 'tv'} dir={sortDir} onClick={() => handleHeaderClick('tv')} />
                      <SortableTh label="Time" active={sortBy === 'time'} dir={sortDir} onClick={() => handleHeaderClick('time')} />
                      <SortableTh label="Occ." active={sortBy === 'occ'} dir={sortDir} onClick={() => handleHeaderClick('occ')} />
                      <SortableTh label="Cap." active={sortBy === 'cap'} dir={sortDir} onClick={() => handleHeaderClick('cap')} />
                      <SortableTh label="Ex." active={sortBy === 'ex'} dir={sortDir} onClick={() => handleHeaderClick('ex')} />
                      </tr>
                    </thead>
                    <tbody>
                      {displayedHotspots.map((hotspot, index) => {
                      const [from, to] = String(hotspot.time_bin || '').split('-');
                      return (
                        <tr 
                          key={`${hotspot.traffic_volume_id}-${hotspot.time_bin}`} 
                          className={`border-t border-white/10 ${index % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10 cursor-pointer transition-colors`}
                          onClick={() => handleHotspotRowClick(hotspot)}
                          title="Click to set time and pan to traffic volume"
                        >
                          <td className="p-2 font-mono text-xs">{hotspot.traffic_volume_id}</td>
                          <td className="p-2 font-mono text-xs leading-tight">
                            <div>{from?.trim()}</div>
                            <div>{to?.trim()}</div>
                          </td>
                          <td className="p-2 text-right font-mono">{hotspot.hourly_occupancy.toFixed(0)}</td>
                          <td className="p-2 text-right font-mono">{hotspot.hourly_capacity.toFixed(0)}</td>
                          <td className="p-2 text-right font-mono">{(hotspot.hourly_occupancy - hotspot.hourly_capacity).toFixed(0)}</td>
                        </tr>
                      );
                    })}
                    {!showAllHotspots && sortedHotspots.length > 20 && (
                      <tr 
                        className="border-t border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                        onClick={() => setShowAllHotspots(true)}
                        title="Show the remaining hotspots"
                      >
                        <td className="p-2 text-center italic opacity-80" colSpan={5}>See more…</td>
                      </tr>
                    )}
                    {showAllHotspots && sortedHotspots.length > 20 && (
                      <tr 
                        className="border-t border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                        onClick={() => setShowAllHotspots(false)}
                        title="Collapse the list"
                      >
                        <td className="p-2 text-center italic opacity-80" colSpan={5}>See less…</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
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

type SortableThProps = {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
};

function SortableTh({ label, active, dir, onClick }: SortableThProps) {
  return (
    <th className="text-left p-2 font-semibold">
      <button 
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-white/40 rounded"
        aria-pressed={active}
        title={`Sort by ${label} (${dir === 'asc' ? 'ascending' : 'descending'})`}
      >
        <span>{label}</span>
        <svg 
          className={`w-3 h-3 transition-transform ${active ? 'opacity-100' : 'opacity-0'} ${active && dir === 'asc' ? 'transform rotate-180' : ''}`}
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor"
        >
          <path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </th>
  );
}

function fmt(sec: number) {
  const h = Math.floor(sec/3600).toString().padStart(2,"0");
  const m = Math.floor((sec%3600)/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${h}:${m}:${s}`;
}
