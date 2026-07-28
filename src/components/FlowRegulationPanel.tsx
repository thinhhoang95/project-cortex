"use client";
import { Layers, Menu, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import { loadSectors } from "@/lib/airspace";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { authFetch } from "@/lib/auth";
import { useSimStore } from "@/components/useSimStore";
import ShimmeringText from "@/components/ShimmeringText";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import FlightQueryDialog from "@/components/FlightQueryDialog";
import TrafficOverloadBar, { type TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import MostVulnerableTvList, { type MostVulnerableTvItem } from "@/components/MostVulnerableTvList";
import VpfDefiningVolumes from "@/components/VpfDefiningVolumes";
import { useDocumentTheme } from "@/components/useDocumentTheme";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatCrossingFlightLevelRange } from "@/lib/trafficVolumeFormat";
import { getDerivedCapacityRangeForTvAsync } from "@/lib/tvCapacityRanges";
import type { FlowBasketItem } from "@/components/useSimStore";
import {
  buildFlowGroupMetadata,
  deriveMembershipsFromGroups,
  derivePrimaryCommunitiesFromMemberships,
  timeWindowDisplayLabel,
  volumeDisplayLabel,
  type FlowGroupMetadata,
  type VpfFlowMetadata,
  type VpfTopLevelMetadata,
} from "@/lib/flowExtractor";

type FlowRegulationPanelProps = { embedded?: boolean };

type FlowReviewContext = {
  targetFlowId?: string;
  targetLabel: string;
  items: FlowBasketItem[];
  periodFrom?: string | null;
  periodTo?: string | null;
  tvs: string[];
  sourceTrafficVolumeId?: string | null;
  trafficReviewDetailsByFlightId?: Record<string, {
    flightLevelRangeLabel?: string | null;
    dwellSeconds?: number | null;
    selectedTvId?: string | null;
  }>;
};

type FlowHeuristicsDiagnostics = {
  v_tilde?: number | null;
  Slack_G15?: number | null;
  Slack_G30?: number | null;
  pressure_benefit?: number | null;
  flight_cost?: number | null;
  slack15_fragility?: number | null;
  rho_risk?: number | null;
  intervention_cost?: number | null;
  after_reg_fragility_cost?: number | null;
  before_reg_fragility_cost?: number | null;
  NomRel?: number | null;
  "NomRel/Flight"?: number | null;
  InLoad?: number | null;
  "InLoad/Flight"?: number | null;
  num_flights?: number | null;
  MVTV15?: MostVulnerableTvItem[] | null;
  MVTV30?: MostVulnerableTvItem[] | null;
  [key: string]: unknown;
};

export default function FlowRegulationPanel({ embedded = false }: FlowRegulationPanelProps) {
  const shimmerTheme = useDocumentTheme();
  const {
    t,
    flights,
    // Flow view state/actions for coloring + map filtering
    setFlowCommunities,
    setFlowViewEnabled,
    setFlowError,
    flowColorByCommunity,
    flowMinFlights,
    flowMaxFlows,
    setFlowMinFlights,
    setFlowMaxFlows,
    setFlowPreviewGroupId,
    setFlowPreviewFlightId,
    resetProposalState,
    flowBasket,
    addFlowBasket,
    addFlowBasketWithPeriod,
    addFlightsToBasketFlow,
    setFlowBasketPeriod,
    addTargetCells,
    resourceDate,
    resourceStateEpoch,
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
  const [expandedFlightLists, setExpandedFlightLists] = useState<Record<string, boolean>>({});
  const [openAddMenuFor, setOpenAddMenuFor] = useState<string | null>(null);
  const [reviewContext, setReviewContext] = useState<FlowReviewContext | null>(null);
  const [selectedTvRanges, setSelectedTvRanges] = useState<Array<{ tvId: string; label: string }>>([]);
  const [selectedTvRangeLoading, setSelectedTvRangeLoading] = useState(false);
  const [basketError, setBasketError] = useState<string | null>(null);

  useEffect(() => {
    setExtracting(false);
    setExtractError(null);
    setFlowResults(null);
    setExpandedFlightLists({});
    setOpenAddMenuFor(null);
    setReviewContext(null);
    setBasketError(null);
  }, [resourceStateEpoch]);

  useEffect(() => {
    if (!resourceDate) return;

    const resourcePaths = getResourcePathsForDate(resourceDate);
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fc = await loadSectors(resourcePaths.airspaceGeojson);
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
              description: (minFL != null && maxFL != null) ? `FL${String(minFL).padStart(3, '0')}-FL${String(maxFL).padStart(3, '0')}` : undefined,
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
  }, [resourceDate]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTVs.length) {
      setSelectedTvRanges([]);
      setSelectedTvRangeLoading(false);
      return;
    }
    setSelectedTvRangeLoading(true);
    Promise.all(
      selectedTVs.map(async (tvId) => ({
        tvId,
        label: await getDerivedCapacityRangeForTvAsync(tvId),
      })),
    )
      .then((items) => {
        if (cancelled) return;
        setSelectedTvRanges(
          items
            .filter((item): item is { tvId: string; label: string } => typeof item.label === "string" && item.label.length > 0),
        );
        setSelectedTvRangeLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedTvRanges([]);
          setSelectedTvRangeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTVs]);

  // Listen for external requests to add a TV and adjust the period
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const detail = (e && e.detail) || {};
        const incomingTrafficVolumes = Array.isArray(detail?.trafficVolumes)
          ? detail.trafficVolumes.map((tv: unknown) => String(tv ?? "").trim()).filter(Boolean)
          : [];
        const legacyTv = detail?.trafficVolume != null ? String(detail.trafficVolume).trim() : "";
        const trafficVolumes = incomingTrafficVolumes.length > 0
          ? incomingTrafficVolumes
          : (legacyTv ? [legacyTv] : []);
        const newFrom: number = Number(detail?.from);
        const newTo: number = Number(detail?.to);
        if (trafficVolumes.length === 0 || !Number.isFinite(newFrom) || !Number.isFinite(newTo)) return;

        // Add TVs to selection (dedup) while preserving current order, then incoming order
        setSelectedTVs((prev) => {
          const s = new Set(prev.map(String));
          for (const tv of trafficVolumes) s.add(tv);
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
    if (selectedTVs.length !== 1) {
      setExtractError('VPF extraction requires exactly one primary traffic volume.');
      return;
    }
    if (!valid) {
      setExtractError('Invalid extraction period: end time must be after start time.');
      return;
    }
    const fromTimeStr = hhmmToHHMMSS(fromTime);
    const toTimeStr = hhmmToHHMMSS(toTime);
    if (!fromTimeStr || !toTimeStr) {
      setExtractError('Invalid extraction period format.');
      return;
    }
    setExtractError(null);
    setExtracting(true);
    setFlowResults(null);
    setExpandedFlightLists({});
    try {
      const finalData = await fetchFlows({
        tvs: selectedTVs[0],
        from_time_str: fromTimeStr,
        to_time_str: toTimeStr,
        min_flights: String(flowMinFlights),
        vpf_max_flows: flowMaxFlows != null ? String(flowMaxFlows) : undefined,
      });
      setFlowResults(finalData);
      const groups: Record<string, string[]> = finalData.groups ? { ...finalData.groups } : {};
      const groupMetadata: Record<string, FlowGroupMetadata> = {};
      for (const f of finalData.flows || []) {
        const fidList = (f.flights || []).map(ff => String(ff.flight_id));
        groups[String(f.flow_id)] = groups[String(f.flow_id)] || fidList;
        groupMetadata[String(f.flow_id)] = buildFlowGroupMetadata(f.extractor_metadata, finalData.extractor_metadata);
      }
      if (Object.keys(groups).length > 0) {
        const memberships = finalData.memberships ?? deriveMembershipsFromGroups(groups);
        const communities = finalData.communities ?? derivePrimaryCommunitiesFromMemberships(memberships);
        setFlowCommunities(communities, groups, undefined, memberships, groupMetadata, finalData.extractor_metadata ?? null);
        setFlowViewEnabled(true);
        setFlowError(null);
      } else {
        setFlowCommunities(null, null);
        setFlowPreviewGroupId(null);
        setFlowPreviewFlightId(null);
        const reason = String(finalData.extractor_metadata?.reason ?? "").trim();
        setExtractError(reason === "no_primary_flights"
          ? "No primary flights found in the selected VPF window."
          : reason === "empty_primary_window"
            ? "Choose a non-empty time window for VPF extraction."
            : "Flow extraction returned no candidate groups.");
      }
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

  const minutesPerBin = useMemo(() => {
    if (flowResults?.num_time_bins && Number.isFinite(flowResults.num_time_bins) && flowResults.num_time_bins > 0) {
      return 1440 / flowResults.num_time_bins;
    }
    return 15;
  }, [flowResults?.num_time_bins]);

  const flowOverloadSegments = useMemo(() => {
    if (!flowResults) return new Map<number, TrafficOverloadDatum[]>();

    const map = new Map<number, TrafficOverloadDatum[]>();
    const windowStart = hhmmToSec(fromTime);
    const windowEnd = hhmmToSec(toTime);

    const clampMinutes = (value: number) => {
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(1440, value));
    };

    const formatMinutesToLabel = (value: number) => {
      const clamped = clampMinutes(Math.round(value));
      const hours = Math.floor(clamped / 60);
      const minutes = clamped % 60;
      if (hours === 24 && minutes > 0) {
        return "24:00";
      }
      return `${String(Math.min(hours, 24)).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    };

    for (const flow of flowResults.flows || []) {
      const numericDemand = Array.isArray(flow.demand)
        ? flow.demand.map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0))
        : [];

      if (!numericDemand.length) {
        map.set(flow.flow_id, []);
        continue;
      }

      const peak = numericDemand.reduce((max, value) => Math.max(max, value), 0);

      const segments = numericDemand.reduce((acc: TrafficOverloadDatum[], demand, index) => {
        const startMinutes = index * minutesPerBin;
        const endMinutes = startMinutes + minutesPerBin;
        const startSeconds = Math.round(startMinutes * 60);
        const endSeconds = Math.round(endMinutes * 60);
        const intersectsWindow = endSeconds > windowStart && startSeconds < windowEnd;
        if (!intersectsWindow) return acc;

        const period = `${formatMinutesToLabel(startMinutes)}-${formatMinutesToLabel(endMinutes)}`;
        const ratio = peak > 0 ? demand / peak : 0;
        const color = ratio >= 0.85
          ? "#b91c1c"
          : ratio >= 0.7
            ? "#f97316"
            : ratio >= 0.5
              ? "#fb923c"
              : "#34d399";

        const metadata: string[] = [`Demand: ${Math.round(demand)}`];
        if (peak > 0) {
          const share = Math.max(0, Math.min(1, demand / peak));
          metadata.push(`Peak share: ${(share * 100).toFixed(0)}%`);
        }

        acc.push({
          period,
          color,
          metadata,
          label: flow.controlled_volume ? `${flow.controlled_volume} load` : `Flow ${flow.flow_id} load`,
        });
        return acc;
      }, [] as TrafficOverloadDatum[]);

      map.set(flow.flow_id, segments);
    }

    return map;
  }, [flowResults, minutesPerBin, fromTime, toTime]);

  const primaryContextLabel = useMemo(() => {
    if (!flowResults?.extractor_metadata) return null;
    const primary = volumeDisplayLabel(flowResults.extractor_metadata.primary_volume, flowResults.extractor_metadata.primary_tv);
    const window = timeWindowDisplayLabel(flowResults.extractor_metadata.primary_time_window);
    if (primary && window) return `${primary}, ${window}`;
    return primary || window;
  }, [flowResults]);

  const selectedTvRangeById = useMemo(() => {
    return new Map(selectedTvRanges.map((item) => [item.tvId, item.label]));
  }, [selectedTvRanges]);
  const selectedVolumeContextLoading = selectedTvRangeLoading || extracting;

  const reviewFlightIds = useMemo(() => {
    if (!reviewContext) return [] as string[];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of reviewContext.items) {
      const key = String(item.key);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(key);
    }
    return ids;
  }, [reviewContext]);

  const reviewLabels = useMemo(() => {
    if (!reviewContext) return { highlight: undefined as string | undefined, baseline: undefined as string | undefined };
    const label = reviewContext.targetLabel;
    const highlight = reviewContext.targetFlowId ? `Add to ${label}` : `Create ${label}`;
    return { highlight, baseline: label };
  }, [reviewContext]);

  const handleReviewRequest = useCallback((context: FlowReviewContext) => {
    setReviewContext(context);
  }, []);

  const handleReviewSelection = useCallback((selectedIds: string[]) => {
    if (!reviewContext) return;
    const selectedSet = new Set((selectedIds || []).map((id) => String(id)));
    const selectedItems = reviewContext.items.filter((item) => selectedSet.has(String(item.key)));
    if (selectedItems.length === 0) {
      setReviewContext(null);
      return;
    }
    try {
      if (reviewContext.targetFlowId) {
        addFlightsToBasketFlow(reviewContext.targetFlowId, selectedItems);
        if (reviewContext.periodFrom && reviewContext.periodTo) {
          setFlowBasketPeriod(reviewContext.targetFlowId, reviewContext.periodFrom, reviewContext.periodTo, { overwrite: false });
          if (reviewContext.tvs.length > 0) {
            addTargetCells(reviewContext.tvs, reviewContext.periodFrom, reviewContext.periodTo);
          }
        }
      } else {
        if (reviewContext.periodFrom && reviewContext.periodTo) {
          addFlowBasketWithPeriod(reviewContext.targetLabel, selectedItems, reviewContext.periodFrom, reviewContext.periodTo);
          if (reviewContext.tvs.length > 0) {
            addTargetCells(reviewContext.tvs, reviewContext.periodFrom, reviewContext.periodTo);
          }
        } else {
          addFlowBasket(reviewContext.targetLabel, selectedItems);
        }
      }
      setBasketError(null);
      setReviewContext(null);
    } catch (err) {
      setBasketError(err instanceof Error ? err.message : "Failed to add flights to the basket.");
    }
  }, [reviewContext, addFlightsToBasketFlow, setFlowBasketPeriod, addTargetCells, addFlowBasketWithPeriod, addFlowBasket]);

  const handleCloseReview = useCallback(() => {
    setReviewContext(null);
  }, []);

  // When TVs are cleared, reset extraction results and disable flow view
  useEffect(() => {
    if (selectedTVs.length === 0) {
      setFlowResults(null);
      setExpandedFlightLists({});
      setFlowCommunities(null, null);
      setFlowViewEnabled(false);
      setFlowError(null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
      resetProposalState();
    }
  }, [selectedTVs, setFlowCommunities, setFlowViewEnabled, setFlowError, setFlowPreviewGroupId, setFlowPreviewFlightId, resetProposalState]);


  useEffect(() => {
    if (!open) {
      resetProposalState();
    }
  }, [open, resetProposalState]);

  // Clear preview when results are not shown anymore; ensure cleanup on unmount
  useEffect(() => {
    if (!flowResults || !flowResults.flows || flowResults.flows.length === 0) {
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
    }
    return () => { setFlowPreviewGroupId(null); setFlowPreviewFlightId(null); };
  }, [flowResults, setFlowPreviewGroupId, setFlowPreviewFlightId]);

  if (!open) return null;

  return (
    <div 
      className={embedded
        ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md will-change-transform shadow-xl text-slate-900 text-white flex flex-col"
        : "absolute top-20 right-4 z-50 w-[384px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"}
    >
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
          {basketError && (
            <div className="text-[11px] text-red-200 mt-2">{basketError}</div>
          )}
          {selectedTVs.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-[11px] opacity-80 mb-1">Selected capacity ranges</div>
              <div className="space-y-1">
                {selectedTVs.map((tvId) => {
                  const rangeLabel = selectedTvRangeById.get(tvId);
                  return (
                    <div key={tvId} className="text-[11px] opacity-80">
                      {selectedVolumeContextLoading ? (
                        <ShimmeringText
                          text={tvId}
                          className="font-mono font-normal"
                          theme={shimmerTheme}
                        />
                      ) : (
                        <span className="font-mono">{tvId}</span>
                      )}
                      : {rangeLabel ?? (selectedTvRangeLoading ? "Loading..." : "Unavailable")}
                    </div>
                  );
                })}
              </div>
            </div>
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
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white [color-scheme:dark]"
              />
            </div>
            <div>
              <div className="text-[11px] opacity-80 mb-1">To</div>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.currentTarget.value)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none text-white [color-scheme:dark]"
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
              disabled={extracting || selectedTVs.length !== 1 || !valid}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs ${extracting ? 'border-blue-400/50 bg-blue-500/20 text-blue-200' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
            >
              {extracting ? null : (
                <Layers width="14" height="14" strokeWidth="2" />
              )}
              {extracting ? (
                <ShimmeringText text="Extracting Flows..." />
              ) : (
                'Extract Flows'
              )}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <div className="text-[11px] opacity-80 mb-1">Min Flights</div>
              <input
                type="number"
                min={1}
                step={1}
                value={flowMinFlights}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (!Number.isFinite(v)) return;
                  setFlowMinFlights(v);
                }}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
              />
            </div>
            <div>
              <div className="text-[11px] opacity-80 mb-1">Max Groups</div>
              <input
                type="number"
                min={1}
                step={1}
                value={flowMaxFlows ?? ""}
                placeholder="No cap"
                onChange={(e) => {
                  setFlowMaxFlows(e.currentTarget.value === "" ? null : Number(e.currentTarget.value));
                }}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
              />
            </div>
          </div>
          {selectedTVs.length !== 1 && (
            <div className="text-[11px] opacity-70">Select exactly one primary traffic volume.</div>
          )}
          {extractError && (
            <div className="text-[11px] text-red-200 mt-1">{extractError}</div>
          )}
        </div>

        {flowResults && flowResults.flows && flowResults.flows.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="font-medium text-sm opacity-90 mb-2">Flow Extraction Results ({(flowResults.flows || []).reduce((sum, f) => sum + ((f.flights || []).length), 0)} flights)</div>
            {primaryContextLabel && (
              <div className="text-[11px] opacity-70 mb-2">Primary: {primaryContextLabel}</div>
            )}
            <div className="text-[11px] opacity-70 mb-2">The extracted flows also include dwelling flights.</div>
            <div className="space-y-3">
              {sortedFlows.map((flow) => {
                const flowId = String(flow.flow_id);
                const arrivalTimes = (flow.flights || [])
                  .map((fl) => extractTimeFromDateTime(fl.earliest_crossing_time))
                  .filter(Boolean) as string[];
                const statsFlightIds = (flow.flights || []).map((fl) => String(fl.flight_id)).filter(Boolean);
                const diagnostics: FlowHeuristicsDiagnostics | null | undefined = flow.heuristics?.diagnostics;
                const metadata = buildFlowGroupMetadata(flow.extractor_metadata, flowResults.extractor_metadata);
                const flowFlightCount = typeof diagnostics?.num_flights === "number"
                  ? diagnostics.num_flights
                  : (flow.flights?.length || 0);
                const flightListOpen = expandedFlightLists[flowId] ?? false;
                const fromSec = hhmmToSec(fromTime);
                const toSec = hhmmToSec(toTime);
                const anyInRange = arrivalTimes.some((s) => {
                  const sec = hhmmOrHHMMSSec(s);
                  return sec >= fromSec && sec <= toSec;
                });
                return (
                  <div
                    key={flow.flow_id}
                    className="border border-white/10 rounded-md"
                    onMouseEnter={() => {
                      setFlowPreviewGroupId(flowId);
                    }}
                    onMouseLeave={() => {
                      setFlowPreviewGroupId(null);
                      setFlowPreviewFlightId(null);
                    }}
                  >
                    <div className="flex items-center justify-between px-2 py-1 bg-white/5 rounded-t-md">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{ backgroundColor: (flowColorByCommunity && (flowColorByCommunity as any)[flowId]) || '#9ca3af' }}
                          title={`Flow ${flow.flow_id}`}
                        />
                        <span className="opacity-80">Flow {flow.flow_id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] opacity-70">
                          {flow.flights?.length || 0} flights{flow.controlled_volume ? ` • TV ${flow.controlled_volume}` : ''}
                        </div>
                        <FlightStatisticsButton
                          flightIds={statsFlightIds}
                          sourceTrafficVolumeId={flow.controlled_volume}
                          buttonClassName="border-white/20 text-white/80"
                          ariaLabel={`Open flight statistics for flow ${flow.flow_id}`}
                          title="Open flight statistics"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedFlightLists((prev) => ({ ...prev, [flowId]: !(prev[flowId] ?? false) }));
                          }}
                          type="button"
                          aria-label={flightListOpen ? "Hide flight list" : "Show flight list"}
                          title={flightListOpen ? "Hide flight list" : "Show flight list"}
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${flightListOpen
                            ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                            : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                        >
                          <Menu width="12" height="12" />
                        </button>
                        <AddToBasketMenu
                          flowId={flowId}
                          flowLabel={`Flow ${flow.flow_id}`}
                          items={(flow.flights || []).map(fl => ({ key: String(fl.flight_id), requestedBin: fl.requested_bin, earliestCrossing: extractTimeFromDateTime(fl.earliest_crossing_time) }))}
                          trafficReviewDetailsByFlightId={Object.fromEntries(
                            (flow.flights || []).map((fl) => [
                              String(fl.flight_id),
                              {
                                flightLevelRangeLabel: formatCrossingFlightLevelRange(fl.flight_level_range),
                                dwellSeconds: fl.dwell_seconds ?? null,
                                selectedTvId: String(fl.selected_tv_id ?? "").trim() || null,
                              },
                            ]),
                          )}
                          tvs={selectedTVs}
                          periodFrom={fromTime}
                          periodTo={toTime}
                          sourceTrafficVolumeId={flow.controlled_volume}
                          openId={openAddMenuFor}
                          setOpenId={setOpenAddMenuFor}
                          flowBasket={flowBasket}
                          addFlowBasket={addFlowBasket}
                          addFlowBasketWithPeriod={addFlowBasketWithPeriod}
                          addFlightsToBasketFlow={addFlightsToBasketFlow}
                          setFlowBasketPeriod={setFlowBasketPeriod}
                          addTargetCells={addTargetCells}
                          onReviewRequest={handleReviewRequest}
                          onBasketError={setBasketError}
                        />
                      </div>
                    </div>
                    <VpfDefiningVolumes metadata={metadata} />
                    <div className="px-2 pt-2">
                      <HourGlass
                        data={arrivalTimes}
                        range={anyInRange ? [fromTime, toTime] : undefined}
                        height={12}
                        className="w-full"
                      />
                    </div>
                    {(() => {
                      const segments = flowOverloadSegments.get(flow.flow_id) || [];
                      if (!segments.length) return null;
                      return (
                        <div className="px-2 pt-2">
                          <TrafficOverloadBar
                            fromTime={fromTime}
                            toTime={toTime}
                            data={segments}
                            height={16}
                            showTime
                          />
                        </div>
                      );
                    })()}
                    <div className={`grid grid-cols-2 gap-x-6 gap-y-1.5 px-2 pt-2 text-[11px] ${flightListOpen ? "" : "pb-2"}`}>
                      <div className="flex justify-between">
                        <span className="text-white/60">V:</span>
                        <span>{formatHeuristicValue(diagnostics?.v_tilde)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Slack15:</span>
                        <span>{formatHeuristicValue(diagnostics?.Slack_G15)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Slack30:</span>
                        <span>{formatHeuristicValue(diagnostics?.Slack_G30)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Benefit:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "pressure_benefit"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Flight Cost:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "flight_cost", "intervention_cost"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">S15 Fragility:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "slack15_fragility", "after_reg_fragility_cost"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">Rho Risk:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "rho_risk", "before_reg_fragility_cost"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">NomRel:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "NomRel", "v2_nomrel.nomrel"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">NomRel/Flt:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "NomRel/Flight", "v2_nomrel.nomrel_per_flight"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">InLoad:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "InLoad", "v2_inload.inload"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">InLoad/Flt:</span>
                        <span>{formatHeuristicValue(resolveFlowDiagnosticsMetric(diagnostics, "InLoad/Flight", "v2_inload.inload_per_flight"))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">N. Flights:</span>
                        <span>{formatHeuristicValue(flowFlightCount, 0)}</span>
                      </div>
                    </div>
                    <div className={flightListOpen ? "px-2 pt-2" : "px-2 pt-2 pb-2"}>
                      <MostVulnerableTvList
                        mvtv15={Array.isArray(diagnostics?.MVTV15) ? diagnostics.MVTV15 : []}
                        mvtv30={Array.isArray(diagnostics?.MVTV30) ? diagnostics.MVTV30 : []}
                      />
                    </div>
                    {flightListOpen && (
                      <div className="px-2 pb-2 pt-2">
                        <div className="rounded-lg border border-white/10 overflow-x-auto">
                          <table className="w-full min-w-max text-[11px]">
                            <thead>
                              <tr className="bg-white/10">
                                <th className="text-left p-2 font-semibold">CS</th>
                                <th className="text-left p-2 font-semibold">Ori.</th>
                                <th className="text-left p-2 font-semibold">Des.</th>
                                <th className="text-left p-2 font-semibold">Requested Bin</th>
                                <th className="text-left p-2 font-semibold">Earliest Crossing</th>
                                <th className="text-left p-2 font-semibold">FL</th>
                                <th className="text-left p-2 font-semibold">Dwell</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(flow.flights || []).map((fl, idx) => {
                                const full = flights?.find((ff: any) => String(ff.flightId) === String(fl.flight_id));
                                const callsign = full?.callSign || String(fl.flight_id);
                                const origin = full?.origin || 'N/A';
                                const destination = full?.destination || 'N/A';
                                const earliest = extractTimeFromDateTime(fl.earliest_crossing_time) || 'N/A';
                                const flightLevelRangeLabel = formatCrossingFlightLevelRange(fl.flight_level_range);
                                const selectedTvId = String(fl.selected_tv_id ?? "").trim();
                                const controlledVolume = String(flow.controlled_volume ?? "").trim();
                                const showSelectedTvBadge = !!selectedTvId && selectedTvId !== controlledVolume;
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
                                    <td className="p-2 text-right font-mono">
                                      <div className="flex flex-col items-end gap-1">
                                        <span>{flightLevelRangeLabel ?? "–"}</span>
                                        {showSelectedTvBadge && (
                                          <span className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70">
                                            TV {selectedTvId}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-2 text-right font-mono">{formatDwellingTime(fl.dwell_seconds ?? null)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <FlightQueryDialog
        open={!!reviewContext}
        onClose={handleCloseReview}
        flightIds={reviewFlightIds}
        sourceTrafficVolumeId={reviewContext?.sourceTrafficVolumeId ?? null}
        trafficReviewDetailsByFlightId={reviewContext?.trafficReviewDetailsByFlightId}
        onSelectFlights={handleReviewSelection}
        highlightLabel={reviewLabels.highlight}
        baselineLabel={reviewLabels.baseline}
        fullScreen
      />
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

// Parse "HH:MM" or "HH:MM:SS" to seconds of day
function hhmmOrHHMMSSec(s: string): number {
  const parts = String(s).split(":").map((p) => Number.parseInt(p, 10));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const sec = parts[2] || 0;
  return h * 3600 + m * 60 + sec;
}

function formatHeuristicValue(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return value.toFixed(digits);
}

function resolveFlowDiagnosticsMetric(
  diagnostics: FlowHeuristicsDiagnostics | null | undefined,
  ...keys: string[]
): number | null {
  if (!diagnostics) return null;
  for (const key of keys) {
    const value = key.includes(".")
      ? key.split(".").reduce<unknown>((acc, part) => {
          if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[part];
          }
          return undefined;
        }, diagnostics)
      : diagnostics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

// Types for flows API response
type FlowsResponse = {
  extractor?: "vpf";
  is_partition?: boolean;
  num_time_bins: number;
  tvs: string[];
  timebins: number[];
  communities?: Record<string, number>;
  memberships?: Record<string, number[]>;
  groups?: Record<string, string[]>;
  extractor_metadata?: VpfTopLevelMetadata;
  flows: Array<{
    flow_id: number;
    controlled_volume: string | null;
    extractor_metadata?: Partial<VpfFlowMetadata> | null;
    demand: number[];
    heuristics?: {
      diagnostics?: FlowHeuristicsDiagnostics | null;
    } | null;
    flights: Array<{
      flight_id: string;
      requested_bin: number;
      requested_dt?: string | null;
      earliest_crossing_time: string | null;
      selected_tv_id?: string | null;
      selected_crossing?: {
        tvtw_index?: number | null;
        entry_time_s?: number | null;
        exit_time_s?: number | null;
      } | null;
      dwell_seconds?: number | null;
      flight_level_range?: {
        min_fl?: number | null;
        max_fl?: number | null;
        label?: string | null;
        scope?: string | null;
      } | null;
    }>;
  }>;
  heuristics_metadata?: {
    timebins_used?: number[];
    window_source?: string | null;
    hotspot_mode?: string | null;
    errors?: string[];
  } | null;
};

async function fetchFlows(params: {
  tvs: string;
  timebins?: string;
  from_time_str?: string;
  to_time_str?: string;
  min_flights?: string;
  vpf_max_flows?: string;
}) {
  const usp = new URLSearchParams();
  usp.set('tvs', params.tvs);
  if (params.timebins) usp.set('timebins', params.timebins);
  if (params.from_time_str) usp.set('from_time_str', params.from_time_str);
  if (params.to_time_str) usp.set('to_time_str', params.to_time_str);
  if (params.min_flights) usp.set('min_flights', params.min_flights);
  if (params.vpf_max_flows) usp.set('vpf_max_flows', params.vpf_max_flows);
  const res = await authFetch(`/api/flows?${usp.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return (await res.json()) as FlowsResponse;
}

function hhmmToHHMMSS(hhmm: string): string | null {
  const m = String(hhmm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
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

type AddToBasketMenuProps = {
  flowId: string;
  flowLabel: string;
  items: FlowBasketItem[];
  trafficReviewDetailsByFlightId?: Record<string, {
    flightLevelRangeLabel?: string | null;
    dwellSeconds?: number | null;
    selectedTvId?: string | null;
  }>;
  tvs: string[];
  periodFrom: string;
  periodTo: string;
  sourceTrafficVolumeId?: string | null;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  flowBasket: ReturnType<typeof useSimStore.getState>["flowBasket"];
  addFlowBasket: (name: string, items?: Array<string | FlowBasketItem>) => string;
  addFlowBasketWithPeriod: (name: string, items: Array<string | FlowBasketItem>, periodFrom: string, periodTo: string) => string;
  addFlightsToBasketFlow: (id: string, items: Array<string | FlowBasketItem>) => void;
  setFlowBasketPeriod: (id: string, periodFrom: string, periodTo: string, opts?: { overwrite?: boolean }) => void;
  addTargetCells: (tvs: string[], periodFrom: string, periodTo: string) => void;
  onReviewRequest: (context: FlowReviewContext) => void;
  onBasketError: (message: string | null) => void;
};

function AddToBasketMenu({
  flowId,
  flowLabel,
  items,
  trafficReviewDetailsByFlightId,
  tvs,
  periodFrom,
  periodTo,
  sourceTrafficVolumeId,
  openId,
  setOpenId,
  flowBasket,
  addFlowBasket,
  addFlowBasketWithPeriod,
  addFlightsToBasketFlow,
  setFlowBasketPeriod,
  addTargetCells,
  onReviewRequest,
  onBasketError,
}: AddToBasketMenuProps) {
  const isOpen = openId === flowId;
  const normalizedItems: FlowBasketItem[] = items.map((item) => ({
    key: String(item.key),
    requestedBin: item.requestedBin,
    earliestCrossing: item.earliestCrossing ?? undefined,
  }));
  const tvList = (Array.isArray(tvs) ? tvs : []).map((tv) => String(tv)).filter((tv) => tv.length > 0);

  const handleAddAsNew = () => {
    try {
      if (periodFrom && periodTo) {
        addFlowBasketWithPeriod(flowLabel, normalizedItems, periodFrom, periodTo);
        if (tvList.length > 0) {
          addTargetCells(tvList, periodFrom, periodTo);
        }
      } else {
        addFlowBasket(flowLabel, normalizedItems);
      }
      onBasketError(null);
      setOpenId(null);
    } catch (err) {
      onBasketError(err instanceof Error ? err.message : "Failed to add flow to basket.");
    }
  };

  const handleAddToExisting = (basketFlowId: string) => {
    try {
      addFlightsToBasketFlow(basketFlowId, normalizedItems);
      if (periodFrom && periodTo) {
        setFlowBasketPeriod(basketFlowId, periodFrom, periodTo, { overwrite: false });
        if (tvList.length > 0) {
          addTargetCells(tvList, periodFrom, periodTo);
        }
      }
      onBasketError(null);
      setOpenId(null);
    } catch (err) {
      onBasketError(err instanceof Error ? err.message : "Failed to add flights to basket.");
    }
  };

  const handleReviewNew = () => {
    if (normalizedItems.length === 0) {
      setOpenId(null);
      return;
    }
    onBasketError(null);
    setOpenId(null);
    onReviewRequest({
      targetLabel: flowLabel,
      items: normalizedItems,
      periodFrom,
      periodTo,
      tvs: tvList,
      sourceTrafficVolumeId,
      trafficReviewDetailsByFlightId,
    });
  };

  const handleReviewExisting = (basketFlowId: string, basketFlowName: string) => {
    if (normalizedItems.length === 0) {
      setOpenId(null);
      return;
    }
    onBasketError(null);
    setOpenId(null);
    onReviewRequest({
      targetFlowId: basketFlowId,
      targetLabel: basketFlowName,
      items: normalizedItems,
      periodFrom,
      periodTo,
      tvs: tvList,
      sourceTrafficVolumeId,
      trafficReviewDetailsByFlightId,
    });
  };

  return (
    <div className="relative inline-block text-[11px]">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpenId(isOpen ? null : flowId);
        }}
        className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/90 hover:bg-white/15 flex items-center gap-1"
        title="Add this flow to Flow Basket"
      >
        <Plus width="12" height="12" />
        <span className="hidden sm:inline">Add</span>
      </button>
      {isOpen && (
        <div
          className="absolute right-0 mt-1 w-56 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={handleAddAsNew}>
            Add as New
          </button>
          <button className="w-full text-left px-3 py-2 hover:bg-white/10" onClick={handleReviewNew}>
            Review and Add
          </button>
          <div className="h-px bg-white/10" />
          {flowBasket.length === 0 ? (
            <div className="px-3 py-2 opacity-60">No flows in basket</div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {flowBasket.map((bf) => (
                <div key={bf.id} className="border-b border-white/5 last:border-b-0">
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-white/10"
                    onClick={() => handleAddToExisting(bf.id)}
                  >
                    Add to {bf.name}
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-white/10"
                    onClick={() => handleReviewExisting(bf.id, bf.name)}
                  >
                    Review and Add to {bf.name}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
