"use client";
import { useEffect, useMemo, useState } from "react";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import { loadSectors } from "@/lib/airspace";
import { authFetch } from "@/lib/auth";
import { useSimStore } from "@/components/useSimStore";
import ShimmeringText from "@/components/ShimmeringText";
import HourGlass from "@/components/HourGlass";

type FlowRegulationPanelProps = { embedded?: boolean };

export default function FlowRegulationPanel({ embedded = false }: FlowRegulationPanelProps) {
  const {
    t,
    flights,
    // Flow view state/actions for coloring + map filtering
    setFlowCommunities,
    setFlowViewEnabled,
    setFlowError,
    flowColorByCommunity,
    setFlowPreviewGroupId,
    setFlowPreviewFlightId
  } = useSimStore();
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ChipOption[]>([]);
  const [selectedTVs, setSelectedTVs] = useState<string[]>([]);
  const [fromTime, setFromTime] = useState<string>(secToHHMM(t));
  const [toTime, setToTime] = useState<string>(secToHHMM(t + 2 * 3600));
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [flowResults, setFlowResults] = useState<FlowsResponse | null>(null);
  const [openAddMenuFor, setOpenAddMenuFor] = useState<string | null>(null);
  // Flow extraction params
  const [threshold, setThreshold] = useState<number>(0.1);
  const [resolution, setResolution] = useState<number>(1.0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fc = await loadSectors("/data/airspace.geojson");
        if (cancelled) return;
        const opts: ChipOption[] = (fc.features || [])
          .map((f: any) => {
            const id = f?.properties?.traffic_volume_id;
            if (!id) return null;
            const minFL = f?.properties?.min_fl;
            const maxFL = f?.properties?.max_fl;
            return {
              id: String(id),
              label: String(id),
              description: (minFL != null && maxFL != null) ? `FL${String(minFL).padStart(3,'0')}-FL${String(maxFL).padStart(3,'0')}` : undefined,
            } as ChipOption;
          })
          .filter(Boolean) as ChipOption[];
        // dedupe and sort
        const seen = new Set<string>();
        const dedup = opts.filter((o) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        }).sort((a, b) => a.id.localeCompare(b.id));
        setOptions(dedup);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load traffic volumes");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Listen for external requests to add a TV and adjust the period
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const detail = (e && e.detail) || {};
        const tv = detail?.trafficVolume != null ? String(detail.trafficVolume) : "";
        const newFrom: number = Number(detail?.from);
        const newTo: number = Number(detail?.to);
        if (!tv || !Number.isFinite(newFrom) || !Number.isFinite(newTo)) return;

        // Add TV to selection (dedup)
        setSelectedTVs((prev) => {
          const s = new Set(prev.map(String));
          s.add(tv);
          return Array.from(s);
        });

        // Adjust regulation period based on intersection rules
        const curFrom = hhmmToSec(fromTime);
        const curTo = hhmmToSec(toTime);
        const nf = Math.max(0, Math.floor(newFrom));
        const nt = Math.max(0, Math.floor(newTo));
        if (nt <= nf) {
          // Fallback to a minimal 1-minute window if invalid
          setFromTime(secToHHMM(nf));
          setToTime(secToHHMM(nf + 60));
          return;
        }
        const intersects = !(nt <= curFrom || nf >= curTo);
        if (intersects) {
          const uFrom = Math.min(curFrom, nf);
          const uTo = Math.max(curTo, nt);
          setFromTime(secToHHMM(uFrom));
          setToTime(secToHHMM(uTo));
        } else {
          setFromTime(secToHHMM(nf));
          setToTime(secToHHMM(nt));
        }
      } catch {
        // ignore malformed events
      }
    };
    window.addEventListener('flow-regulation-add', handler as EventListener);
    return () => window.removeEventListener('flow-regulation-add', handler as EventListener);
  }, [fromTime, toTime]);

  const valid = useMemo(() => {
    const from = hhmmToSec(fromTime);
    const to = hhmmToSec(toTime);
    return to > from;
  }, [fromTime, toTime]);

  // Trigger flow extraction
  const handleExtractFlows = async () => {
    if (selectedTVs.length === 0) {
      setExtractError('Please select at least one traffic volume.');
      return;
    }
    setExtractError(null);
    setExtracting(true);
    setFlowResults(null);
    try {
      const data = await fetchFlows({
        tvs: selectedTVs.join(','),
        from_time_str: hhmmToHHMMSS(fromTime),
        to_time_str: hhmmToHHMMSS(toTime),
        threshold: String(Math.min(10, Math.max(0.1, threshold))),
        resolution: String(Math.min(10, Math.max(0.1, resolution))),
      });
      setFlowResults(data);
      // Build community/group mapping for global store so map can color and filter
      const communities: Record<string, number> = {};
      const groups: Record<string, string[]> = {};
      for (const f of data.flows || []) {
        const fidList = (f.flights || []).map(ff => String(ff.flight_id));
        groups[String(f.flow_id)] = fidList;
        for (const fid of fidList) communities[String(fid)] = Number(f.flow_id);
      }
      setFlowCommunities(communities, groups);
      setFlowViewEnabled(true);
      setFlowError(null);
    } catch (e: any) {
      setExtractError(e?.message || 'Failed to extract flows');
    } finally {
      setExtracting(false);
    }
  };

  // Sort flows by number of flights (desc) for display
  const sortedFlows = useMemo(() => {
    const flows = flowResults?.flows || [];
    return flows.slice().sort((a, b) => ((b.flights?.length || 0) - (a.flights?.length || 0)));
  }, [flowResults]);

  // When TVs are cleared, reset extraction results and disable flow view
  useEffect(() => {
    if (selectedTVs.length === 0) {
      setFlowResults(null);
      setFlowCommunities(null, null);
      setFlowViewEnabled(false);
      setFlowError(null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
    }
  }, [selectedTVs, setFlowCommunities, setFlowViewEnabled, setFlowError]);

  // Clear preview when results are not shown anymore; ensure cleanup on unmount
  useEffect(() => {
    if (!flowResults || !flowResults.flows || flowResults.flows.length === 0) {
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
    }
    return () => { setFlowPreviewGroupId(null); setFlowPreviewFlightId(null); };
  }, [flowResults, setFlowPreviewGroupId]);

  if (!open) return null;

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "absolute top-20 right-4 z-50 w-[384px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"}>
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Traffic Flows</div>
          <div className="text-lg font-semibold">Select and Extract</div>
        </div>
      </div>

      <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 flex-1 space-y-4"}>
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="font-medium text-sm opacity-90 mb-2">Traffic Volumes</div>
          <MultiSelectWithChips
            options={options}
            selectedIds={selectedTVs}
            onChange={setSelectedTVs}
            placeholder={loading ? "Loading traffic volumes…" : "Select traffic volumes"}
            disabled={loading}
            renderOptionLabel={(opt) => (
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                <span>{opt.label}</span>
              </div>
            )}
          />
          {error && (
            <div className="text-[11px] text-red-200 mt-2">{error}</div>
          )}
          {/* {selectedTVs.length > 0 && (
            <div className="text-[11px] opacity-70 mt-2">Selected: {selectedTVs.join(", ")}</div>
          )} */}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="font-medium text-sm opacity-90 mb-3">Extraction Period</div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <div className="text-[11px] opacity-80 mb-1">From</div>
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.currentTarget.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>
            <div>
              <div className="text-[11px] opacity-80 mb-1">To</div>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.currentTarget.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>
          <div className="text-xs opacity-70 mt-2">
            From {fromTime} to {toTime}
          </div>
          {!valid && (
            <div className="text-[11px] text-red-200 mt-1">End time must be after start time</div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm opacity-90">Flow Extraction</div>
            <button
              onClick={handleExtractFlows}
              disabled={extracting || selectedTVs.length === 0}
              className={`px-3 py-1 rounded-lg border text-xs ${extracting ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
            >
              {extracting ? (
                <ShimmeringText text="Extracting Flows..." />
              ) : (
                'Extract Flows'
              )}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <div className="text-[11px] opacity-80 mb-1">Threshold</div>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.05}
                value={threshold}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (!Number.isFinite(v)) return;
                  setThreshold(Math.min(10, Math.max(0.1, v)));
                }}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
              />
            </div>
            <div>
              <div className="text-[11px] opacity-80 mb-1">Resolution</div>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={resolution}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (!Number.isFinite(v)) return;
                  setResolution(Math.min(10, Math.max(0.1, v)));
                }}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
              />
            </div>
          </div>
          {selectedTVs.length === 0 && (
            <div className="text-[11px] opacity-70">Select at least one traffic volume.</div>
          )}
          {extractError && (
            <div className="text-[11px] text-red-200 mt-1">{extractError}</div>
          )}
        </div>

        {flowResults && flowResults.flows && flowResults.flows.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="font-medium text-sm opacity-90 mb-2">Flow Extraction Results ({(flowResults.flows || []).reduce((sum, f) => sum + ((f.flights || []).length), 0)} flights)</div>
            <div className="text-[11px] opacity-70 mb-2">The extracted flows also include dwelling flights.</div>
            <div className="space-y-3">
              {sortedFlows.map((flow) => {
                const arrivalTimes = (flow.flights || [])
                  .map((fl) => extractTimeFromDateTime(fl.earliest_crossing_time))
                  .filter(Boolean) as string[];
                const fromSec = hhmmToSec(fromTime);
                const toSec = hhmmToSec(toTime);
                const anyInRange = arrivalTimes.some((s) => {
                  const sec = hhmmOrHHMMSSec(s);
                  return sec >= fromSec && sec <= toSec;
                });
                return (
                <div key={flow.flow_id} className="border border-white/10 rounded-md">
                  <div
                    className="flex items-center justify-between px-2 py-1 bg-white/5 rounded-t-md"
                    onMouseEnter={() => setFlowPreviewGroupId(String(flow.flow_id))}
                    onMouseLeave={() => setFlowPreviewGroupId(null)}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className="inline-block w-3 h-3 rounded-sm"
                        style={{ backgroundColor: (flowColorByCommunity && (flowColorByCommunity as any)[String(flow.flow_id)]) || '#9ca3af' }}
                        title={`Flow ${flow.flow_id}`}
                      />
                      <span className="opacity-80">Flow {flow.flow_id}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] opacity-70">
                        {flow.flights?.length || 0} flights{flow.controlled_volume ? ` • TV ${flow.controlled_volume}` : ''}
                      </div>
                      <AddToBasketMenu
                        flowId={String(flow.flow_id)}
                        items={(flow.flights || []).map(fl => ({ key: String(fl.flight_id), requestedBin: fl.requested_bin, earliestCrossing: extractTimeFromDateTime(fl.earliest_crossing_time) }))}
                        tvs={selectedTVs}
                        periodFrom={fromTime}
                        periodTo={toTime}
                        openId={openAddMenuFor}
                        setOpenId={setOpenAddMenuFor}
                      />
                    </div>
                  </div>
                  <div className="px-2 pt-2">
                    <HourGlass
                      data={arrivalTimes}
                      range={anyInRange ? [fromTime, toTime] : undefined}
                      height={12}
                      className="w-full"
                    />
                  </div>
                  <div className="px-2 pb-2">
                    <div className="rounded-lg border border-white/10 overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-white/10">
                            <th className="text-left p-2 font-semibold">CS</th>
                            <th className="text-left p-2 font-semibold">Ori.</th>
                            <th className="text-left p-2 font-semibold">Des.</th>
                            <th className="text-left p-2 font-semibold">Requested Bin</th>
                            <th className="text-left p-2 font-semibold">Earliest Crossing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(flow.flights || []).map((fl, idx) => {
                          const full = flights?.find((ff: any) => String(ff.flightId) === String(fl.flight_id));
                          const callsign = full?.callSign || String(fl.flight_id);
                          const origin = full?.origin || 'N/A';
                          const destination = full?.destination || 'N/A';
                          const earliest = extractTimeFromDateTime(fl.earliest_crossing_time) || 'N/A';
                          return (
                            <tr
                              key={`${flow.flow_id}-${fl.flight_id}`}
                              className={`border-t border-white/10 ${idx % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10 cursor-pointer`}
                              onMouseEnter={() => setFlowPreviewFlightId(String(fl.flight_id))}
                              onMouseLeave={() => setFlowPreviewFlightId(null)}
                            >
                              <td className="p-2 font-mono">{callsign}</td>
                              <td className="p-2">{origin}</td>
                              <td className="p-2">{destination}</td>
                              <td className="p-2 text-right font-mono">{fl.requested_bin}</td>
                              <td className="p-2 text-right font-mono">{earliest}</td>
                            </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );})}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function secToHHMM(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToSec(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (isFinite(h) ? h : 0) * 3600 + (isFinite(m) ? m : 0) * 60;
}

function hhmmToHHMMSS(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  const hh = (h || '00').padStart(2, '0');
  const mm = (m || '00').padStart(2, '0');
  const ss = '00';
  return `${hh}${mm}${ss}`;
}

// Parse "HH:MM" or "HH:MM:SS" to seconds of day
function hhmmOrHHMMSSec(s: string): number {
  const parts = String(s).split(":").map((p) => Number.parseInt(p, 10));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const sec = parts[2] || 0;
  return h * 3600 + m * 60 + sec;
}

// Types for flows API response
type FlowsResponse = {
  num_time_bins: number;
  tvs: string[];
  timebins: number[];
  flows: Array<{
    flow_id: number;
    controlled_volume: string | null;
    demand: number[];
    flights: Array<{
      flight_id: string;
      requested_bin: number;
      earliest_crossing_time: string | null;
    }>;
  }>;
};

async function fetchFlows(params: { tvs: string; from_time_str?: string; to_time_str?: string; threshold?: string; resolution?: string }) {
  const usp = new URLSearchParams();
  usp.set('tvs', params.tvs);
  if (params.from_time_str) usp.set('from_time_str', params.from_time_str);
  if (params.to_time_str) usp.set('to_time_str', params.to_time_str);
  if (params.threshold) usp.set('threshold', params.threshold);
  if (params.resolution) usp.set('resolution', params.resolution);
  const res = await authFetch(`/api/flows?${usp.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return (await res.json()) as FlowsResponse;
}

// Formatters
function extractTimeFromDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  // Accepts formats like "YYYY-MM-DDTHH:MM:SSZ", "YYYY-MM-DD HH:MM:SS", or "HH:MM:SS"
  // Strategy: find the first time-like segment HH:MM or HH:MM:SS
  const m = value.match(/\d{2}:\d{2}(?::\d{2})?/);
  if (m && m[0]) return m[0];
  // Fallback: if value is already HHMMSS without colons
  const compact = value.match(/\b(\d{6})\b/);
  if (compact) {
    const hh = compact[1].slice(0, 2);
    const mm = compact[1].slice(2, 4);
    const ss = compact[1].slice(4, 6);
    return `${hh}:${mm}:${ss}`;
  }
  return value;
}

// Event handler
// (no-op placeholder removed)

function AddToBasketMenu({ flowId, items, tvs, periodFrom, periodTo, openId, setOpenId }: { flowId: string; items: Array<{ key: string; requestedBin?: number; earliestCrossing?: string | null }>; tvs: string[]; periodFrom: string; periodTo: string; openId: string | null; setOpenId: (id: string | null) => void }) {
  const { flowBasket, addFlowBasket, addFlowBasketWithPeriod, addFlightsToBasketFlow, setFlowBasketPeriod, addTargetCells } = useSimStore();
  const isOpen = openId === flowId;
  return (
    <div className="relative inline-block text-[11px]">
      <button
        onClick={(e) => { e.stopPropagation(); setOpenId(isOpen ? null : flowId); }}
        className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/90 hover:bg-white/15 flex items-center gap-1"
        title="Add this flow to Flow Basket"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5"/></svg>
        <span className="hidden sm:inline">Add</span>
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-20" onClick={(e) => e.stopPropagation()}>
          <button
            className="w-full text-left px-3 py-2 hover:bg-white/10"
            onClick={() => {
              if (periodFrom && periodTo) {
                addFlowBasketWithPeriod(
                  `Flow ${flowId}`,
                  items.map(it => ({ key: String(it.key), requestedBin: it.requestedBin, earliestCrossing: it.earliestCrossing })),
                  periodFrom,
                  periodTo
                );
                // Also add selected TVs as Target Cells with this period
                if (Array.isArray(tvs) && tvs.length > 0) {
                  addTargetCells(tvs, periodFrom, periodTo);
                }
              } else {
                addFlowBasket(
                  `Flow ${flowId}`,
                  items.map(it => ({ key: String(it.key), requestedBin: it.requestedBin, earliestCrossing: it.earliestCrossing }))
                );
              }
              setOpenId(null);
            }}
          >Add as New</button>
          <div className="h-px bg-white/10" />
          {flowBasket.length === 0 ? (
            <div className="px-3 py-2 opacity-60">No flows in basket</div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {flowBasket.map((bf) => (
                <button key={bf.id}
                  className="w-full text-left px-3 py-2 hover:bg-white/10"
                  onClick={() => {
                    addFlightsToBasketFlow(bf.id, items.map(it => ({ key: String(it.key), requestedBin: it.requestedBin, earliestCrossing: it.earliestCrossing })));
                    if (periodFrom && periodTo) {
                      setFlowBasketPeriod(bf.id, periodFrom, periodTo, { overwrite: false });
                      // Also add selected TVs as Target Cells with this period
                      if (Array.isArray(tvs) && tvs.length > 0) {
                        addTargetCells(tvs, periodFrom, periodTo);
                      }
                    }
                    setOpenId(null);
                  }}
                >Add to {bf.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
