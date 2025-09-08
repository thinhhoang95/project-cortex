"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSimStore } from "@/components/useSimStore";
import HourGlass from "@/components/HourGlass";
import { loadSectors } from "@/lib/airspace";

type FlowPlanPanelProps = { embedded?: boolean };

export default function FlowPlanPanel({ embedded = false }: FlowPlanPanelProps) {
  const {
    flights,
    // Target cells state/actions
    targetCells,
    addTargetCell,
    removeTargetCell,
    flowBasket,
    createEmptyFlowBasket,
    removeFlowBasket,
    addFlightsToBasketFlow,
    removeFlightFromBasketFlow,
    moveFlightBetweenBasketFlows,
    // Hover/preview + map flow view hookup
    setFlowCommunities,
    setFlowViewEnabled,
    setFlowPreviewGroupId,
    setFlowPreviewFlightId,
  } = useSimStore();

  const [isMinimized, setIsMinimized] = useState(false);
  const [newFlowBusy, setNewFlowBusy] = useState(false);
  const [basketView, setBasketView] = useState(false);
  const [autoRippleEnabled, setAutoRippleEnabled] = useState(false);
  const [autoRippleBins, setAutoRippleBins] = useState<number>(2);

  // Target Cells: local search + time prompt state
  const [trafficVolumes, setTrafficVolumes] = useState<any[]>([]);
  const [tvSearchQuery, setTvSearchQuery] = useState("");
  const [tvSearchOpen, setTvSearchOpen] = useState(false);
  const [pendingTV, setPendingTV] = useState<{ id: string; feature: any } | null>(null);
  const [pendingFrom, setPendingFrom] = useState<string>("07:00");
  const [pendingTo, setPendingTo] = useState<string>("08:00");

  // Track original global flow communities/groups so we can restore after hover
  const origCommunitiesRef = useRef<ReturnType<typeof useSimStore.getState>["flowCommunities"] | null>(null);
  const origGroupsRef = useRef<ReturnType<typeof useSimStore.getState>["flowGroups"] | null>(null);
  const origEnabledRef = useRef<boolean | null>(null);
  const origColorsRef = useRef<ReturnType<typeof useSimStore.getState>["flowColorByCommunity"] | null>(null);

  // Separate refs for hover/preview so we don't overwrite basket baseline
  const hoverOrigCommunitiesRef = useRef<ReturnType<typeof useSimStore.getState>["flowCommunities"] | null>(null);
  const hoverOrigGroupsRef = useRef<ReturnType<typeof useSimStore.getState>["flowGroups"] | null>(null);
  const hoverOrigEnabledRef = useRef<boolean | null>(null);
  const hoverOrigColorsRef = useRef<ReturnType<typeof useSimStore.getState>["flowColorByCommunity"] | null>(null);

  // Utilities
  const resolveByKey = (key: string) => {
    // Try as flightId first, then as callsign
    let f = flights.find(ff => String(ff.flightId) === String(key));
    if (f) return f;
    f = flights.find(ff => ff.callSign && String(ff.callSign) === String(key));
    return f || null;
  };

  const restoreFlowPreview = () => {
    setFlowCommunities(hoverOrigCommunitiesRef.current, hoverOrigGroupsRef.current, hoverOrigColorsRef.current || null);
    setFlowViewEnabled(!!hoverOrigEnabledRef.current);
    setFlowPreviewGroupId(null);
    setFlowPreviewFlightId(null);
  };
  const totalFlights = useMemo(() => flowBasket.reduce((sum, f) => sum + (f.items?.length || 0), 0), [flowBasket]);
  const router = useRouter();

  // Build request body for Flow Impact Evaluation
  const buildBaselinePayload = () => {
    // Stable flow ordering by createdAt
    const flowsOrdered = flowBasket.slice().sort((a, b) => a.createdAt - b.createdAt);
    const flows: Record<string, string[]> = {};
    const colorsByFlow: Record<string, string> = {};
    flowsOrdered.forEach((flow, idx) => {
      const items = (flow.items || []).map((it) => {
        const f = resolveByKey(it.key);
        return f?.flightId ? String(f.flightId) : String(it.key);
      }).filter(Boolean);
      flows[String(idx)] = items;
      colorsByFlow[String(idx)] = flow.color;
    });

    // Merge target time windows per TV to [min(from), max(to)]
    const buckets = new Map<string, { min: number; max: number }>();
    for (const cell of targetCells) {
      const tv = String(cell.trafficVolume);
      const fromM = hhmmToMinutes(cell.from);
      const toM = hhmmToMinutes(cell.to);
      if (toM <= fromM) continue; // ignore invalid
      const prev = buckets.get(tv) || { min: fromM, max: toM };
      const next = { min: Math.min(prev.min, fromM), max: Math.max(prev.max, toM) };
      buckets.set(tv, next);
    }
    const targets: Record<string, { from: string; to: string }> = {};
    for (const [tv, r] of buckets.entries()) {
      targets[tv] = { from: minutesToHHMM(r.min), to: minutesToHHMM(r.max) } as any;
    }

    const payload: any = { flows, targets, colorsByFlow };
    if (autoRippleEnabled && Number.isFinite(autoRippleBins) && autoRippleBins > 0) {
      payload.auto_ripple_time_bins = Math.floor(autoRippleBins);
    }
    return payload;
  };

  // Build communities/groups/colors from the current Flow Basket
  const buildBasketFlowMapping = () => {
    const groups: Record<string, string[]> = {};
    const communities: Record<string, number> = {} as any; // using 0 as placeholder, community id will be key string
    const colorMap: Record<string, string> = {};
    for (const bf of flowBasket) {
      const cid = `basket-${bf.id}`; // community id key for this basket flow
      const ids = (bf.items || [])
        .map(it => resolveByKey(it.key)?.flightId)
        .filter(Boolean)
        .map(String) as string[];
      groups[cid] = ids;
      for (const fid of ids) (communities as any)[fid] = cid as any;
      colorMap[cid] = bf.color;
    }
    return { groups, communities: communities as any, colorMap };
  };

  // Toggle the Flow Basket map view
  const applyBasketView = () => {
    // Save original
    const st = useSimStore.getState();
    origCommunitiesRef.current = st.flowCommunities;
    origGroupsRef.current = st.flowGroups;
    origEnabledRef.current = st.flowViewEnabled;
    origColorsRef.current = st.flowColorByCommunity;
    // Apply basket mapping
    const { groups, communities, colorMap } = buildBasketFlowMapping();
    setFlowCommunities(communities, groups, colorMap);
    setFlowViewEnabled(true);
  };
  const clearBasketView = () => {
    setFlowCommunities(origCommunitiesRef.current, origGroupsRef.current, origColorsRef.current || null);
    setFlowViewEnabled(!!origEnabledRef.current);
    setFlowPreviewGroupId(null);
    setFlowPreviewFlightId(null);
    // Reset hover baseline to the restored state to avoid stale hover restoration
    hoverOrigCommunitiesRef.current = origCommunitiesRef.current;
    hoverOrigGroupsRef.current = origGroupsRef.current;
    hoverOrigEnabledRef.current = origEnabledRef.current;
    hoverOrigColorsRef.current = origColorsRef.current;
  };

  // Load traffic volumes once for the search box
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fc = await loadSectors("/data/airspace.geojson");
        if (!cancelled) setTrafficVolumes(fc.features || []);
      } catch (e) {
        // ignore
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Filter TV search results
  const filteredTVs = useMemo(() => {
    const q = tvSearchQuery.trim().toLowerCase();
    if (!q) return [] as Array<{ id: string; feature: any }>;
    const matches = (trafficVolumes || [])
      .map((f: any) => ({ id: String(f?.properties?.traffic_volume_id || ''), feature: f }))
      .filter((o: any) => o.id && o.id.toLowerCase().includes(q))
      .sort((a, b) => a.id.localeCompare(b.id));
    return matches.slice(0, 30);
  }, [tvSearchQuery, trafficVolumes]);

  const handleSelectTV = (tv: { id: string; feature: any }) => {
    setPendingTV(tv);
    // Default 1h window for UX; user can adjust
    setPendingFrom(padHHMM("07:00"));
    setPendingTo(padHHMM("08:00"));
    setTvSearchOpen(false);
  };

  const confirmAddTargetCell = () => {
    if (!pendingTV) return;
    const f = pendingFrom.trim();
    const t = pendingTo.trim();
    if (!isValidTimeRange(f, t)) return; // simple guard
    addTargetCell(pendingTV.id, f, t);
    setPendingTV(null);
    setTvSearchQuery("");
  };

  // Keep mapping in sync if basket changes while view is active
  useEffect(() => {
    if (!basketView) return;
    const { groups, communities, colorMap } = buildBasketFlowMapping();
    setFlowCommunities(communities, groups, colorMap);
    setFlowViewEnabled(true);
  }, [basketView, flowBasket, flights]);

  // Cleanup on unmount if basketView was active
  useEffect(() => {
    return () => { if (basketView) clearBasketView(); };
  }, [basketView]);

  return (
    <>
      {isMinimized ? (
        <button
          onClick={() => setIsMinimized(false)}
          className="fixed z-[200] bottom-4 right-4 w-12 h-12 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow-lg border border-white/20 flex items-center justify-center hover:opacity-90"
          title={`Show Flow Plan (${flowBasket.length})`}
          aria-label="Show Flow Plan"
        >
          <span className="text-sm font-semibold">{flowBasket.length}</span>
        </button>
      ) : (
        <div className={embedded
          ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col transition-all duration-300"
          : "absolute top-16 right-[416px] z-40 w-[340px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col transition-all duration-300"}>
          <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">Regulation Design</div>
              <div className="text-lg font-semibold">Flow Basket</div>
              <div className="text-xs opacity-80">{flowBasket.length} Flow{flowBasket.length !== 1 ? 's' : ''} • {totalFlights} Flight{totalFlights !== 1 ? 's' : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMinimized(true)}
                className="h-7 w-7 flex items-center justify-center rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-colors"
                title="Minimize panel"
                aria-label="Minimize panel"
              >
                –
              </button>
              <button
                onClick={() => {
                  if (!basketView) applyBasketView(); else clearBasketView();
                  setBasketView(v => !v);
                }}
                className={`h-7 w-7 flex items-center justify-center rounded-lg border text-sm transition-colors ${basketView ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' : 'border-white/30 bg-white/20 hover:bg-white/30'}`}
                title={basketView ? 'Hide basket flow lines' : 'Show basket flow lines'}
                aria-label="Toggle basket flow lines"
              >
                {/* Eye icon */}
                {basketView ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a18.86 18.86 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a18.86 18.86 0 01-3.17 4.13M1 1l22 22" stroke="currentColor" strokeWidth="1.5"/></svg>
                )}
              </button>
            </div>
          </div>

          <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 flex-1 space-y-4"}>
            {/* Target Cells */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-sm opacity-90">Target Cells</div>
                <div className="text-[11px] opacity-70">{targetCells.length} selected</div>
              </div>
              <div className="relative mb-3">
                <input
                  type="text"
                  placeholder="Search traffic volumes..."
                  value={tvSearchQuery}
                  onChange={(e) => { setTvSearchQuery(e.currentTarget.value); setTvSearchOpen(true); }}
                  onFocus={() => setTvSearchOpen(true)}
                  onBlur={() => setTimeout(() => setTvSearchOpen(false), 150)}
                  className="w-full px-3 py-2 bg-white/20 border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <svg
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                </svg>
                {tvSearchOpen && filteredTVs.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-slate-900/95 border border-white/20 rounded-lg shadow-lg">
                    {filteredTVs.map((tv) => (
                      <button
                        key={tv.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectTV(tv)}
                        className="w-full text-left px-3 py-2 text-[12px] hover:bg-white/10"
                        title={`Add ${tv.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                          <span>{tv.id}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {pendingTV && (
                <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="text-[12px] opacity-80 mb-2">Select time period for {pendingTV.id}</div>
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <div className="text-[11px] opacity-80 mb-1">From</div>
                      <input
                        type="time"
                        value={pendingFrom}
                        onChange={(e) => setPendingFrom(padHHMM(e.currentTarget.value))}
                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                        style={{ colorScheme: "dark" }}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] opacity-80 mb-1">To</div>
                      <input
                        type="time"
                        value={pendingTo}
                        onChange={(e) => setPendingTo(padHHMM(e.currentTarget.value))}
                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white"
                        style={{ colorScheme: "dark" }}
                      />
                    </div>
                  </div>
                  {!isValidTimeRange(pendingFrom, pendingTo) && (
                    <div className="text-[11px] text-red-200 mt-2">End time must be after start time</div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={confirmAddTargetCell}
                      disabled={!isValidTimeRange(pendingFrom, pendingTo)}
                      className="px-3 py-1 rounded-md bg-white/10 border border-white/20 text-white/90 hover:bg-white/15 text-[12px]"
                    >Add Cell</button>
                    <button
                      onClick={() => setPendingTV(null)}
                      className="px-3 py-1 rounded-md bg-white/0 border border-white/20 text-white/70 hover:bg-white/10 text-[12px]"
                    >Cancel</button>
                  </div>
                </div>
              )}

              {targetCells.length === 0 ? (
                <div className="text-[12px] opacity-70">No target cells yet. Search a traffic volume to add one.</div>
              ) : (
                <div className="space-y-2">
                  {targetCells.sort((a, b) => a.trafficVolume.localeCompare(b.trafficVolume)).map((cell) => (
                    <div key={cell.id} className="flex items-center justify-between px-2 py-1 bg-white/5 border border-white/10 rounded-md">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                        <span className="font-mono font-medium">{cell.trafficVolume}</span>
                        <span className="opacity-70">{cell.from}–{cell.to}</span>
                      </div>
                      <button
                        className="p-1 text-white/70 hover:text-red-200"
                        title="Remove cell"
                        onClick={() => removeTargetCell(cell.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6v12m8-12v12M5 6l1 14h12l1-14M9 3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New Flow Button */}
            <div className="flex items-center justify-between">
              <div className="text-sm opacity-80">Manage flows to regulate</div>
              <button
                onClick={() => {
                  if (newFlowBusy) return; setNewFlowBusy(true);
                  try { createEmptyFlowBasket(); } finally { setNewFlowBusy(false); }
                }}
                className="px-2 py-1 rounded-lg bg-white/10 border border-white/20 text-white shadow hover:bg-white/15 flex items-center gap-1 text-xs"
                title="Create new empty flow"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5"/></svg>
                New flow
              </button>
            </div>

            {/* Flow Basket */}
            {flowBasket.length === 0 ? (
              <div className="text-xs opacity-70 text-center py-6">No flows in basket yet. Use the Flow panel to add one or create a new empty flow.</div>
            ) : (
              <div className="space-y-3">
                {flowBasket.map((bf) => {
                  const tempGroupId = `basket-${bf.id}`;
                  const handleFlowMouseEnter = () => {
                    // Save original (hover baseline)
                    const st = useSimStore.getState();
                    hoverOrigCommunitiesRef.current = st.flowCommunities;
                    hoverOrigGroupsRef.current = st.flowGroups;
                    hoverOrigEnabledRef.current = st.flowViewEnabled;
                    hoverOrigColorsRef.current = st.flowColorByCommunity;
                    // Build temp mapping for this basket flow
                    const ids = (bf.items || [])
                      .map(it => resolveByKey(it.key)?.flightId)
                      .filter(Boolean)
                      .map(String) as string[];
                    const groups: Record<string, string[]> = { [tempGroupId]: ids };
                    const communities: Record<string, number> = {};
                    for (const fid of ids) communities[fid] = 0; // all in one group
                    setFlowCommunities(communities, groups, { [tempGroupId]: bf.color });
                    setFlowViewEnabled(true);
                    setFlowPreviewGroupId(tempGroupId);
                  };
                  const handleFlowMouseLeave = () => {
                    restoreFlowPreview();
                  };
                  return (
                    <div key={bf.id} className="border border-white/10 rounded-md">
                      <div
                        className="flex items-center justify-between px-2 py-1 bg-white/5 rounded-t-md"
                        onMouseEnter={handleFlowMouseEnter}
                        onMouseLeave={handleFlowMouseLeave}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: bf.color }} title={bf.name} />
                          <span className="opacity-90 font-medium truncate" title={bf.name}>{bf.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] opacity-70">{bf.items?.length || 0} flights{bf.periodFrom && bf.periodTo ? ` • Period ${bf.periodFrom}–${bf.periodTo}` : ''}</span>
                          <button
                            className="p-1 text-white/80 hover:text-red-200"
                            title="Delete flow"
                            onClick={() => { restoreFlowPreview(); removeFlowBasket(bf.id); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                          </button>
                        </div>
                      </div>
                      <div className="px-2 pt-2">
                        <HourGlass
                          data={(bf.items || []).map(it => it.earliestCrossing).filter(Boolean) as string[]}
                          range={bf.periodFrom && bf.periodTo ? [String(bf.periodFrom), String(bf.periodTo)] : undefined}
                          height={12}
                          className="w-full"
                        />
                      </div>
                      <div className="px-2 pb-2">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-blue-900 text-white">
                              <th className="text-left p-2 font-semibold">Callsign</th>
                              <th className="text-left p-2 font-semibold">Origin</th>
                              <th className="text-left p-2 font-semibold">Destination</th>
                              <th className="text-left p-2 font-semibold">Requested Bin</th>
                              <th className="text-left p-2 font-semibold">Earliest Crossing</th>
                              <th className="text-left p-2 font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(bf.items || []).map((it) => {
                              const key = it.key;
                              const f = resolveByKey(key);
                              const callsign = f?.callSign || key;
                              const origin = f?.origin || '—';
                              const destination = f?.destination || '—';
                              return (
                                <tr
                                  key={`${bf.id}-${key}`}
                                  className="border-b border-white/10 hover:bg-white/10"
                                  onMouseEnter={() => { if (f?.flightId) setFlowPreviewFlightId(String(f.flightId)); }}
                                  onMouseLeave={() => setFlowPreviewFlightId(null)}
                                >
                                  <td className="p-2 font-mono">{callsign}</td>
                                  <td className="p-2">{origin}</td>
                                  <td className="p-2">{destination}</td>
                                  <td className="p-2">{it.requestedBin != null ? String(it.requestedBin) : '—'}</td>
                                  <td className="p-2">{it.earliestCrossing != null ? String(it.earliestCrossing) : '—'}</td>
                                  <td className="p-2">
                                    <div className="flex items-center gap-2">
                                      {/* Move */}
                                      <MoveFlightMenu
                                        flows={flowBasket}
                                        currentFlowId={bf.id}
                                        onMove={(toId) => moveFlightBetweenBasketFlows(bf.id, toId, key)}
                                      />
                                      {/* Delete */}
                                      <button
                                        className="p-1 text-white/70 hover:text-red-200"
                                        title="Remove from this flow"
                                        onClick={() => removeFlightFromBasketFlow(bf.id, key)}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6v12m8-12v12M5 6l1 14h12l1-14M9 3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                            {/* New row */}
                            <NewFlightRow
                              onAdd={(token) => {
                                const trimmed = String(token || '').trim();
                                if (!trimmed) return;
                                addFlightsToBasketFlow(bf.id, [trimmed]);
                              }}
                            />
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Auto Ripples */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2 text-[12px] opacity-90">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoRippleEnabled}
                  onClick={() => setAutoRippleEnabled((v) => !v)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAutoRippleEnabled((v) => !v); } }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ${autoRippleEnabled ? 'bg-emerald-500/60 border-emerald-400/50' : 'bg-white/20 border-white/30'}`}
                  aria-label="Toggle Auto Ripples"
                >
                  <span className="sr-only">Auto Ripples</span>
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoRippleEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
                <span>Auto Ripples</span>
              </div>
              {autoRippleEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] opacity-80">Shoulder Time Bins</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={autoRippleBins}
                    onChange={(e) => {
                      const n = Math.floor(Number(e.currentTarget.value) || 0);
                      setAutoRippleBins(n < 1 ? 1 : n);
                    }}
                    className="w-16 px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white text-[12px] focus:outline-none"
                    style={{ colorScheme: "dark" }}
                    title="Number of time bins to dilate ripple windows by"
                  />
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-center pt-2">
              <button
                onClick={() => {
                  try {
                    const payload = buildBaselinePayload();
                    const b64 = encodePayloadParam(payload);
                    const params = new URLSearchParams();
                    params.set('payload', b64);
                    params.set('autostart', '1');
                    window.open(`/flow-evaluation?${params.toString()}`, '_blank');
                  } catch (e) {
                    alert('Failed to build payload');
                  }
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium shadow flex items-center gap-2 text-sm hover:opacity-90"
                title="Open Flow Impact Evaluation"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z" fill="currentColor"/>
                </svg>
                Preview Baseline
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Helpers
function padHHMM(v: string): string {
  const [h, m] = String(v || '').split(':');
  const hh = String((h || '00')).padStart(2, '0');
  const mm = String((m || '00')).padStart(2, '0');
  return `${hh}:${mm}`;
}
function isValidTimeRange(from: string, to: string): boolean {
  const [fh, fm] = (from || '00:00').split(':').map(n => Number(n) || 0);
  const [th, tm] = (to || '00:00').split(':').map(n => Number(n) || 0);
  const fs = fh*3600 + fm*60;
  const ts = th*3600 + tm*60;
  return ts > fs;
}

function NewFlightRow({ onAdd }: { onAdd: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <tr className="bg-white/5">
      <td className="p-2" colSpan={4}>
        <input
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          placeholder="Enter callsign or flight identifier"
          className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded-md text-white text-[11px] focus:outline-none"
        />
      </td>
      <td className="p-2 text-right" colSpan={1}></td>
      <td className="p-2 text-right">
        <button
          onClick={() => { const v = value.trim(); if (!v) return; onAdd(v); setValue(""); }}
          className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white text-[11px] hover:bg-white/15"
          title="Add to flow"
        >Add</button>
      </td>
    </tr>
  );
}

function MoveFlightMenu({ flows, currentFlowId, onMove }: { flows: Array<{ id: string; name: string }>; currentFlowId: string; onMove: (toId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        className="p-1 text-white/70 hover:text-white"
        title="Move to another flow"
        onClick={() => setOpen((o) => !o)}
      >
        {/* Move icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" stroke="currentColor" strokeWidth="1.5"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-10">
          {flows.filter(f => f.id !== currentFlowId).length === 0 ? (
            <div className="px-3 py-2 text-[11px] opacity-70">No other flows</div>
          ) : flows.filter(f => f.id !== currentFlowId).map(f => (
            <button key={f.id}
              className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/10"
              onClick={() => { onMove(f.id); setOpen(false); }}
            >{f.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Local helpers for building baseline payload and URL encoding
function hhmmToMinutes(v: string): number {
  const [h, m] = String(v || '00:00').split(':').map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, Math.min(1439, hh*60 + mm));
}

function encodePayloadParam(obj: any): string {
  const json = JSON.stringify(obj);
  if (typeof window === 'undefined') {
    // Next.js server-side safety
    // @ts-ignore
    const b = Buffer.from(json, 'utf-8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  const b64 = btoa(json);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function minutesToHHMM(mins: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(mins)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
