"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line, ReferenceLine } from 'recharts';
import { useSimStore, type RegulationCatcherMode, type RegulationCatcherTimeframe } from "@/components/useSimStore";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import FlightLevelBinCountChart from "@/components/FlightLevelBinCountChart";
import FlightQueryDialog from "@/components/FlightQueryDialog";
import PanelCloseButton from "@/components/PanelCloseButton";
import { authFetch } from "@/lib/auth";
import { formatDwellingTime } from "@/lib/dwellTime";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";
import MostVulnerableTvList, { type MostVulnerableTvItem } from "@/components/MostVulnerableTvList";
import { normalizeCapacity } from "@/lib/capacity";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";
import { getDerivedCapacityRangeForTvAsync } from "@/lib/tvCapacityRanges";
import ShimmeringText from "@/components/ShimmeringText";
import {
  assertReplayableRegulationTargets,
  normalizeFlightIdList,
  normalizeRegulationContext,
} from "@/lib/regulationTargets";
import {
  buildMergedMultiTvChartRows,
  buildRollingChartDataFromOccupancy,
  type MergedMultiTvChartRow,
} from "@/lib/airspaceInfoMultiTv";
import { toTimeWindow } from "@/lib/regulationProposals";

type RegulationPanelProps = { embedded?: boolean };

type CommunityReviewContext = {
  communityId: string;
  flightIds: string[];
  label: string;
};

type CommunityHeuristicsSummary = {
  vTilde: number | null;
  slack15: number | null;
  slack30: number | null;
  flights: number | null;
  mvtv15: MostVulnerableTvItem[];
  mvtv30: MostVulnerableTvItem[];
};

type FlowHeuristicsDiagnostics = {
  v_tilde?: number | null;
  Slack_G15?: number | null;
  Slack_G30?: number | null;
  num_flights?: number | null;
  MVTV15?: MostVulnerableTvItem[] | null;
  MVTV30?: MostVulnerableTvItem[] | null;
  [key: string]: unknown;
};

type FlowExtractionResponse = {
  communities?: Record<string, number>;
  groups?: Record<string, string[]>;
  flows?: Array<{
    flow_id: number | string;
    heuristics?: {
      diagnostics?: FlowHeuristicsDiagnostics | null;
    } | null;
  }>;
};

const REG_MULTI_CHART_COLORS = [
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#a78bfa",
];

const REGULATION_CATCHER_TIMEFRAME_OPTIONS: Array<{ value: RegulationCatcherTimeframe; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "45m", label: "45M" },
  { value: "1h", label: "1H" },
  { value: "2h", label: "2H" },
  { value: "3h", label: "3H" },
  { value: "4h", label: "4H" },
  { value: "all", label: "ALL" },
];

