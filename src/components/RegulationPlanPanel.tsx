"use client";
import { useState } from "react";
import { useSimStore } from "@/components/useSimStore";
import ShimmeringText from "@/components/ShimmeringText";

interface RegulationPlanPanelProps {
  isRegulationPanelOpen: boolean;
}

export default function RegulationPlanPanel({ isRegulationPanelOpen }: RegulationPlanPanelProps) {
  const { regulations, removeRegulation, setRegulationEditPayload, setIsRegulationPanelOpen, setRegulationSimulationResult, setIsResultsOpen, flights } = useSimStore();
  const [selectedRegulation, setSelectedRegulation] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
  }

  function computeTimeWindowBins(fromSeconds: number, toSeconds: number): number[] {
    const binSize = 15 * 60; // 15 minutes
    if (toSeconds <= fromSeconds) {
      return [Math.floor(fromSeconds / binSize)];
    }
    const startBin = Math.floor(fromSeconds / binSize);
    const endBinExclusive = Math.ceil(toSeconds / binSize);
    const bins: number[] = [];
    for (let b = startBin; b < endBinExclusive; b++) bins.push(b);
    return bins;
  }

  return (
    <div 
      className={`absolute top-20 z-40 w-[340px] max-h-[calc(100vh-6rem)]
                  rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                  shadow-xl text-white flex flex-col transition-all duration-300 ${
                    isRegulationPanelOpen ? 'right-[416px]' : 'right-4'
                  }`}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Active Network</div>
          <div className="text-lg font-semibold">Regulation Plan</div>
          <div className="text-xs opacity-80">
            {regulations.length} Regulation{regulations.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <div className="overflow-y-auto no-scrollbar p-4 flex-1 space-y-4">
        {/* Regulations Table */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-sm opacity-90">
              Regulations ({regulations.length})
            </div>
          </div>
          
          {regulations.length === 0 ? (
            <div className="text-xs opacity-70 text-center py-4">
              No regulations created yet. Use the regulation panel to create one.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto no-scrollbar">
              <div className="space-y-2">
                {regulations.map((reg) => (
                  <div
                    key={reg.id}
                    onClick={() => setSelectedRegulation(selectedRegulation === reg.id ? null : reg.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                      selectedRegulation === reg.id
                        ? 'bg-white/15 border-white/30'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-mono text-sm font-semibold">{reg.id}</div>
                        <div className="text-xs opacity-80">{reg.trafficVolume}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                          e.stopPropagation();
                          // Hand off to regulation panel for editing
                          setRegulationEditPayload({
                            trafficVolume: reg.trafficVolume,
                            activeTimeWindowFrom: reg.activeTimeWindowFrom,
                            activeTimeWindowTo: reg.activeTimeWindowTo,
                            flightCallsigns: reg.flightCallsigns,
                            rate: reg.rate,
                          });
                            // Open the panel and ask the map to select & highlight this traffic volume
                            setIsRegulationPanelOpen(true);
                            window.dispatchEvent(new CustomEvent('traffic-volume-search-select', { detail: { trafficVolumeId: reg.trafficVolume } }));
                            removeRegulation(reg.id);
                          }}
                          className="text-blue-300 hover:text-blue-200 p-1"
                          title="Edit regulation"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.3 6.3l5.4 5.4M3 21l4.5-1.2L18.7 8.6a1.5 1.5 0 0 0 0-2.1L17.5 5.3a1.5 1.5 0 0 0-2.1 0L5.4 15.8 3 21z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRegulation(reg.id);
                          }}
                          className="text-red-300 hover:text-red-200 p-1"
                          title="Delete regulation"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="opacity-70">Rate:</span> {reg.rate}/h
                      </div>
                      <div>
                        <span className="opacity-70">Flights:</span> {reg.flightCallsigns.length}
                      </div>
                      <div className="col-span-2">
                        <span className="opacity-70">Time:</span> {formatTime(reg.activeTimeWindowFrom)}-{formatTime(reg.activeTimeWindowTo)}
                      </div>
                    </div>
                    
                    {selectedRegulation === reg.id && (
                      <div className="mt-3 pt-3 border-t border-white/20">
                        <div className="text-xs">
                          <div className="opacity-70 mb-2">Flight List:</div>
                          <div className="max-h-20 overflow-y-auto bg-white/5 rounded p-2">
                            {reg.flightCallsigns.map((callsign, idx) => (
                              <div key={idx} className="font-mono text-[10px]">{callsign}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-2">
          {isSimulating ? (
            <div className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium shadow flex items-center gap-2 text-sm">
              <ShimmeringText text="Computing New Plan" className="text-sm" />
            </div>
          ) : (
            <>
              <button
                onClick={async () => {
                  setErrorMessage(null);
                  if (!regulations || regulations.length === 0) {
                    setErrorMessage("No regulations available to simulate.");
                    return;
                  }
                  setIsSimulating(true);
                  try {
                    // Map stored callsigns/labels to flight identifiers expected by the API
                    const toFlightId = (token: string): string => {
                      const tokenStr = String(token);
                      const byId = flights.find(f => String(f.flightId) === tokenStr);
                      if (byId?.flightId) return String(byId.flightId);
                      const byCs = flights.find(f => f.callSign && String(f.callSign) === tokenStr);
                      if (byCs?.flightId) return String(byCs.flightId);
                      // Fallback: pass through (already an id or unknown)
                      return tokenStr;
                    };

                    const payload = {
                      regulations: regulations.map((r) => ({
                        location: r.trafficVolume,
                        rate: r.rate,
                        time_windows: computeTimeWindowBins(r.activeTimeWindowFrom, r.activeTimeWindowTo),
                        // API expects flight identifiers, not callsigns
                        target_flight_ids: r.flightCallsigns.map(toFlightId),
                      })),
                      weights: { alpha: 1.0, beta: 0.0, gamma: 0.0, delta: 0.0 },
                      top_k: 50,
                      include_excess_vector: false,
                    };

                    const res = await fetch("/api/regulation_plan_simulation", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });

                    if (!res.ok) {
                      const text = await res.text();
                      throw new Error(`Simulation request failed: ${res.status} ${text}`);
                    }

                    const result = await res.json();
                    setRegulationSimulationResult(result);
                    setIsResultsOpen(true);
                  } catch (err) {
                    console.error(err);
                    setErrorMessage(err instanceof Error ? err.message : "Unknown error during simulation");
                  } finally {
                    setIsSimulating(false);
                  }
                }}
                disabled={isSimulating || regulations.length === 0}
                className={`px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium shadow flex items-center gap-2 text-sm ${
                  regulations.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                }`}
                title={regulations.length === 0 ? "No regulations to simulate" : "Simulate plan"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z" fill="currentColor"/>
                </svg>
                Simulate Plan
              </button>

              {/* Small Auto button with a sparkles icon */}
              <button
                onClick={() => { /* no-op for now */ }}
                className="px-2 py-2 rounded-lg bg-white/10 border border-white/20 text-white shadow hover:bg-white/15 flex items-center gap-1 text-xs"
                title="Auto (coming soon)"
              >
                {/* Sparkles icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2l1.5 3.5L17 7l-3.5 1.5L12 12l-1.5-3.5L7 7l3.5-1.5L12 2zM19 13l.9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13zM5 14l.7 1.6L7 16l-1.3.4L5 18l-.7-1.6L3 16l1.3-.4L5 14z" fill="currentColor"/>
                </svg>
                Auto
              </button>
            </>
          )}
        </div>

        {errorMessage && (
          <div className="text-red-200 text-xs text-center mt-2 opacity-90">{errorMessage}</div>
        )}
      </div>
    </div>
  );
}
