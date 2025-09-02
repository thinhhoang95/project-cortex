"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSimStore } from "@/components/useSimStore";

export default function FlowPlanPanel() {
  const {
    flights,
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
        <div className="absolute top-16 right-[416px] z-40 w-[340px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col transition-all duration-300">
          <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
            <div>
              <div className="text-[10px] uppercase tracking-wider opacity-70">Active Network</div>
              <div className="text-lg font-semibold">Flow Plan</div>
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

          <div className="overflow-y-auto no-scrollbar p-4 flex-1 space-y-4">
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
                          <span className="text-[10px] opacity-70">{bf.items?.length || 0} flights</span>
                          <button
                            className="p-1 text-white/80 hover:text-red-200"
                            title="Delete flow"
                            onClick={() => { restoreFlowPreview(); removeFlowBasket(bf.id); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5"/></svg>
                          </button>
                        </div>
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
          </div>
        </div>
      )}
    </>
  );
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