export default function RegulationPanel({ embedded = false }: RegulationPanelProps) {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumes,
    selectedTrafficVolumeData,
    t,
    flights,
    resourceDate,
    resourceStateSelectedId,
    resourceStateEpoch,
    focusMode,
    setFocusMode,
    setFocusFlightIds,
    setT,
    regulationTargetFlightIds,
    regulationVisibleFlightIds,
    regulationListedFlightIds,
    addRegulationTargetFlight,
    removeRegulationTargetFlight,
    clearRegulationTargetFlights,
    setRegulationTargetFlightIds,
    regulationTimeWindow,
    setRegulationTimeWindow,
    regulationRate,
    setRegulationRate,
    clearSelectedTrafficVolumes,
    addRegulation,
    setIsRegulationPanelOpen,
    regulationEditPayload,
    setRegulationEditPayload,
    // Flow view state/actions
    flowViewEnabled,
    flowCommunities,
    flowGroups,
    flowColorByCommunity,
    flowThreshold,
    flowResolution,
    flowLoading,
    flowError,
    setFlowViewEnabled,
    setFlowThreshold,
    setFlowResolution,
    setFlowCommunities,
    setFlowColorByCommunity,
    setFlowLoading,
    setFlowError,
    setFlowPreviewFlightId,
    setFlowPreviewGroupId,
    regulationPreviewActive,
    setRegulationPreviewActive,
    regulationCatcherMode,
    regulationCatcherTimeframe,
    regulationCatcherActive,
    setRegulationCatcherMode,
    setRegulationCatcherTimeframe,
    cancelRegulationCatcher,
    proposalLoading,
    proposalQuery,
    proposalResults,
    fetchRegulationProposals,
    resetProposalState,
  } = useSimStore();

  const selectedTvIds = useMemo(() => {
    const source =
      Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
        ? selectedTrafficVolumes
        : selectedTrafficVolume
          ? [selectedTrafficVolume]
          : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of source) {
      const id = String(raw ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [selectedTrafficVolumes, selectedTrafficVolume]);
  const selectedTvKey = selectedTvIds.join("|");
  const primaryTvId = selectedTvIds[0] ?? null;
  const secondaryTvIds = useMemo(() => selectedTvIds.slice(1), [selectedTvIds]);

  const [inputValue, setInputValue] = useState("");
  const [activePreset, setActivePreset] = useState<string>("1h");
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [currentAnchorCapacity, setCurrentAnchorCapacity] = useState<number | null>(null);
  const [occupancyData, setOccupancyData] = useState<any | null>(null);
  const [secondaryOccupancyByTv, setSecondaryOccupancyByTv] = useState<Record<string, any>>({});
  const [flightIdentifiersData, setFlightIdentifiersData] = useState<Record<string, string[]> | null>(null);
  const [orderedFlightsData, setOrderedFlightsData] = useState<any | null>(null);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [magicSearchOpen, setMagicSearchOpen] = useState(false);
  const [showOnlyTargeted, setShowOnlyTargeted] = useState(false);
  const [communityReviewContext, setCommunityReviewContext] = useState<CommunityReviewContext | null>(null);
  const [communityHeuristics, setCommunityHeuristics] = useState<Record<string, CommunityHeuristicsSummary>>({});
  const [capacityRangeLabel, setCapacityRangeLabel] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [proposalTriggerError, setProposalTriggerError] = useState<string | null>(null);
  const flightLevelRange = formatFlightLevelRange(
    selectedTrafficVolumeData?.properties?.min_fl,
    selectedTrafficVolumeData?.properties?.max_fl
  );
  // When applying an edit payload, suppress auto preset updates on time changes
  const suppressAutoPresetRef = useRef<boolean>(false);
  // Suppress applying preset side-effect once when we programmatically set activePreset
  const suppressNextPresetApplyRef = useRef<boolean>(false);

  useEffect(() => {
    setOccupancyData(null);
    setSecondaryOccupancyByTv({});
    setFlightIdentifiersData(null);
    setOrderedFlightsData(null);
    setFlightListLoading(false);
    setCurrentCount(0);
    setCurrentAnchorCapacity(null);
    setShowOnlyTargeted(false);
    setCommunityReviewContext(null);
    setCommunityHeuristics({});
    setSelectionError(null);
    setProposalTriggerError(null);
  }, [resourceStateEpoch]);

  useEffect(() => {
    const proposalTvId = proposalResults?.traffic_volume_id ?? proposalQuery?.trafficVolumeId ?? null;
    if (!proposalTvId) return;
    if (selectedTvIds.length === 1 && proposalTvId === primaryTvId) return;
    resetProposalState();
    setProposalTriggerError(null);
  }, [primaryTvId, proposalQuery, proposalResults, resetProposalState, selectedTvIds.length]);

  const currentContext = useMemo(
    () => normalizeRegulationContext({ resourceDate, resourceStateId: resourceStateSelectedId }),
    [resourceDate, resourceStateSelectedId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!primaryTvId) {
      setCapacityRangeLabel(null);
      return;
    }
    getDerivedCapacityRangeForTvAsync(primaryTvId)
      .then((label) => {
        if (!cancelled) setCapacityRangeLabel(label);
      })
      .catch(() => {
        if (!cancelled) setCapacityRangeLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryTvId, resourceStateEpoch]);

  // Load occupancy/capacity and default rate when TV changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!primaryTvId) { setOccupancyData(null); return; }
      // If not editing, clear any previous target selection immediately to avoid race with async fetch
      if (!useSimStore.getState().regulationEditPayload) {
        clearRegulationTargetFlights();
      }
      try {
        const res = await authFetch(`/api/tv_count_with_capacity?traffic_volume_id=${primaryTvId}`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (cancelled) return;
        setOccupancyData(data);
        const binMinutes = inferTimeBinMinutesFromData(data);
        const cap = anchorCapacityForTime(
          data?.anchor_capacity,
          data?.hourly_capacity,
          t,
          binMinutes
        );
        setCurrentAnchorCapacity(typeof cap === 'number' ? cap : null);
        setRegulationRate(cap ?? 0);
      } catch {
        if (!cancelled) { setOccupancyData(null); setCurrentAnchorCapacity(null); }
      }
      // Default active time window anchored at current t unless editing payload provided
      if (!useSimStore.getState().regulationEditPayload) {
        applyPreset(activePreset);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryTvId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSecondaryOccupancy() {
      if (!primaryTvId || secondaryTvIds.length === 0) {
        setSecondaryOccupancyByTv({});
        return;
      }
      try {
        const entries = await Promise.all(
          secondaryTvIds.map(async (tvId) => {
            const res = await authFetch(`/api/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(tvId)}`);
            if (!res.ok) throw new Error(`Failed to fetch occupancy for ${tvId}`);
            const data = await res.json();
            return [tvId, data] as const;
          })
        );
        if (cancelled) return;
        setSecondaryOccupancyByTv(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setSecondaryOccupancyByTv({});
      }
    }
    loadSecondaryOccupancy();
    return () => { cancelled = true; };
  }, [primaryTvId, resourceStateEpoch, secondaryTvIds]);

  // Load flight identifiers for this TV (ordered when possible)
  useEffect(() => {
    let cancelled = false;
    async function loadFlights() {
      if (!primaryTvId) { setFlightIdentifiersData(null); setOrderedFlightsData(null); return; }
      setFlightListLoading(true);
      try {
        const ref = formatTimeForAPI(t);
        const res = await authFetch(`/api/tv_flights?traffic_volume_id=${primaryTvId}&ref_time_str=${ref}`);
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
        if (!cancelled) { setFlightIdentifiersData(null); setOrderedFlightsData(null); }
      } finally {
        if (!cancelled) setFlightListLoading(false);
      }
    }
    loadFlights();
    return () => { cancelled = true; };
  }, [primaryTvId, resourceStateEpoch, t]);

  const timeBinMinutes = useMemo(
    () => inferTimeBinMinutesFromData(occupancyData),
    [occupancyData]
  );

  // Recompute current count and capacity when time changes
  useEffect(() => {
    const cap = anchorCapacityForTime(
      occupancyData?.anchor_capacity,
      occupancyData?.hourly_capacity,
      t,
      timeBinMinutes
    );
    setCurrentAnchorCapacity(typeof cap === 'number' ? cap : null);
    const count = currentCountForTime(occupancyData, t);
    if (typeof count === 'number') setCurrentCount(count);
  }, [t, occupancyData, timeBinMinutes]);

  // Build histogram data (rolling hour), then filter to active time window
  const baseChartData: Array<{ time: string; count: number; hour: number; capacity?: number }> = useMemo(() => {
    if (!occupancyData) return [];
    const entries = Object.entries(occupancyData.occupancy_counts || {});
    const arr = entries.map(([timeRange, count]) => {
      const [startTime] = timeRange.split('-');
      const [hours, minutes] = startTime.split(':').map(Number);
      const hour = hours + minutes / 60;
      const anchorKey = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      const hourKey = `${hours.toString().padStart(2, '0')}:00-${(hours + 1).toString().padStart(2, '0')}:00`;
      const capacity = normalizeCapacity(
        occupancyData.anchor_capacity?.[anchorKey] ?? occupancyData.hourly_capacity?.[hourKey]
      );
      return { time: timeRange, count: count as number, hour, capacity };
    }).sort((a, b) => a.hour - b.hour);
    return arr;
  }, [occupancyData]);

  const binsPerHour = useMemo(
    () => Math.max(1, Math.round(60 / Math.max(1, timeBinMinutes))),
    [timeBinMinutes]
  );

  const chartData = useMemo(() => {
    if (baseChartData.length === 0) return [] as typeof baseChartData;
    const rolling = baseChartData.map((_, idx) => {
      let rollingSum = 0;
      const endIdx = Math.min(idx + binsPerHour, baseChartData.length);
      for (let j = idx; j < endIdx; j++) rollingSum += baseChartData[j].count;
      return { ...baseChartData[idx], count: rollingSum };
    });
    return rolling;
  }, [baseChartData, binsPerHour]);

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

  const multiChartSeries = useMemo(() => {
    return selectedTvIds.map((tvId, index) => ({
      tvId,
      countKey: `count__${tvId}`,
      capacityKey: `capacity__${tvId}`,
      color: REG_MULTI_CHART_COLORS[index % REG_MULTI_CHART_COLORS.length],
      isPrimary: tvId === primaryTvId,
    }));
  }, [selectedTvIds, primaryTvId]);

  const multiChartDataByTv = useMemo(() => {
    const out: Record<string, Array<{ time: string; count: number; hour: number; capacity?: number }>> = {};
    if (primaryTvId && chartData.length > 0) {
      out[primaryTvId] = chartData;
    }
    for (const tvId of secondaryTvIds) {
      const occupancy = secondaryOccupancyByTv[tvId];
      if (!occupancy) continue;
      out[tvId] = buildRollingChartDataFromOccupancy(occupancy).chartData;
    }
    return out;
  }, [primaryTvId, chartData, secondaryTvIds, secondaryOccupancyByTv]);

  const multiChartDataReady =
    selectedTvIds.length > 1 &&
    selectedTvIds.every((tvId) => Object.prototype.hasOwnProperty.call(multiChartDataByTv, tvId));

  const mergedChartData = useMemo(() => {
    if (!multiChartDataReady) return [] as MergedMultiTvChartRow[];
    const keyByTv = Object.fromEntries(
      multiChartSeries.map((series) => [
        series.tvId,
        { countKey: series.countKey, capacityKey: series.capacityKey },
      ]),
    );
    return buildMergedMultiTvChartRows({
      selectedTvIds,
      chartDataByTv: multiChartDataByTv,
      keyByTv,
    });
  }, [multiChartDataReady, multiChartSeries, selectedTvIds, multiChartDataByTv]);

  const displayMergedChartData = useMemo(() => {
    if (!mergedChartData.length) return [] as MergedMultiTvChartRow[];
    const [from, to] = regulationTimeWindow;
    const windowDuration = to - from;
    const currentTime = t;
    const displayFrom = currentTime - windowDuration;
    const displayTo = currentTime + windowDuration;
    return mergedChartData.filter((d) => {
      const sec = Number(d.hour ?? 0) * 3600;
      return sec >= displayFrom && sec <= displayTo;
    });
  }, [mergedChartData, regulationTimeWindow, t]);

  const trafficOverloadSegments = useMemo(() => {
    if (!chartData.length) return [];

    const [windowStart, windowEnd] = regulationTimeWindow;

    // Respect active time window by only including intersecting bins.
    return chartData.reduce((acc: any[], point) => {
      const [rawStart = "", rawEnd = ""] = String(point.time || "").split('-');
      const startSeconds = parseTimeToSeconds(rawStart.trim());
      const endSeconds = parseTimeToSeconds((rawEnd || rawStart).trim());
      const intersectsWindow = endSeconds > windowStart && startSeconds < windowEnd;
      if (!intersectsWindow) return acc;

      const occupancy = Number(point.count ?? 0);
      const capacity = Number(point.capacity ?? 0);
      const ratio = capacity > 0 ? occupancy / capacity : 0;

      // Match color convention from LeftControl1
      const color = capacity <= 0
        ? "#94a3b8"
        : ratio >= 1.4
          ? "#b91c1c"
          : ratio >= 1.2
            ? "#f97316"
            : ratio >= 1.0
              ? "#fb923c"
              : "#34d399";

      const metadata: string[] = [`Rolling occupancy: ${Math.round(occupancy)}`];
      if (capacity > 0) {
        metadata.push(`Anchor capacity (rolling hour): ${Math.round(capacity)}`);
        metadata.push(`Load ratio: ${ratio.toFixed(2)}`);
        const diff = occupancy - capacity;
        metadata.push(`${diff >= 0 ? 'Excess' : 'Available'}: ${Math.abs(Math.round(diff))}`);
      } else {
        metadata.push('Anchor capacity unavailable');
      }

      acc.push({
        period: point.time,
        color,
        metadata,
        label: primaryTvId ? `${primaryTvId} load` : undefined,
      });
      return acc;
    }, [] as any[]);
  }, [chartData, regulationTimeWindow, primaryTvId]);

  const windowAnchorCapacityRange = useMemo(() => {
    if (!chartData.length) return null;
    const [windowStart, windowEnd] = regulationTimeWindow;
    const values: number[] = [];
    for (const point of chartData) {
      const [rawStart = "", rawEnd = ""] = String(point.time || "").split("-");
      const startSeconds = parseTimeToSeconds(rawStart.trim());
      const endSeconds = parseTimeToSeconds((rawEnd || rawStart).trim());
      const intersectsWindow = endSeconds > windowStart && startSeconds < windowEnd;
      if (!intersectsWindow) continue;
      if (typeof point.capacity === "number" && Number.isFinite(point.capacity)) {
        values.push(point.capacity);
      }
    }
    if (!values.length) return null;
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [chartData, regulationTimeWindow]);

  const windowAnchorCapacityLabel = windowAnchorCapacityRange
    ? `${Math.round(windowAnchorCapacityRange.min)}–${Math.round(windowAnchorCapacityRange.max)}`
    : null;

  // Compute filtered flights for active time window, and apply focus filter on the map
  const filteredFlightIds = useMemo(() => {
    if (selectedTvIds.length > 1) {
      return new Set((regulationListedFlightIds || []).map((id) => String(id)));
    }
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
  }, [selectedTvIds.length, regulationListedFlightIds, orderedFlightsData, flightIdentifiersData, regulationTimeWindow]);

  const listedFlightIdSet = useMemo(
    () => new Set((regulationListedFlightIds || []).map((id) => String(id))),
    [regulationListedFlightIds],
  );
  const summaryCurrentCount = selectedTvIds.length > 1
    ? listedFlightIdSet.size
    : currentCount;

  const listedFlights = useMemo(() => {
    if (listedFlightIdSet.size === 0) return [] as typeof flights;
    return flights.filter((flight) => listedFlightIdSet.has(String(flight.flightId)));
  }, [flights, listedFlightIdSet]);

  // derive selected flights
  const selectedFlights = useMemo(() => {
    const idSet = regulationTargetFlightIds;
    return flights.filter(f => idSet.has(String(f.flightId)));
  }, [flights, regulationTargetFlightIds]);

  const targetedFlightIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const flight of selectedFlights) {
      if (flight?.flightId !== undefined && flight?.flightId !== null) {
        set.add(String(flight.flightId));
      }
    }
    return set;
  }, [selectedFlights]);

  const hasTargetedFlights = targetedFlightIdSet.size > 0;
  const showTargetedOnly = showOnlyTargeted && hasTargetedFlights;

  useEffect(() => {
    if (showOnlyTargeted && !hasTargetedFlights) {
      setShowOnlyTargeted(false);
    }
  }, [showOnlyTargeted, hasTargetedFlights]);

  useEffect(() => {
    if (!primaryTvId || listedFlightIdSet.size === 0) return;
    const offListIds = Array.from(regulationTargetFlightIds).filter((id) => !listedFlightIdSet.has(String(id)));
    if (offListIds.length === 0) return;
    const next = new Set<string>();
    for (const id of regulationTargetFlightIds) {
      const normalized = String(id);
      if (listedFlightIdSet.has(normalized)) {
        next.add(normalized);
      }
    }
    setRegulationTargetFlightIds(next);
    setSelectionError(
      `Removed ${offListIds.length} targeted flight${offListIds.length === 1 ? "" : "s"} that were not present in the current ranked flight list.`,
    );
  }, [primaryTvId, listedFlightIdSet, regulationTargetFlightIds, setRegulationTargetFlightIds]);

  useEffect(() => {
    setRegulationPreviewActive(showTargetedOnly);
  }, [showTargetedOnly, setRegulationPreviewActive]);

  useEffect(() => {
    if (primaryTvId) return;
    setShowOnlyTargeted(false);
    setRegulationPreviewActive(false);
    clearRegulationTargetFlights();
    setSelectionError(null);
    setFocusFlightIds(new Set());
    setFocusMode(false);
    setFlowViewEnabled(false);
    setFlowCommunities(null, null);
    setFlowColorByCommunity(null);
    setFlowError(null);
    setCommunityHeuristics({});
    setFlowPreviewFlightId(null);
    setFlowPreviewGroupId(null);
  }, [primaryTvId, setRegulationPreviewActive, clearRegulationTargetFlights, setFocusFlightIds, setFocusMode, setFlowViewEnabled, setFlowCommunities, setFlowColorByCommunity, setFlowError, setFlowPreviewFlightId, setFlowPreviewGroupId]);

  const toggleSeeOnlyTargeted = () => {
    if (!hasTargetedFlights) return;
    setShowOnlyTargeted(prev => !prev);
  };

  const toggleCatcherMode = (mode: Exclude<RegulationCatcherMode, "off">) => {
    if (regulationCatcherMode === mode) {
      cancelRegulationCatcher();
      return;
    }
    setRegulationCatcherMode(mode);
  };

  // Apply focus mode and ids to filter map to only those flights
  useEffect(() => {
    if (!primaryTvId) return;
    const desiredFocus = showTargetedOnly ? targetedFlightIdSet : filteredFlightIds;
    const currentIds = useSimStore.getState().focusFlightIds;
    if (!areSetsEqual(currentIds, desiredFocus)) {
      setFocusFlightIds(new Set(desiredFocus));
    }
    if (!focusMode) setFocusMode(true);
  }, [filteredFlightIds, targetedFlightIdSet, showTargetedOnly, primaryTvId, setFocusFlightIds, focusMode, setFocusMode]);

  // time window presets
  const presets = ["15", "30", "45", "1h", "1h15", "1h30", "1h45", "2h", "2h30", "3h", "3h30", "4h"];
  // Apply preset when the preset value changes (user action)
  useEffect(() => {
    if (suppressNextPresetApplyRef.current) {
      // Skip applying preset for this programmatic change
      suppressNextPresetApplyRef.current = false;
      return;
    }
    applyPreset(activePreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset]);
  // Auto-apply preset anchored at current t only if not editing from a payload
  useEffect(() => {
    if (suppressAutoPresetRef.current) return;
    applyPreset(activePreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  function parseDurationPresetToSeconds(preset: string): number {
    const s = (preset || '').trim().toLowerCase();
    const hIndex = s.indexOf('h');
    if (hIndex !== -1) {
      const hoursPart = s.slice(0, hIndex);
      const minutesPart = s.slice(hIndex + 1);
      const hours = Number.parseInt(hoursPart, 10) || 0;
      const minutes = minutesPart ? (Number.parseInt(minutesPart, 10) || 0) : 0;
      return ((hours * 60) + minutes) * 60;
    }
    const minutesOnly = Number.parseInt(s, 10) || 0;
    return minutesOnly * 60;
  }

  function applyPreset(preset: string) {
    const from = Math.floor(t);
    const to = from + parseDurationPresetToSeconds(preset);
    setRegulationTimeWindow(from, to);
  }

  const validateFlightIdsAgainstCurrentList = useCallback((flightIds: string[], actionLabel: string): string[] | null => {
    const ids = normalizeFlightIdList(flightIds);
    if (ids.length === 0) {
      setSelectionError(`${actionLabel} failed because no target flights were provided.`);
      return null;
    }
    if (listedFlightIdSet.size === 0) {
      setSelectionError(`The current ranked flight list is unavailable. ${actionLabel} is blocked until it loads.`);
      return null;
    }
    const offListIds = ids.filter((id) => !listedFlightIdSet.has(id));
    if (offListIds.length > 0) {
      setSelectionError(
        `${actionLabel} refused because ${offListIds.length} flight${offListIds.length === 1 ? "" : "s"} ${offListIds.length === 1 ? "is" : "are"} not in the current ranked flight list.`,
      );
      return null;
    }
    setSelectionError(null);
    return ids;
  }, [listedFlightIdSet]);

  function handleEnter() {
    const q = inputValue.trim();
    if (!q) return;
    // Special keyword: add all currently visible flights from the flight list in a single update
    if (q.toLowerCase() === 'all') {
      const validatedIds = validateFlightIdsAgainstCurrentList(regulationVisibleFlightIds, "Add all visible flights");
      if (validatedIds && validatedIds.length > 0) {
        const next = new Set<string>(regulationTargetFlightIds);
        for (const id of validatedIds) next.add(String(id));
        if (!areSetsEqual(next, regulationTargetFlightIds)) {
          setRegulationTargetFlightIds(next);
        }
        setSelectionError(null);
      }
      setInputValue("");
      return;
    }
    // For now, support callsign/flightId exact match
    const queryLower = q.toLowerCase();
    const flight = listedFlights.find(f => {
      const idMatch = String(f.flightId).toLowerCase() === queryLower;
      const cs = f.callSign;
      const csLower = cs !== undefined && cs !== null ? String(cs).toLowerCase() : undefined;
      const csMatch = csLower ? csLower === queryLower : false;
      return idMatch || csMatch;
    });
    if (flight) {
      addRegulationTargetFlight(String(flight.flightId));
      setSelectionError(null);
      setInputValue("");
      return;
    }
    const globalMatch = flights.find(f => {
      const idMatch = String(f.flightId).toLowerCase() === queryLower;
      const cs = f.callSign;
      const csLower = cs !== undefined && cs !== null ? String(cs).toLowerCase() : undefined;
      const csMatch = csLower ? csLower === queryLower : false;
      return idMatch || csMatch;
    });
    setSelectionError(
      globalMatch
        ? "That flight exists in the workspace but is not in the current ranked flight list. Refusing to add it."
        : "No flight in the current ranked flight list matched that identifier.",
    );
  }

  // Listen for map flight clicks to add to list
  useEffect(() => {
    const handler = (e: any) => {
      const { flightId } = e.detail || {};
      if (!flightId) return;
      const validatedIds = validateFlightIdsAgainstCurrentList([String(flightId)], "Add flight from map");
      if (!validatedIds) return;
      addRegulationTargetFlight(validatedIds[0]);
    };
    window.addEventListener('regulation-add-flight', handler as any);
    return () => window.removeEventListener('regulation-add-flight', handler as any);
  }, [addRegulationTargetFlight, validateFlightIdsAgainstCurrentList]);

  // Clear previews on unmount
  useEffect(() => {
    return () => { setFlowPreviewFlightId(null); setFlowPreviewGroupId(null); };
  }, [setFlowPreviewFlightId, setFlowPreviewGroupId]);

  const addRegulationFromFlightIds = useCallback((flightIds: string[]) => {
    if (!primaryTvId) return false;
    if (!currentContext.resourceDate) {
      setSelectionError("The current resource date is unavailable. Refusing to create a regulation without resource context.");
      return false;
    }
    const uniqueIds = validateFlightIdsAgainstCurrentList(flightIds, "Add regulation");
    if (!uniqueIds || uniqueIds.length === 0) return false;
    addRegulation({
      trafficVolume: primaryTvId,
      activeTimeWindowFrom: regulationTimeWindow[0],
      activeTimeWindowTo: regulationTimeWindow[1],
      flightIds: uniqueIds,
      resourceDate: currentContext.resourceDate,
      resourceStateId: currentContext.resourceStateId,
      rate: regulationRate,
    });
    setIsRegulationPanelOpen(true);
    clearRegulationTargetFlights();
    setSelectionError(null);
    return true;
  }, [primaryTvId, currentContext, validateFlightIdsAgainstCurrentList, addRegulation, regulationTimeWindow, regulationRate, setIsRegulationPanelOpen, clearRegulationTargetFlights]);

  const handleReviewCommunity = useCallback((context: CommunityReviewContext) => {
    if (!context) return;
    const normalizedIds = Array.from(new Set((context.flightIds || []).map((id) => String(id)).filter(Boolean)));
    if (normalizedIds.length === 0) {
      setCommunityReviewContext(null);
      return;
    }
    setCommunityReviewContext({
      communityId: String(context.communityId),
      label: context.label || `Community ${context.communityId}`,
      flightIds: normalizedIds,
    });
  }, [setCommunityReviewContext]);

  const communityReviewFlightIds = useMemo(() => {
    if (!communityReviewContext) return [] as string[];
    return communityReviewContext.flightIds.map((id) => String(id));
  }, [communityReviewContext]);

  const communityReviewLabels = useMemo(() => {
    if (!communityReviewContext) {
      return { highlight: undefined as string | undefined, baseline: undefined as string | undefined };
    }
    const baseLabel = communityReviewContext.label || `Community ${communityReviewContext.communityId}`;
    return {
      highlight: `Add ${baseLabel}`,
      baseline: baseLabel,
    };
  }, [communityReviewContext]);

  const handleCommunityReviewSelection = useCallback((selectedIds: string[]) => {
    if (!communityReviewContext) return;
    const allowed = new Set((communityReviewContext.flightIds || []).map((id) => String(id)));
    const chosen = Array.from(new Set((selectedIds || []).map((id) => String(id)).filter((id) => allowed.has(id))));
    if (chosen.length === 0) {
      setCommunityReviewContext(null);
      return;
    }
    addRegulationFromFlightIds(chosen);
    setCommunityReviewContext(null);
  }, [communityReviewContext, addRegulationFromFlightIds, setCommunityReviewContext]);

  const handleCloseCommunityReview = useCallback(() => {
    setCommunityReviewContext(null);
  }, [setCommunityReviewContext]);

  function handlePreviewRegulation() {
    if (!primaryTvId || selectedFlights.length === 0) return;
    addRegulationFromFlightIds(selectedFlights.map((flight) => String(flight.flightId)));
  }

  // Flow Control: request community assignments for visible arrivals
  async function requestFlowExtraction() {
    if (!primaryTvId) return;
    const ids = Array.from(new Set((Array.isArray(regulationListedFlightIds) ? regulationListedFlightIds : []).map((id) => String(id)).filter(Boolean)));
    if (ids.length === 0) {
      // Clear stale flow render state so the canvas falls back to the (empty) focus set.
      setFlowCommunities(null, null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
      setFlowError(selectedTvIds.length > 1
        ? 'No intersecting flights available across selected traffic volumes.'
        : 'No flights available to extract flows.');
      setCommunityHeuristics({});
      return;
    }
    setFlowLoading(true);
    setFlowError(null);
    try {
      const ref = formatTimeForAPI(t);
      const params = new URLSearchParams({
        traffic_volume_id: String(primaryTvId),
        ref_time_str: String(ref),
        threshold: String(flowThreshold),
        resolution: String(flowResolution),
        flight_ids: ids.join(',')
      });
      const res = await (await import("@/lib/auth")).authFetch(`/api/flow_extraction?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json() as FlowExtractionResponse;
      // Expect data.communities: { flightId: communityId }, data.groups: { comId: [flightIds] }
      if (data && data.communities) {
        setFlowCommunities(data.communities, data.groups || null);
        const nextHeuristics: Record<string, CommunityHeuristicsSummary> = {};
        for (const flow of data.flows || []) {
          const flowId = String(flow?.flow_id ?? "");
          if (!flowId) continue;
          const diagnostics = flow.heuristics?.diagnostics;
          nextHeuristics[flowId] = {
            vTilde: normalizeHeuristicValue(diagnostics?.v_tilde),
            slack15: normalizeHeuristicValue(diagnostics?.Slack_G15),
            slack30: normalizeHeuristicValue(diagnostics?.Slack_G30),
            flights: normalizeHeuristicValue(diagnostics?.num_flights),
            mvtv15: normalizeMostVulnerableTvItems(diagnostics?.MVTV15),
            mvtv30: normalizeMostVulnerableTvItems(diagnostics?.MVTV30),
          };
        }
        setCommunityHeuristics(nextHeuristics);
        setFlowViewEnabled(true);
      } else {
        setFlowCommunities(null, null);
        setFlowPreviewGroupId(null);
        setFlowPreviewFlightId(null);
        setCommunityHeuristics({});
        setFlowError('Flow extraction returned no communities.');
      }
    } catch (e: any) {
      setFlowCommunities(null, null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
      setCommunityHeuristics({});
      setFlowError(e?.message || 'Failed to extract flows');
    } finally {
      setFlowLoading(false);
    }
  }

  // Re-run extraction when params change while enabled
  useEffect(() => {
    if (!flowViewEnabled) return;
    requestFlowExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowThreshold, flowResolution, selectedTvKey, t, regulationListedFlightIds]);

  // Apply pending edit payload (from RegulationPlanPanel) without causing extra API calls
  useEffect(() => {
    const payload = regulationEditPayload;
    if (!payload) return;
    if (payload.trafficVolume !== primaryTvId) return; // wait until TV matches

    // Apply time window and rate
    // Prevent auto-presets (triggered by time changes) from overriding this edit
    suppressAutoPresetRef.current = true;
    setRegulationTimeWindow(payload.activeTimeWindowFrom, payload.activeTimeWindowTo);
    setRegulationRate(payload.rate);

    // Reflect the edited window in the highlighted preset without re-applying it
    const newPreset = computePresetForWindow(payload.activeTimeWindowFrom, payload.activeTimeWindowTo);
    suppressNextPresetApplyRef.current = true;
    setActivePreset(newPreset);

    try {
      const replayableIds = assertReplayableRegulationTargets(payload, currentContext);
      setRegulationTargetFlightIds(new Set(replayableIds));
      setSelectionError(null);
    } catch (err) {
      setRegulationTargetFlightIds(new Set<string>());
      setSelectionError(err instanceof Error ? err.message : "Failed to load regulation targets for editing.");
    }

    // Clear payload so it doesn't apply repeatedly
    setRegulationEditPayload(null);
  }, [regulationEditPayload, primaryTvId, currentContext, setRegulationTimeWindow, setRegulationRate, setRegulationTargetFlightIds, setRegulationEditPayload]);

  if (!primaryTvId || selectedTvIds.length === 0) return null;

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "absolute top-20 right-4 z-50 w-[384px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"}>
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">
            {selectedTvIds.length > 1 ? `Reference TV (${selectedTvIds.length} selected)` : 'Reference TV'}
          </div>
          <div className="text-lg font-semibold">{primaryTvId}</div>
          {secondaryTvIds.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {secondaryTvIds.map((tvId) => (
                <div key={tvId} className="text-[11px] opacity-75 break-all">
                  {tvId}
                </div>
              ))}
            </div>
          )}
          {flightLevelRange && (
            <div className="text-xs opacity-80">{flightLevelRange}</div>
          )}
          {capacityRangeLabel && (
            <div className="text-xs opacity-80">Capacity range: {capacityRangeLabel}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <button
              aria-label="Propose regulation bundles"
              type="button"
              onClick={async () => {
                if (!primaryTvId || selectedTvIds.length > 1) return;
                const [from, to] = regulationTimeWindow;
                if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
                  setProposalTriggerError("Invalid time window; end must be after start.");
                  return;
                }
                setProposalTriggerError(null);
                await fetchRegulationProposals({
                  trafficVolumeId: String(primaryTvId),
                  timeWindow: toTimeWindow(formatTime(from), formatTime(to)),
                  threshold: flowThreshold,
                  resolution: flowResolution,
                });
              }}
              disabled={proposalLoading || selectedTvIds.length > 1}
              title={selectedTvIds.length > 1 ? "Regulation proposals are available only for a single selected TV" : "Propose regulation bundles"}
              className={`h-7 w-7 flex items-center justify-center rounded-lg border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${(proposalLoading || selectedTvIds.length > 1)
                ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                : 'border-white/30 bg-white/20 hover:bg-white/30'}`}
            >
              <svg height="12" fill="currentColor" width="12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <g id="new">
                  <g>
                    <polygon points="13,23 11,23 11,13.7 3,18.4 2,16.6 10,12 2,7.4 3,5.6 11,10.3 11,1 13,1 13,10.3 21,5.6 22,7.4 14,12 22,16.6 21,18.4 13,13.7"/>
                  </g>
                </g>
              </svg>
            </button>
            <PanelCloseButton
              onClick={() => {
                clearSelectedTrafficVolumes();
                setFocusMode(false);
                setFocusFlightIds(new Set());
                setIsRegulationPanelOpen(false);
                setFlowViewEnabled(false);
                setFlowCommunities(null, null);
                setFlowColorByCommunity(null);
                setFlowError(null);
                setCommunityHeuristics({});
                setFlowPreviewFlightId(null);
                setFlowPreviewGroupId(null);
                clearRegulationTargetFlights();
                setSelectionError(null);
                setShowOnlyTargeted(false);
                setRegulationPreviewActive(false);
                setFlowColorByCommunity(null);
                resetProposalState();
                setProposalTriggerError(null);
                window.dispatchEvent(new CustomEvent('clearTrafficVolumeHighlight'));
              }}
            />
          </div>
          {proposalTriggerError && (
            <div className="text-[11px] text-red-200 text-right">{proposalTriggerError}</div>
          )}
        </div>
      </div>

      <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 flex-1 space-y-4"}>
        {/* Current count + capacity summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">{selectedTvIds.length > 1 ? "Intersection Count" : "Current Count"}</div>
            <div className="text-lg font-semibold">{summaryCurrentCount}</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-xs opacity-70">Capacity</div>
            <div className="text-lg font-semibold">
              {currentAnchorCapacity !== null ? Math.round(currentAnchorCapacity) : '—'}
            </div>
            {windowAnchorCapacityLabel && (
              <div className="text-[11px] opacity-70 mt-1">
                Range: {windowAnchorCapacityLabel}
              </div>
            )}
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

        {/* Flow Control (moved here) */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm opacity-90">Flow Control</div>
            <button
              onClick={async () => {
                if (flowViewEnabled) {
                  setFlowViewEnabled(false);
                  setFlowCommunities(null, null);
                  setFlowColorByCommunity(null);
                  setFlowError(null);
                  setCommunityHeuristics({});
                  setFlowPreviewGroupId(null);
                  setFlowPreviewFlightId(null);
                } else {
                  await requestFlowExtraction();
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs ${flowViewEnabled ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
            >
              {flowViewEnabled ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.86 18.86 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.86 18.86 0 0 1-3.17 4.13M1 1l22 22"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
              )}
              {flowViewEnabled ? 'Disable Flow View' : 'Enable Flow View'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] opacity-80 mb-1">Threshold</div>
              <input
                type="number"
                min={0}
                max={10}
                step={0.05}
                value={flowThreshold}
                onChange={(e) => setFlowThreshold(Number(e.currentTarget.value))}
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
                value={flowResolution}
                onChange={(e) => setFlowResolution(Number(e.currentTarget.value))}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none"
              />
            </div>
          </div>
          {flowLoading && (
            <div className="text-[10px] opacity-70 mt-2">Extracting flows…</div>
          )}
          {flowError && (
            <div className="text-[10px] mt-2 text-red-200">{flowError}</div>
          )}
          {!flowLoading && (
            <div className="text-[10px] opacity-70 mt-2">
              {selectedTvIds.length > 1
                ? `Extract Flows uses the intersection of the current flight list across ${selectedTvIds.length} selected TVs (${regulationListedFlightIds.length} flights).`
                : `Extract Flows uses the current flight list (${regulationListedFlightIds.length} flights).`}
            </div>
          )}
          {!flowLoading && flowViewEnabled && (
            <div className="text-[10px] opacity-70 mt-2">Flow view active. Colors represent discovered flows; singletons/unassigned are gray.</div>
          )}
        </div>

        {/* Flow Communities (top 10 by size) */}
        {flowViewEnabled && (
          <FlowCommunitiesSection
            flowCommunities={flowCommunities}
            flowGroups={flowGroups}
            flowColorByCommunity={flowColorByCommunity}
            communityHeuristics={communityHeuristics}
            flights={flights}
            orderedFlightsData={orderedFlightsData}
            selectedTrafficVolume={primaryTvId}
            regulationTimeWindow={regulationTimeWindow}
            embedded={embedded}
            onReviewCommunity={handleReviewCommunity}
          />
        )}

        {/* Predicate / Flight List input */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm opacity-90">Predicate Syntax or Flight List</div>
          </div>
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleEnter(); }}
                placeholder="Enter callsign or flight id, then press Enter"
                className="w-full px-4 py-2 pr-16 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
              />
              <div className="absolute inset-y-0 right-2 flex items-center gap-2">
                <button
                  onClick={handleEnter}
                  className="text-gray-300 hover:text-white"
                  title="Add flight"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill="currentColor" /></svg>
                </button>
                <button
                  onClick={() => setMagicSearchOpen(true)}
                  className="text-gray-300 hover:text-white"
                  title="Magic Search"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 17 17 7" />
                    <path d="M7 7h10v10" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 bg-white/5 border border-white/10 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Flight Catchers</h3>
              <div className="text-xs opacity-70">
                {regulationCatcherActive ? "Drawing enabled" : "Drawing disabled"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CatcherButton
                title="Positive Flight Catcher"
                active={regulationCatcherMode === "include"}
                onClick={() => toggleCatcherMode("include")}
                kind="include"
              />
              <CatcherButton
                title="Negative Flight Catcher"
                active={regulationCatcherMode === "exclude"}
                onClick={() => toggleCatcherMode("exclude")}
                kind="exclude"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {REGULATION_CATCHER_TIMEFRAME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRegulationCatcherTimeframe(option.value)}
                  className={`px-2 py-1.5 text-[11px] font-medium rounded border transition-colors ${
                    regulationCatcherTimeframe === option.value
                      ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                      : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] opacity-75">
              {regulationCatcherActive
                ? "Gate freezes at first click. Double-click to finish, Esc to cancel."
                : "Choose a catcher mode, then draw to include/exclude flights visible at gate start within the current flight list."}
            </p>
            {selectionError && (
              <div className="text-[11px] text-red-200">{selectionError}</div>
            )}
          </div>
        </div>

        {/* Selected flights table */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm opacity-90">Targeted Flights ({selectedFlights.length})</div>
              <FlightStatisticsButton
                flightIds={selectedFlights.map((flight) => flight.flightId)}
                sourceTrafficVolumeId={primaryTvId}
                buttonClassName="border-white/20 text-white/80"
              />
              <button
                type="button"
                onClick={toggleSeeOnlyTargeted}
                disabled={!hasTargetedFlights}
                aria-pressed={showTargetedOnly}
                aria-label={showTargetedOnly ? "Show filtered flights" : "See only targeted flights"}
                title={showTargetedOnly ? "Show filtered flights" : "See only targeted flights"}
                className={`h-6 w-6 p-0 rounded border flex items-center justify-center transition-colors ${showTargetedOnly ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30' : 'border-white/10 text-white/80 hover:bg-white/10'} disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-white/30`}
              >
                {showTargetedOnly ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a18.86 18.86 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a18.86 18.86 0 01-3.17 4.13M1 1l22 22" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
              </button>
            </div>
            {selectedFlights.length > 0 && (
              <button onClick={() => { clearRegulationTargetFlights(); setSelectionError(null); }} className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/10">Clear</button>
            )}
          </div>
          {selectedFlights.length === 0 ? (
            <div className="text-xs opacity-70">No flights targeted. Click lines on map or enter callsign.</div>
          ) : (
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <div className={embedded ? "overflow-x-auto" : "max-h-52 overflow-y-auto no-scrollbar overflow-x-auto"}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-900/90 backdrop-blur-sm select-none border-b border-white/10">
                      <th className="text-left p-2 font-semibold">CS</th>
                      <th className="text-left p-2 font-semibold">Ori.</th>
                      <th className="text-left p-2 font-semibold">Des.</th>
                      <th className="text-left p-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFlights.map((f, index) => (
                      <tr
                        key={String(f.flightId)}
                        className={`border-t border-white/10 ${index % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10 cursor-pointer transition-colors`}
                        onMouseEnter={() => setFlowPreviewFlightId(String(f.flightId))}
                        onMouseLeave={() => setFlowPreviewFlightId(null)}
                      >
                        <td className="p-2 font-mono">{f.callSign || f.flightId}</td>
                        <td className="p-2">{f.origin || 'N/A'}</td>
                        <td className="p-2">{f.destination || 'N/A'}</td>
                        <td className="p-2">
                          <button onClick={() => removeRegulationTargetFlight(String(f.flightId))} className="text-red-300 hover:text-red-200">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7zm5-3h6l1 3H8l1-3z" stroke="currentColor" strokeWidth="1.5" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="text-[10px] opacity-70 mt-2">Selected flight lines are shown in bright red on the map.</div>
        </div>

        {/* Histogram (Focus Mode style) */}
        {(displayChartData.length > 0 || (selectedTvIds.length > 1 && displayMergedChartData.length > 0)) && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm opacity-90">Rolling Hour Occupancy </h4>
              <span className="text-[10px] opacity-70">{formatTime(regulationTimeWindow[0])}–{formatTime(regulationTimeWindow[1])}</span>
            </div>
            {selectedTvIds.length > 1 && !multiChartDataReady && (
              <ShimmeringText text="Loading occupancy for additional selected TVs…" className="mb-2 text-[10px] opacity-70 font-normal" />
            )}
            <div style={{ width: '100%', height: 180 }}>
              {selectedTvIds.length > 1 && multiChartDataReady && displayMergedChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={displayMergedChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="time" tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} height={16} />
                    <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} width={26} />
                    <Tooltip content={<RegMultiTooltip chartSeries={multiChartSeries} />} />
                    {multiChartSeries.map((series) => (
                      <Bar
                        key={series.countKey}
                        dataKey={series.countKey}
                        fill={series.color}
                        fillOpacity={series.isPrimary ? 0.85 : 0.45}
                        radius={[2, 2, 0, 0]}
                        onClick={(_, index: number) => {
                          const point = displayMergedChartData[index as any] as any;
                          if (point && point.hour !== undefined) setT(point.hour * 3600);
                        }}
                        style={{ cursor: 'pointer' }}
                        isAnimationActive={false}
                      />
                    ))}
                    {multiChartSeries.map((series) => (
                      <Line
                        key={series.capacityKey}
                        type="linear"
                        dataKey={series.capacityKey}
                        stroke={series.color}
                        strokeWidth={series.isPrimary ? 2 : 1.5}
                        strokeDasharray={series.isPrimary ? undefined : "4 3"}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                    <ReferenceLine x={nearestCategoryForTime(displayMergedChartData as any, t)} stroke="#ef4444" strokeWidth={2} strokeDasharray="0" label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={displayChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="time" tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} height={16} />
                    <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickMargin={0} width={26} />
                    <Tooltip content={<RegTooltip />} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[2, 2, 0, 0]} onClick={(_, index: number) => {
                      const point: any = displayChartData[index as any];
                      if (point && point.hour !== undefined) setT(point.hour * 3600);
                    }} style={{ cursor: 'pointer' }} />
                    <Line type="linear" dataKey="capacity" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls={false} name="Anchor capacity (rolling hour)" isAnimationActive={false} />
                    <ReferenceLine x={nearestCategoryForTime(displayChartData, t)} stroke="#ef4444" strokeWidth={2} strokeDasharray="0" label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            {selectedTvIds.length > 1 && multiChartDataReady ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs opacity-70">
                {multiChartSeries.map((series) => (
                  <div key={series.tvId} className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: series.color, opacity: series.isPrimary ? 0.85 : 0.45 }} />
                    <div className="w-3 h-0.5" style={{ backgroundColor: series.color }} />
                    <span>{series.tvId}{series.isPrimary ? " (Primary)" : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center space-x-4 mt-2 text-xs opacity-70">
                <div className="flex items-center"><div className="w-3 h-3 bg-cyan-500 rounded mr-1"></div><span>Occupancy Count</span></div>
                <div className="flex items-center"><div className="w-3 h-0.5 bg-yellow-400 mr-1"></div><span>Capacity</span></div>
              </div>
            )}
          </div>
        )}

        {occupancyData?.flight_level_counts?.bins?.length > 0 && (
          <FlightLevelBinCountChart
            data={occupancyData?.flight_level_counts}
            trafficVolumeId={primaryTvId}
            filterToWindow
            windowStartSeconds={regulationTimeWindow[0]}
            windowSeconds={Math.max(0, regulationTimeWindow[1] - regulationTimeWindow[0])}
          />
        )}

        {trafficOverloadSegments.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <h4 className="font-medium text-sm opacity-90 mb-3">Traffic Volume Load</h4>
            <TrafficOverloadBar
              fromTime={formatTime(regulationTimeWindow[0])}
              toTime={formatTime(regulationTimeWindow[1])}
              data={trafficOverloadSegments}
              height={16}
              showTime
            />
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
          {currentAnchorCapacity !== null && (
            <div className="text-[10px] opacity-70 mt-1">
              Defaulted to anchor capacity (rolling hour): {Math.round(currentAnchorCapacity)}
            </div>
          )}
        </div>


        {/* Add Button */}
        <div className="flex justify-end">
          <button
            onClick={handlePreviewRegulation}
            disabled={!primaryTvId || selectedFlights.length === 0}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-medium shadow hover:opacity-90 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add
          </button>
        </div>
      </div>
      <FlightQueryDialog
        open={magicSearchOpen}
        onClose={() => setMagicSearchOpen(false)}
        flightIds={regulationListedFlightIds}
        sourceTrafficVolumeId={primaryTvId}
        onSelectFlights={(ids) => {
          const validatedIds = validateFlightIdsAgainstCurrentList(ids, "Add flights from query");
          if (!validatedIds) return;
          const next = new Set<string>(regulationTargetFlightIds);
          validatedIds.forEach((id) => next.add(String(id)));
          if (!areSetsEqual(next, regulationTargetFlightIds)) {
            setRegulationTargetFlightIds(next);
          }
          setSelectionError(null);
          setMagicSearchOpen(false);
        }}
        fullScreen
      />
      <FlightQueryDialog
        open={!!communityReviewContext}
        onClose={handleCloseCommunityReview}
        flightIds={communityReviewFlightIds}
        sourceTrafficVolumeId={primaryTvId}
        onSelectFlights={handleCommunityReviewSelection}
        highlightLabel={communityReviewLabels.highlight}
        baselineLabel={communityReviewLabels.baseline}
        fullScreen
      />
    </div>
  );
}

function CatcherButton(props: {
  title: string;
  active: boolean;
  onClick: () => void;
  kind: "include" | "exclude";
}) {
  const { title, active, onClick, kind } = props;
  const symbol = kind === "include" ? "+" : "−";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3 rounded-lg border text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? kind === "include"
            ? "border-emerald-300/60 bg-emerald-500/25 text-emerald-100"
            : "border-rose-300/60 bg-rose-500/25 text-rose-100"
          : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20"
      }`}
      title={title}
      aria-label={title}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 18 9 10 14 14 21 6" />
      </svg>
      <span className="text-base leading-none">{symbol}</span>
    </button>
  );
}

function FlowCommunitiesSection({ flowCommunities, flowGroups, flowColorByCommunity, communityHeuristics, flights, orderedFlightsData, selectedTrafficVolume, regulationTimeWindow, embedded, onReviewCommunity }: { flowCommunities: Record<string, number> | null; flowGroups: Record<string, string[]> | null; flowColorByCommunity: Record<string, string> | null; communityHeuristics: Record<string, CommunityHeuristicsSummary>; flights: any[]; orderedFlightsData: any | null; selectedTrafficVolume: string | null; regulationTimeWindow: [number, number]; embedded?: boolean; onReviewCommunity: (context: CommunityReviewContext) => void; }) {
  const { setFlowPreviewFlightId, setFlowPreviewGroupId, regulationTargetFlightIds, setRegulationTargetFlightIds } = useSimStore();
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [expandedFlightLists, setExpandedFlightLists] = useState<Record<string, boolean>>({});
  // Derive community sizes
  const groupEntries = useMemo(() => {
    if (flowGroups && Object.keys(flowGroups).length > 0) {
      return Object.entries(flowGroups).map(([cid, ids]) => ({ cid: String(cid), ids: (ids || []).map(String) }));
    }
    const byCid = new Map<string, string[]>();
    if (flowCommunities) {
      for (const [fid, cidAny] of Object.entries(flowCommunities)) {
        const cid = String(cidAny);
        const arr = byCid.get(cid) || [];
        arr.push(String(fid));
        byCid.set(cid, arr);
      }
    }
    return Array.from(byCid.entries()).map(([cid, ids]) => ({ cid, ids }));
  }, [flowGroups, flowCommunities]);

  // Sort communities by size desc and take top 10, excluding singletons
  const topGroups = useMemo(() => {
    return groupEntries
      .map(g => ({ ...g, size: (g.ids || []).length }))
      .filter(g => g.size > 1)
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
  }, [groupEntries]);

  useEffect(() => {
    if (!openMenuFor) return;
    if (!topGroups.some((g) => g.cid === openMenuFor)) {
      setOpenMenuFor(null);
    }
  }, [openMenuFor, topGroups]);

  useEffect(() => {
    setExpandedFlightLists((prev) => {
      const validIds = new Set(topGroups.map((g) => g.cid));
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (validIds.has(key)) {
          next[key] = value;
          continue;
        }
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [topGroups]);

  // Use centralized color mapping from the store; default gray for others
  const colorMap = useMemo(() => new Map<string, string>(Object.entries(flowColorByCommunity || {})), [flowColorByCommunity]);

  // Helper: lookup flight details by id
  const flightById = useMemo(() => {
    const m = new Map<string, any>();
    for (const f of flights || []) m.set(String(f.flightId), f);
    return m;
  }, [flights]);

  // Helper: lookup TV arrival time (HH:MM or HH:MM:SS) from orderedFlightsData
  const arrivalTimeById = useMemo(() => {
    const m = new Map<string, string>();
    const details = orderedFlightsData?.details || [];
    for (const d of details) {
      const fid = String(d.flight_id);
      const at = d.arrival_time || d.arrival || '';
      if (fid && at) m.set(fid, String(at));
    }
    return m;
  }, [orderedFlightsData]);

  const dwellSecondsById = useMemo(() => {
    const m = new Map<string, number | null>();
    const details = orderedFlightsData?.details || [];
    for (const d of details) {
      const fid = String(d.flight_id);
      if (!fid) continue;
      const dwell = typeof d.dwell_seconds === "number" && Number.isFinite(d.dwell_seconds)
        ? d.dwell_seconds
        : null;
      m.set(fid, dwell);
    }
    return m;
  }, [orderedFlightsData]);

  if (!topGroups || topGroups.length === 0) return null;

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
      <div className="font-medium text-sm opacity-90 mb-2">Top Communities</div>
      <div className={embedded ? "space-y-3" : "space-y-3 max-h-64 overflow-y-auto no-scrollbar"}>
        {topGroups.map((g) => {
          const statsFlightIds = g.ids.map((fid) => String(fid)).filter(Boolean);
          const heuristics = communityHeuristics[g.cid];
          const flightListOpen = expandedFlightLists[g.cid] ?? false;
          const heuristicFlightCount = heuristics?.flights ?? g.size;
          return (
            <div key={g.cid} className="border border-white/10 rounded-md">
              <div
                className="flex items-center justify-between px-2 py-1 bg-white/5 rounded-t-md"
                onMouseEnter={() => setFlowPreviewGroupId(String(g.cid))}
                onMouseLeave={() => setFlowPreviewGroupId(null)}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: colorMap.get(g.cid) || '#9ca3af' }} />
                  <span className="opacity-80">Community {g.cid}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[10px] opacity-70">{g.size} flights</div>
                  <FlightStatisticsButton
                    flightIds={statsFlightIds}
                    sourceTrafficVolumeId={selectedTrafficVolume}
                    buttonClassName="border-white/20 text-white/80"
                    ariaLabel={`Open flight statistics for community ${g.cid}`}
                    title="Open flight statistics"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFlightLists((prev) => ({ ...prev, [g.cid]: !(prev[g.cid] ?? false) }));
                    }}
                    type="button"
                    aria-label={flightListOpen ? "Hide flight list" : "Show flight list"}
                    title={flightListOpen ? "Hide flight list" : "Show flight list"}
                    className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${flightListOpen
                      ? 'border-blue-400 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                      : 'border-white/30 bg-white/10 text-white/80 hover:bg-white/15'}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <div className="relative inline-block text-[11px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuFor((prev) => (prev === g.cid ? null : g.cid));
                      }}
                      className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white/90 hover:bg-white/15 flex items-center gap-1"
                      title="Add this community to Targeted Flights"
                      aria-haspopup="menu"
                      aria-expanded={openMenuFor === g.cid}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" /></svg>
                      <span className="hidden sm:inline">Add</span>
                    </button>
                    {openMenuFor === g.cid && (
                      <div
                        className="absolute right-0 mt-1 w-44 bg-slate-900/95 border border-white/20 rounded-md shadow-lg z-20"
                        onClick={(e) => e.stopPropagation()}
                        role="menu"
                      >
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-white/10"
                          onClick={() => {
                            const next = new Set<string>(regulationTargetFlightIds);
                            for (const fid of g.ids || []) {
                              if (fid) next.add(String(fid));
                            }
                            if (!areSetsEqual(next, regulationTargetFlightIds)) {
                              setRegulationTargetFlightIds(next);
                            }
                            setOpenMenuFor(null);
                          }}
                          role="menuitem"
                        >
                          Add
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-white/10"
                          onClick={() => {
                            const uniqueIds = Array.from(new Set((g.ids || []).map((fid) => String(fid)).filter(Boolean)));
                            if (uniqueIds.length === 0) {
                              setOpenMenuFor(null);
                              return;
                            }
                            onReviewCommunity({
                              communityId: g.cid,
                              flightIds: uniqueIds,
                              label: `Community ${g.cid}`,
                            });
                            setOpenMenuFor(null);
                          }}
                          role="menuitem"
                        >
                          Review and Add
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="px-2 pt-2">
                <HourGlass
                  data={g.ids.map((fid) => arrivalTimeById.get(String(fid))).filter(Boolean) as string[]}
                  range={[formatTime(regulationTimeWindow[0]), formatTime(regulationTimeWindow[1])]}
                  height={12}
                />
              </div>
              <div className={`grid grid-cols-2 gap-x-6 gap-y-1.5 px-2 pt-2 text-[11px] ${flightListOpen ? "" : "pb-2"}`}>
                <div className="flex justify-between">
                  <span className="text-white/60">V:</span>
                  <span>{formatHeuristicMetric(heuristics?.vTilde)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Slack15:</span>
                  <span>{formatHeuristicMetric(heuristics?.slack15)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Slack30:</span>
                  <span>{formatHeuristicMetric(heuristics?.slack30)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">N. Flights:</span>
                  <span>{formatHeuristicMetric(heuristicFlightCount, 0)}</span>
                </div>
              </div>
              <div className={flightListOpen ? "px-2 pt-2" : "px-2 pt-2 pb-2"}>
                <MostVulnerableTvList
                  mvtv15={heuristics?.mvtv15 || []}
                  mvtv30={heuristics?.mvtv30 || []}
                />
              </div>
              {flightListOpen && (
                <div className={embedded ? "pt-2" : "max-h-40 overflow-y-auto no-scrollbar pt-2"}>
                  <div className="rounded-lg border border-white/10 overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-white/10">
                          <th className="text-left p-2 font-semibold">CS</th>
                          <th className="text-left p-2 font-semibold">Ori.</th>
                          <th className="text-left p-2 font-semibold">Des.</th>
                          <th className="text-left p-2 font-semibold">TV Arr.</th>
                          <th className="text-left p-2 font-semibold">Dwell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.ids.slice(0, 50).map((fid, idx) => {
                          const f = flightById.get(String(fid));
                          return (
                            <tr
                              key={String(fid)}
                              className={`border-t border-white/10 ${idx % 2 === 0 ? 'bg-white/0' : 'bg-white/5'} hover:bg-white/10 cursor-pointer`}
                              onMouseEnter={() => setFlowPreviewFlightId(String(fid))}
                              onMouseLeave={() => setFlowPreviewFlightId(null)}
                            >
                              <td className="p-2 font-mono">{f?.callSign || fid}</td>
                              <td className="p-2">{f?.origin || 'N/A'}</td>
                              <td className="p-2">{f?.destination || 'N/A'}</td>
                              <td className="p-2 text-right font-mono">{arrivalTimeById.get(String(fid)) || 'N/A'}</td>
                              <td className="p-2 text-right font-mono">{formatDwellingTime(dwellSecondsById.get(String(fid)) ?? null)}</td>
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
  );
}

function normalizeHeuristicValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value;
}

function normalizeMostVulnerableTvItems(value: unknown): MostVulnerableTvItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): MostVulnerableTvItem | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const tvIdRaw = candidate.traffic_volume_id;
      const traffic_volume_id = tvIdRaw == null ? null : String(tvIdRaw).trim() || null;
      const normalize = (input: unknown): number | null => {
        const num = Number(input);
        return Number.isFinite(num) ? num : null;
      };
      return {
        traffic_volume_id,
        time_bin: normalize(candidate.time_bin),
        slack: normalize(candidate.slack),
        rolling_hour_occupancy: normalize(candidate.rolling_hour_occupancy),
        capacity_per_bin: normalize(candidate.capacity_per_bin),
        demand15: normalize(candidate.demand15),
        demand30: normalize(candidate.demand30),
      };
    })
    .filter((item): item is MostVulnerableTvItem => Boolean(item));
}

function formatHeuristicMetric(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return value.toFixed(digits);
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parseTimeToSeconds(value: string): number {
  const parts = value.split(":").map((p) => Number(p));
  const hours = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minutes = Number.isFinite(parts[1]) ? parts[1] : 0;
  const seconds = Number.isFinite(parts[2]) ? parts[2] : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function inferTimeBinMinutesFromData(occupancyData: any): number {
  if (!occupancyData) return 60;
  const meta = occupancyData?.metadata?.time_bin_minutes;
  if (typeof meta === "number" && meta > 0) return meta;
  const entries = Object.keys(occupancyData?.occupancy_counts || {});
  if (entries.length === 0) return 60;
  try {
    const [range] = entries;
    const [startStr, endStr] = String(range).split("-");
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = (endStr || startStr).split(":").map(Number);
    const startMinutes = sh * 60 + sm;
    let endMinutes = eh * 60 + em;
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    const diff = endMinutes - startMinutes;
    return diff > 0 ? diff : 60;
  } catch {
    return 60;
  }
}

function anchorCapacityForTime(
  anchorCapacity: Record<string, number> | undefined,
  hourlyCapacity: Record<string, number> | undefined,
  t: number,
  timeBinMinutes?: number
): number | undefined {
  const binMinutes = typeof timeBinMinutes === "number" && timeBinMinutes > 0 ? timeBinMinutes : 60;
  const minutesPerDay = 24 * 60;
  const totalMinutes = Math.floor(t / 60) % minutesPerDay;
  const binStartMinutes = totalMinutes - (totalMinutes % binMinutes);
  const hours = Math.floor(binStartMinutes / 60);
  const minutes = binStartMinutes % 60;
  const anchorKey = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  const hourKey = `${hours.toString().padStart(2, "0")}:00-${(hours + 1).toString().padStart(2, "0")}:00`;
  return normalizeCapacity(anchorCapacity?.[anchorKey] ?? hourlyCapacity?.[hourKey]);
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

  const timeBinMinutes = inferTimeBinMinutesFromData(occupancyData);
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
          <p className="text-yellow-300">Anchor capacity: <span className="font-medium">{Math.round(d.capacity)}</span></p>
        )}
      </div>
    );
  }
  return null;
}

function RegMultiTooltip({
  active,
  payload,
  label,
  chartSeries,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  chartSeries: Array<{ tvId: string; countKey: string; capacityKey: string; color: string; isPrimary: boolean }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = (payload.find((entry) => entry?.payload)?.payload ?? null) as MergedMultiTvChartRow | null;
  if (!row) return null;

  return (
    <div className="bg-slate-800/90 backdrop-blur-sm border border-white/20 rounded-lg p-2 text-white text-sm space-y-1">
      <p className="font-medium">{label}</p>
      {chartSeries.map((series) => {
        const rawCount = row[series.countKey];
        const rawCapacity = row[series.capacityKey];
        const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : null;
        const capacity = typeof rawCapacity === "number" && Number.isFinite(rawCapacity) ? rawCapacity : null;
        if (count === null && capacity === null) return null;
        return (
          <div key={series.tvId} className="text-xs">
            <p className="font-medium" style={{ color: series.color }}>
              {series.tvId}{series.isPrimary ? " (Primary)" : ""}
            </p>
            <p>Occupancy: {count !== null ? Math.round(count) : "N/A"}</p>
            <p>Anchor capacity: {capacity !== null ? Math.round(capacity) : "N/A"}</p>
          </div>
        );
      })}
    </div>
  );
}

function computePresetForWindow(fromSeconds: number, toSeconds: number): string {
  const durationMinutes = Math.max(0, Math.round((toSeconds - fromSeconds) / 60));
  const candidates: Array<{ minutes: number; label: string }> = [
    { minutes: 15, label: "15" },
    { minutes: 30, label: "30" },
    { minutes: 45, label: "45" },
    { minutes: 60, label: "1h" },
    { minutes: 75, label: "1h15" },
    { minutes: 90, label: "1h30" },
    { minutes: 105, label: "1h45" },
    { minutes: 120, label: "2h" },
    { minutes: 150, label: "2h30" },
    { minutes: 180, label: "3h" },
    { minutes: 210, label: "3h30" },
    { minutes: 240, label: "4h" }
  ];
  // Exact match first
  const exact = candidates.find(c => c.minutes === durationMinutes);
  if (exact) return exact.label;
  // Otherwise pick the nearest preset for highlighting purposes
  let best = candidates[0];
  let bestDiff = Math.abs(durationMinutes - candidates[0].minutes);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(durationMinutes - candidates[i].minutes);
    if (diff < bestDiff) { best = candidates[i]; bestDiff = diff; }
  }
  return best.label;
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
