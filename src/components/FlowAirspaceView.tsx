"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ComposedChart, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line, ReferenceLine } from 'recharts';
import {
  useSimStore,
  type RegulationCatcherMode,
  type RegulationCatcherTimeframe,
} from "@/components/useSimStore";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import FlightLevelBinCountChart from "@/components/FlightLevelBinCountChart";
import PanelCloseButton from "@/components/PanelCloseButton";
import { authFetch } from "@/lib/auth";
import { normalizeCapacity } from "@/lib/capacity";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { toTimeWindow } from "@/lib/regulationProposals";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";
import FlightQueryDialog from "@/components/FlightQueryDialog";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";
import {
  assertReplayableRegulationTargets,
  normalizeRegulationContext,
} from "@/lib/regulationTargets";
import {
  compareIntersectionFlightRows,
  intersectStringSets,
  type FlightSortMetric,
} from "@/lib/airspaceInfoMultiTv";

type FlowAirspaceViewProps = { embedded?: boolean };
const MAX_VISIBLE = 20;
const MAX_FLIGHT_ROWS = 500;
const FLOW_CATCHER_TIMEFRAME_OPTIONS: Array<{ value: RegulationCatcherTimeframe; label: string }> = [
  { value: "15m", label: "15M" },
  { value: "30m", label: "30M" },
  { value: "45m", label: "45M" },
  { value: "1h", label: "1H" },
  { value: "2h", label: "2H" },
  { value: "3h", label: "3H" },
  { value: "4h", label: "4H" },
  { value: "all", label: "ALL" },
];

interface FlightIdentifiersData {
  [timeWindow: string]: string[];
}

interface OrderedFlightsData {
  traffic_volume_id: string;
  ref_time_str: string;
  ordered_flights: string[];
  details: {
    flight_id: string;
    arrival_time: string;
    arrival_seconds: number;
    delta_seconds: number;
    time_window: string;
    dwell_seconds?: number | null;
  }[];
}

type TvFlightsPayload =
  | { kind: "ordered"; data: OrderedFlightsData }
  | { kind: "legacy"; data: FlightIdentifiersData };

type TvFlightCell = {
  arrivalTime: string;
  dwellSeconds: number | null;
  arrivalSeconds: number | null;
  deltaSeconds: number | null;
  windowStartSeconds: number | null;
};

type FlightRow = {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  takeoffTime: string;
  perTv: Record<string, TvFlightCell>;
  sortMetric: FlightSortMetric;
};

export default function FlowAirspaceView({ embedded = false }: FlowAirspaceViewProps) {
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
    setRegulationVisibleFlightIds,
    regulationListedFlightIds,
    setRegulationListedFlightIds,
    regulationTargetFlightIds,
    clearRegulationTargetFlights,
    setRegulationTargetFlightIds,
    regulationCatcherMode,
    regulationCatcherTimeframe,
    regulationCatcherActive,
    setRegulationCatcherMode,
    setRegulationCatcherTimeframe,
    cancelRegulationCatcher,
    regulationTimeWindow,
    setRegulationTimeWindow,
    setRegulationRate,
    clearSelectedTrafficVolumes,
    setIsRegulationPanelOpen,
    regulationEditPayload,
    setRegulationEditPayload,
    fetchRegulationProposals,
    proposalLoading,
    // Flow view state/actions
    flowViewEnabled,
    flowThreshold,
    flowResolution,
    setFlowViewEnabled,
    setFlowCommunities,
    setFlowLoading,
    setFlowError,
    setFlowPreviewGroupId,
    setFlowPreviewFlightId,
    addFlowBasketWithPeriod,
    addTargetCells
  } = useSimStore();

  const deferredT = useDeferredValue(t);
  const currentContext = useMemo(
    () => normalizeRegulationContext({ resourceDate, resourceStateId: resourceStateSelectedId }),
    [resourceDate, resourceStateSelectedId],
  );

  const [inputValue, setInputValue] = useState("");
  const [queryDialogOpen, setQueryDialogOpen] = useState(false);
  const [queryInitialPrompt, setQueryInitialPrompt] = useState<string>("");
  const [activePreset, setActivePreset] = useState<string>("1h");
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [currentAnchorCapacity, setCurrentAnchorCapacity] = useState<number | null>(null);
  const [occupancyData, setOccupancyData] = useState<any | null>(null);
  const [flightIdentifiersData, setFlightIdentifiersData] = useState<FlightIdentifiersData | null>(null);
  const [orderedFlightsData, setOrderedFlightsData] = useState<OrderedFlightsData | null>(null);
  const [primaryFlightDataTvId, setPrimaryFlightDataTvId] = useState<string | null>(null);
  const [secondaryFlightDataByTv, setSecondaryFlightDataByTv] = useState<Record<string, TvFlightsPayload>>({});
  const [secondaryFlightListLoading, setSecondaryFlightListLoading] = useState(false);
  const [secondaryFlightListError, setSecondaryFlightListError] = useState<string | null>(null);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [proposalTriggerError, setProposalTriggerError] = useState<string | null>(null);
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
  const isMultiTv = selectedTvIds.length > 1;
  const flightLevelRange = formatFlightLevelRange(
    selectedTrafficVolumeData?.properties?.min_fl,
    selectedTrafficVolumeData?.properties?.max_fl
  );
  const regulationWindowFrom = regulationTimeWindow[0];
  const regulationWindowTo = regulationTimeWindow[1];
  // When applying an edit payload, suppress auto preset updates on time changes
  const suppressAutoPresetRef = useRef<boolean>(false);
  // Suppress applying preset side-effect once when we programmatically set activePreset
  const suppressNextPresetApplyRef = useRef<boolean>(false);
  const previousListContextKeyRef = useRef<string | null>(null);
  const previousListedFlightIdSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setOccupancyData(null);
    setFlightIdentifiersData(null);
    setOrderedFlightsData(null);
    setPrimaryFlightDataTvId(null);
    setSecondaryFlightDataByTv({});
    setSecondaryFlightListLoading(false);
    setSecondaryFlightListError(null);
    setFlightListLoading(false);
    setFlightListError(null);
    setExpanded(false);
    setProposalTriggerError(null);
    previousListContextKeyRef.current = null;
    previousListedFlightIdSetRef.current = new Set();
  }, [resourceStateEpoch]);

  // Load occupancy/capacity and default rate when TV changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedTrafficVolume) { setOccupancyData(null); return; }
      // If not editing, clear any previous target selection immediately to avoid race with async fetch
      if (!useSimStore.getState().regulationEditPayload) {
        clearRegulationTargetFlights();
      }
      try {
        const res = await authFetch(`/api/tv_count_with_capacity?traffic_volume_id=${selectedTrafficVolume}`);
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
  }, [resourceStateEpoch, selectedTrafficVolume]);

  // Load flight identifiers for this TV (ordered when possible)
  useEffect(() => {
    let cancelled = false;
    async function loadFlights() {
      if (!selectedTrafficVolume) {
        setFlightIdentifiersData(null);
        setOrderedFlightsData(null);
        setPrimaryFlightDataTvId(null);
        setFlightListLoading(false);
        setFlightListError(null);
        return;
      }
      setFlightListLoading(true);
      setFlightListError(null);
      setFlightIdentifiersData(null);
      setOrderedFlightsData(null);
      setPrimaryFlightDataTvId(null);
      try {
        const ref = formatTimeForAPI(t);
        const res = await authFetch(`/api/tv_flights?traffic_volume_id=${selectedTrafficVolume}&ref_time_str=${ref}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (cancelled) return;
        if (data.ordered_flights && data.details) {
          setOrderedFlightsData(data as OrderedFlightsData);
          setFlightIdentifiersData(null);
        } else {
          setFlightIdentifiersData(data as FlightIdentifiersData);
          setOrderedFlightsData(null);
        }
        setPrimaryFlightDataTvId(String(selectedTrafficVolume));
      } catch (e: any) {
        if (!cancelled) {
          setFlightListError(e?.message || 'Failed to fetch flight identifiers');
          setFlightIdentifiersData(null);
          setOrderedFlightsData(null);
          setPrimaryFlightDataTvId(null);
        }
      } finally {
        if (!cancelled) setFlightListLoading(false);
      }
    }
    loadFlights();
    return () => { cancelled = true; };
  }, [resourceStateEpoch, selectedTrafficVolume, t]);

  // Load secondary TV memberships/details to support multi-TV intersection rows
  useEffect(() => {
    let cancelled = false;
    async function loadSecondaryFlights() {
      if (!primaryTvId || secondaryTvIds.length === 0) {
        setSecondaryFlightDataByTv({});
        setSecondaryFlightListLoading(false);
        setSecondaryFlightListError(null);
        return;
      }

      setSecondaryFlightListLoading(true);
      setSecondaryFlightListError(null);
      setSecondaryFlightDataByTv({});

      try {
        const ref = formatTimeForAPI(t);
        const entries = await Promise.all(
          secondaryTvIds.map(async (tvId) => {
            const res = await authFetch(`/api/tv_flights?traffic_volume_id=${encodeURIComponent(tvId)}&ref_time_str=${encodeURIComponent(ref)}`);
            if (!res.ok) throw new Error(`Failed to fetch flights for ${tvId}`);
            const data = await res.json();
            const payload: TvFlightsPayload = data.ordered_flights && data.details
              ? { kind: "ordered", data: data as OrderedFlightsData }
              : { kind: "legacy", data: data as FlightIdentifiersData };
            return [tvId, payload] as const;
          }),
        );
        if (cancelled) return;
        setSecondaryFlightDataByTv(Object.fromEntries(entries));
      } catch (e: any) {
        if (!cancelled) {
          setSecondaryFlightListError(e?.message || "Failed to fetch intersecting flight data");
          setSecondaryFlightDataByTv({});
        }
      } finally {
        if (!cancelled) setSecondaryFlightListLoading(false);
      }
    }
    loadSecondaryFlights();
    return () => { cancelled = true; };
  }, [primaryTvId, resourceStateEpoch, selectedTvKey, secondaryTvIds, t]);

  // Clear single-flight preview on unmount
  useEffect(() => {
    return () => {
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
    };
  }, [setFlowPreviewGroupId, setFlowPreviewFlightId]);

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

  useEffect(() => {
    setProposalTriggerError(null);
  }, [selectedTvKey, regulationWindowFrom, regulationWindowTo]);

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
    }).sort((a,b) => a.hour - b.hour);
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
    const currentTime = deferredT;

    // Create symmetric range around current time for display,
    // using the full regulation window on each side of t
    const displayFrom = currentTime - windowDuration;
    const displayTo = currentTime + windowDuration;

    return chartData.filter(d => {
      const sec = d.hour * 3600;
      return sec >= displayFrom && sec <= displayTo;
    });
  }, [chartData, regulationTimeWindow, deferredT]);

  const trafficOverloadSegments = useMemo(() => {
    if (!chartData.length) return [];

    const [windowStart, windowEnd] = regulationTimeWindow;

    return chartData.reduce((acc: any[], point) => {
      const [rawStart = "", rawEnd = ""] = String(point.time || "").split('-');
      const startSeconds = parseTimeToSeconds(rawStart.trim());
      const endSeconds = parseTimeToSeconds((rawEnd || rawStart).trim());
      const intersectsWindow = endSeconds > windowStart && startSeconds < windowEnd;
      if (!intersectsWindow) return acc;

      const occupancy = Number(point.count ?? 0);
      const capacity = Number(point.capacity ?? 0);
      const ratio = capacity > 0 ? occupancy / capacity : 0;

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
        label: selectedTrafficVolume ? `${selectedTrafficVolume} load` : undefined,
      });
      return acc;
    }, [] as any[]);
  }, [chartData, regulationTimeWindow, selectedTrafficVolume]);

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

  const primaryFlightPayload = useMemo<TvFlightsPayload | null>(() => {
    if (!primaryTvId || primaryFlightDataTvId !== primaryTvId) return null;
    if (orderedFlightsData && orderedFlightsData.details) {
      return { kind: "ordered", data: orderedFlightsData };
    }
    if (flightIdentifiersData) {
      return { kind: "legacy", data: flightIdentifiersData };
    }
    return null;
  }, [primaryTvId, primaryFlightDataTvId, orderedFlightsData, flightIdentifiersData]);

  const hasPrimaryOrderedFlights = primaryFlightPayload?.kind === "ordered";
  const secondaryFlightDataReady = useMemo(
    () => secondaryTvIds.every((tvId) => Object.prototype.hasOwnProperty.call(secondaryFlightDataByTv, tvId)),
    [secondaryTvIds, secondaryFlightDataByTv],
  );
  const isFlightListLoading = flightListLoading || (secondaryTvIds.length > 0 && secondaryFlightListLoading);
  const effectiveFlightListError = flightListError || secondaryFlightListError;

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights || []) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  const { flightTableData, flightTableCount } = useMemo<{
    flightTableData: FlightRow[];
    flightTableCount: number;
  }>(() => {
    if (!primaryTvId) return { flightTableData: [], flightTableCount: 0 };
    if (effectiveFlightListError) return { flightTableData: [], flightTableCount: 0 };
    if (!primaryFlightPayload) return { flightTableData: [], flightTableCount: 0 };
    if (secondaryTvIds.length > 0 && !secondaryFlightDataReady) {
      return { flightTableData: [], flightTableCount: 0 };
    }

    const [from, to] = regulationTimeWindow;

    const buildPrimaryRows = (): FlightRow[] => {
      if (primaryFlightPayload.kind === "ordered") {
        return (primaryFlightPayload.data.details || [])
          .filter((detail) => typeof detail.arrival_seconds === "number" && detail.arrival_seconds >= from && detail.arrival_seconds <= to)
          .sort((a, b) => Math.abs(a.delta_seconds || 0) - Math.abs(b.delta_seconds || 0))
          .map((detail) => {
            const fid = String(detail.flight_id);
            const fullFlight = flightsById.get(fid);
            const arrivalSeconds = typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : (detail.arrival_time ? parseHHMMSSToSeconds(detail.arrival_time) : null);
            const deltaSeconds = typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null;
            const windowStartSeconds = parseTimeWindowStartSeconds(detail.time_window);
            const primaryCell: TvFlightCell = {
              arrivalTime: detail.arrival_time || "N/A",
              dwellSeconds: detail.dwell_seconds ?? null,
              arrivalSeconds,
              deltaSeconds,
              windowStartSeconds,
            };
            return {
              flightId: fid,
              callsign: fullFlight?.callSign || "N/A",
              origin: fullFlight?.origin || "N/A",
              destination: fullFlight?.destination || "N/A",
              takeoffTime: fullFlight ? formatTime(fullFlight.t0) : "N/A",
              perTv: { [primaryTvId]: primaryCell },
              sortMetric: {
                flightId: fid,
                perTv: {
                  [primaryTvId]: {
                    arrivalSeconds: primaryCell.arrivalSeconds,
                    deltaSeconds: primaryCell.deltaSeconds,
                    windowStartSeconds: primaryCell.windowStartSeconds,
                  },
                },
              },
            };
          });
      }

      const candidates: Array<{ flightId: string; windowStartSeconds: number | null }> = [];
      const seen = new Set<string>();
      for (const [timeWindow, ids] of Object.entries(primaryFlightPayload.data || {})) {
        const startSeconds = parseTimeWindowStartSeconds(timeWindow);
        if (startSeconds === null || startSeconds < from || startSeconds > to) continue;
        for (const rawId of ids || []) {
          const fid = String(rawId);
          if (!fid || seen.has(fid)) continue;
          seen.add(fid);
          candidates.push({ flightId: fid, windowStartSeconds: startSeconds });
        }
      }
      candidates.sort((a, b) => {
        const aStart = a.windowStartSeconds ?? Number.POSITIVE_INFINITY;
        const bStart = b.windowStartSeconds ?? Number.POSITIVE_INFINITY;
        if (aStart !== bStart) return aStart - bStart;
        return a.flightId.localeCompare(b.flightId);
      });

      return candidates.map((candidate) => {
        const fullFlight = flightsById.get(candidate.flightId);
        const primaryCell: TvFlightCell = {
          arrivalTime: "N/A",
          dwellSeconds: null,
          arrivalSeconds: null,
          deltaSeconds: null,
          windowStartSeconds: candidate.windowStartSeconds,
        };
        return {
          flightId: candidate.flightId,
          callsign: fullFlight?.callSign || "N/A",
          origin: fullFlight?.origin || "N/A",
          destination: fullFlight?.destination || "N/A",
          takeoffTime: fullFlight ? formatTime(fullFlight.t0) : "N/A",
          perTv: { [primaryTvId]: primaryCell },
          sortMetric: {
            flightId: candidate.flightId,
            perTv: {
              [primaryTvId]: {
                arrivalSeconds: null,
                deltaSeconds: null,
                windowStartSeconds: candidate.windowStartSeconds,
              },
            },
          },
        };
      });
    };

    const primaryRows = buildPrimaryRows();
    if (primaryRows.length === 0) return { flightTableData: [], flightTableCount: 0 };
    if (secondaryTvIds.length === 0) {
      return {
        flightTableData: primaryRows.slice(0, MAX_FLIGHT_ROWS),
        flightTableCount: primaryRows.length,
      };
    }

    const secondaryMembershipSets: Array<Set<string>> = [];
    const orderedDetailMapByTv: Record<string, Map<string, OrderedFlightsData["details"][number]>> = {};
    const legacyWindowStartByTv: Record<string, Map<string, number | null>> = {};

    for (const tvId of secondaryTvIds) {
      const payload = secondaryFlightDataByTv[tvId];
      if (!payload) return { flightTableData: [], flightTableCount: 0 };

      if (payload.kind === "ordered") {
        const membership = new Set<string>();
        for (const fid of payload.data.ordered_flights || []) membership.add(String(fid));
        if (membership.size === 0) {
          for (const detail of payload.data.details || []) membership.add(String(detail.flight_id));
        }
        secondaryMembershipSets.push(membership);

        const detailMap = new Map<string, OrderedFlightsData["details"][number]>();
        for (const detail of payload.data.details || []) {
          detailMap.set(String(detail.flight_id), detail);
        }
        orderedDetailMapByTv[tvId] = detailMap;
      } else {
        const membership = new Set<string>();
        const startMap = new Map<string, number | null>();
        for (const [timeWindow, ids] of Object.entries(payload.data || {})) {
          const startSeconds = parseTimeWindowStartSeconds(timeWindow);
          for (const rawId of ids || []) {
            const fid = String(rawId);
            membership.add(fid);
            if (!startMap.has(fid)) startMap.set(fid, startSeconds);
          }
        }
        secondaryMembershipSets.push(membership);
        legacyWindowStartByTv[tvId] = startMap;
      }
    }

    const primaryMembershipSet = new Set(primaryRows.map((row) => String(row.flightId)));
    const intersectionSet = intersectStringSets([primaryMembershipSet, ...secondaryMembershipSets]);

    const rows = primaryRows
      .filter((row) => intersectionSet.has(String(row.flightId)))
      .map((row) => {
        const nextPerTv: Record<string, TvFlightCell> = { ...row.perTv };
        const nextSortPerTv: FlightSortMetric["perTv"] = { ...row.sortMetric.perTv };

        for (const tvId of secondaryTvIds) {
          const payload = secondaryFlightDataByTv[tvId];
          if (!payload) continue;

          if (payload.kind === "ordered") {
            const detail = orderedDetailMapByTv[tvId]?.get(String(row.flightId));
            const arrivalSeconds = detail && typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : null;
            const deltaSeconds = detail && typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null;
            const windowStartSeconds = detail?.time_window ? parseTimeWindowStartSeconds(detail.time_window) : null;
            nextPerTv[tvId] = {
              arrivalTime: detail?.arrival_time || "N/A",
              dwellSeconds: detail?.dwell_seconds ?? null,
              arrivalSeconds,
              deltaSeconds,
              windowStartSeconds,
            };
            nextSortPerTv[tvId] = { arrivalSeconds, deltaSeconds, windowStartSeconds };
          } else {
            const windowStartSeconds = legacyWindowStartByTv[tvId]?.get(String(row.flightId)) ?? null;
            nextPerTv[tvId] = {
              arrivalTime: "N/A",
              dwellSeconds: null,
              arrivalSeconds: null,
              deltaSeconds: null,
              windowStartSeconds,
            };
            nextSortPerTv[tvId] = {
              arrivalSeconds: null,
              deltaSeconds: null,
              windowStartSeconds,
            };
          }
        }

        return {
          ...row,
          perTv: nextPerTv,
          sortMetric: {
            flightId: row.flightId,
            perTv: nextSortPerTv,
          },
        };
      });

    rows.sort((a, b) => compareIntersectionFlightRows(a.sortMetric, b.sortMetric, primaryTvId));
    return {
      flightTableData: rows.slice(0, MAX_FLIGHT_ROWS),
      flightTableCount: rows.length,
    };
  }, [
    primaryTvId,
    regulationTimeWindow,
    effectiveFlightListError,
    primaryFlightPayload,
    secondaryTvIds,
    secondaryFlightDataReady,
    secondaryFlightDataByTv,
    flightsById,
  ]);
  const summaryCurrentCount = isMultiTv ? flightTableCount : currentCount;

  const filteredFlightIds = useMemo(() => {
    return new Set(flightTableData.map((row) => String(row.flightId)));
  }, [flightTableData]);

  const listedFlightIds = useMemo(
    () => flightTableData.map((row) => String(row.flightId)).filter(Boolean),
    [flightTableData],
  );
  const listSelectionContextKey = `${selectedTvKey}|${regulationTimeWindow[0]}-${regulationTimeWindow[1]}`;
  const checkedListedFlightIds = useMemo(
    () => listedFlightIds.filter((id) => regulationTargetFlightIds.has(id)),
    [listedFlightIds, regulationTargetFlightIds],
  );
  const checkedListedFlightIdSet = useMemo(
    () => new Set(checkedListedFlightIds),
    [checkedListedFlightIds],
  );

  useEffect(() => {
    const listedSet = new Set(listedFlightIds);
    const prevContext = previousListContextKeyRef.current;
    const prevListedSet = previousListedFlightIdSetRef.current;
    const currentSelected = useSimStore.getState().regulationTargetFlightIds;

    let next = new Set<string>();
    if (primaryTvId && listedSet.size > 0) {
      if (prevContext !== listSelectionContextKey) {
        next = new Set(listedSet);
      } else {
        for (const id of listedSet) {
          if (!prevListedSet.has(id) || currentSelected.has(id)) {
            next.add(id);
          }
        }
      }
    }

    if (!areSetsEqual(currentSelected, next)) {
      setRegulationTargetFlightIds(next);
    }
    previousListContextKeyRef.current = listSelectionContextKey;
    previousListedFlightIdSetRef.current = listedSet;
  }, [listedFlightIds, listSelectionContextKey, primaryTvId, setRegulationTargetFlightIds]);

  useEffect(() => {
    if (primaryTvId) return;
    clearRegulationTargetFlights();
    cancelRegulationCatcher();
    previousListContextKeyRef.current = null;
    previousListedFlightIdSetRef.current = new Set();
  }, [primaryTvId, clearRegulationTargetFlights, cancelRegulationCatcher]);

  // Apply focus mode and ids to filter map to only those flights
  useEffect(() => {
    if (!primaryTvId) return;
    const currentIds = useSimStore.getState().focusFlightIds;
    const same = areSetsEqual(currentIds, filteredFlightIds);
    if (!same) setFocusFlightIds(filteredFlightIds);
    if (!focusMode) setFocusMode(true);
  }, [filteredFlightIds, primaryTvId, setFocusFlightIds, focusMode, setFocusMode]);

  // Arrival-time distribution for HourGlass (based on rows shown)
  const hourGlassData = useMemo(() => {
    if (!primaryTvId || flightTableData.length === 0) return [] as string[];
    const arr: string[] = [];
    for (const row of flightTableData) {
      const cell = row.perTv[primaryTvId];
      if (!cell) continue;
      if (cell.arrivalTime && cell.arrivalTime !== "N/A") {
        arr.push(String(cell.arrivalTime));
        continue;
      }
      if (typeof cell.windowStartSeconds === "number" && Number.isFinite(cell.windowStartSeconds)) {
        arr.push(formatTime(cell.windowStartSeconds));
      }
    }
    return arr;
  }, [primaryTvId, flightTableData]);

  // Derive visible rows and publish visible IDs for bulk actions (e.g., "all")
  const visibleRows = useMemo(() => {
    if (!flightTableData) return [] as typeof flightTableData;
    if (!expanded && flightTableData.length > MAX_VISIBLE) return flightTableData.slice(0, MAX_VISIBLE);
    return flightTableData;
  }, [flightTableData, expanded]);
  const hiddenFlightCount = Math.max(0, flightTableData.length - MAX_VISIBLE);

  useEffect(() => {
    const ids = visibleRows.map(r => String(r.flightId));
    setRegulationVisibleFlightIds(ids);
  }, [visibleRows, setRegulationVisibleFlightIds]);

  // Publish full list (not limited by UI expansion) for flow extraction
  useEffect(() => {
    const allIds = flightTableData.map(r => String(r.flightId));
    setRegulationListedFlightIds(allIds);
  }, [flightTableData, setRegulationListedFlightIds]);

  // Reset expansion when dataset changes
  useEffect(() => {
    setExpanded(false);
  }, [selectedTvKey, regulationWindowFrom, regulationWindowTo]);

  const canAddCheckedFlights = !!primaryTvId && checkedListedFlightIds.length > 0;

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

  const toggleCatcherMode = useCallback((mode: Exclude<RegulationCatcherMode, "off">) => {
    if (regulationCatcherMode === mode) {
      cancelRegulationCatcher();
      return;
    }
    setRegulationCatcherMode(mode);
  }, [regulationCatcherMode, cancelRegulationCatcher, setRegulationCatcherMode]);

  const toggleListedFlightInclusion = useCallback((flightId: string) => {
    const normalized = String(flightId ?? "").trim();
    if (!normalized) return;
    const current = useSimStore.getState().regulationTargetFlightIds;
    const next = new Set(current);
    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }
    setRegulationTargetFlightIds(next);
  }, [setRegulationTargetFlightIds]);

  const handleOpenQueryDialog = useCallback(() => {
    setQueryInitialPrompt(inputValue.trim());
    setQueryDialogOpen(true);
  }, [inputValue]);

  const addFlightIdsAsFlow = useCallback((ids: string[]) => {
    const unique = Array.from(new Set((ids || []).map(id => String(id).trim()).filter(Boolean)));
    if (unique.length === 0) return;
    if (!primaryTvId) return;
    const [fromSeconds, toSeconds] = regulationTimeWindow;
    const fromLabel = secondsToDayTimeString(fromSeconds);
    const toLabel = secondsToDayTimeString(toSeconds);
    const flowName = `TV ${primaryTvId} ${fromLabel}-${toLabel}`;
    try {
      addFlowBasketWithPeriod(flowName, unique, fromLabel, toLabel);
      addTargetCells([String(primaryTvId)], fromLabel, toLabel);
      setFlowError(null);
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "Failed to add flights to the flow basket.");
    }
  }, [addFlowBasketWithPeriod, addTargetCells, regulationTimeWindow, primaryTvId, setFlowError]);

  const handleFlightsSelectedFromQuery = useCallback((ids: string[]) => {
    setQueryDialogOpen(false);
    const allowed = new Set(listedFlightIds);
    const next = new Set<string>();
    for (const rawId of ids || []) {
      const id = String(rawId).trim();
      if (!id || !allowed.has(id)) continue;
      next.add(id);
    }
    setRegulationTargetFlightIds(next);
  }, [listedFlightIds, setRegulationTargetFlightIds]);

  const handleAddCheckedFlights = useCallback(() => {
    addFlightIdsAsFlow(checkedListedFlightIds);
  }, [addFlightIdsAsFlow, checkedListedFlightIds]);

  // Removed Add/preview regulation UI from Flow Regulation context

  // Flow Control: request community assignments for visible arrivals
  async function requestFlowExtraction() {
    if (!primaryTvId) return;
    const ids = Array.from(new Set((Array.isArray(regulationListedFlightIds) ? regulationListedFlightIds : []).map((id) => String(id)).filter(Boolean)));
    if (ids.length === 0) {
      setFlowCommunities(null, null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
      setFlowError(isMultiTv
        ? 'No intersecting flights available across selected traffic volumes.'
        : 'No flights available to extract flows.');
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
      const res = await authFetch(`/api/flow_extraction?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      // Expect data.communities: { flightId: communityId }, data.groups: { comId: [flightIds] }
      if (data && data.communities) {
        setFlowCommunities(data.communities, data.groups || null);
        setFlowViewEnabled(true);
      } else {
        setFlowCommunities(null, null);
        setFlowPreviewGroupId(null);
        setFlowPreviewFlightId(null);
        setFlowError('Flow extraction returned no communities.');
      }
    } catch (e: any) {
      setFlowCommunities(null, null);
      setFlowPreviewGroupId(null);
      setFlowPreviewFlightId(null);
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
      setFlowError(null);
    } catch (err) {
      setRegulationTargetFlightIds(new Set<string>());
      setFlowError(err instanceof Error ? err.message : "Failed to load regulation targets for editing.");
    }

    // Clear payload so it doesn't apply repeatedly
    setRegulationEditPayload(null);
  }, [regulationEditPayload, primaryTvId, currentContext, setRegulationTimeWindow, setRegulationRate, setRegulationTargetFlightIds, setRegulationEditPayload, setFlowError]);

  if (!primaryTvId || selectedTvIds.length === 0) return null;

  return (
    <div className={embedded
      ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"
      : "absolute top-20 right-4 z-50 w-[384px] max-h-[calc(100vh-6rem)] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-slate-900 text-white flex flex-col"}>
      <div className="flex items-center justify-between p-4 border-b border-white/20 flex-shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">
            {selectedTvIds.length > 1 ? `Reference TV (${selectedTvIds.length} selected)` : "Reference TV"}
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
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (selectedTvIds.length > 1) return;
                // Add selected traffic volumes to the FlowRegulationPanel and set the period
                const [from, to] = regulationTimeWindow;
                window.dispatchEvent(new CustomEvent('flow-regulation-add', {
                  detail: {
                    trafficVolumes: selectedTvIds,
                    trafficVolume: primaryTvId,
                    from,
                    to,
                  }
                }));
              }}
              disabled={selectedTvIds.length > 1}
              className={`h-7 w-7 flex items-center justify-center rounded-lg border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                selectedTvIds.length > 1
                  ? 'border-white/20 bg-white/10 text-white/50'
                  : 'border-white/30 bg-white/20 hover:bg-white/30'
              }`}
              title={selectedTvIds.length > 1 ? "Add to regulation is available only for a single selected TV" : "Add to regulation"}
            >
              <svg height="16" fill="currentColor" width="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <g>
                <line fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" x1="12" x2="12" y1="19" y2="5"/>
                <line fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" x1="5" x2="19" y1="12" y2="12"/>
                </g>
              </svg>
            </button>
            <button
              aria-label="Propose regulation bundles"
              type="button"
              onClick={async () => {
                if (!primaryTvId || selectedTvIds.length > 1) return;
                const [from, to] = regulationTimeWindow;
                if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
                  setProposalTriggerError('Invalid time window; end must be after start.');
                  return;
                }
                setProposalTriggerError(null);
                const fromHHMM = secondsToDayTimeString(from);
                const toHHMM = secondsToDayTimeString(to);
                await fetchRegulationProposals({
                  trafficVolumeId: String(primaryTvId),
                  timeWindow: toTimeWindow(fromHHMM, toHHMM),
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
                    <polygon points="13,23 11,23 11,13.7 3,18.4 2,16.6 10,12 2,7.4 3,5.6 11,10.3 11,1 13,1 13,10.3 21,5.6 22,7.4 14,12 22,16.6 
                      21,18.4 13,13.7 		"/>
                  </g>
                </g>
              </svg>
            </button>
            <PanelCloseButton
              onClick={() => {
                clearSelectedTrafficVolumes();
                setFocusMode(false);
                setFocusFlightIds(new Set());
                clearRegulationTargetFlights();
                cancelRegulationCatcher();
                setIsRegulationPanelOpen(false);
                // Ensure Flow View is deactivated when panel closes
                setFlowViewEnabled(false);
                setFlowCommunities(null, null);
                setFlowError(null);
                setFlowPreviewGroupId(null);
                setFlowPreviewFlightId(null);
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
            <div className="text-xs opacity-70">{isMultiTv ? "Intersection Count" : "Current Count"}</div>
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

        {/* Flow Control removed for Flow Regulation page */}

        {/* Flow Communities (top 10 by size) removed for Flow Regulation page */}

        {/* Predicate input removed; Flight List added below */}

        {/* Flight List (like AirspaceInfo) */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
              <h4 className="font-medium text-sm opacity-90">List ({flightTableCount} flights)</h4>
              <FlightStatisticsButton
                flightIds={flightTableData.map((flight) => flight.flightId)}
                sourceTrafficVolumeId={primaryTvId}
                buttonClassName="border-white/20 text-white/80"
              />
              <button
                type="button"
                onClick={handleAddCheckedFlights}
                disabled={!canAddCheckedFlights}
                className="h-6 w-6 flex items-center justify-center rounded-md border border-white/20 text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                title={canAddCheckedFlights ? "Add checked flights to Flow Basket" : "No checked flights to add"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/70 ml-2">
                {checkedListedFlightIds.length} / {listedFlightIds.length}
              </span>
              <span className="text-xs bg-blue-500/20 text-blue-200 px-2 py-1 rounded border border-blue-400/30">
                {formatTime(regulationTimeWindow[0])}–{formatTime(regulationTimeWindow[1])}
              </span>
            </div>
          </div>
          <div className="bg-white/10 border border-white/10 rounded-lg p-2 mb-3">
            <div className="relative flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleOpenQueryDialog();
                  }
                }}
                placeholder="Describe flights to query"
                className="w-full px-3 py-2 pr-12 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
              />
              <button
                type="button"
                onClick={handleOpenQueryDialog}
                className="absolute inset-y-0 right-2 flex items-center justify-center text-gray-300 hover:text-white"
                title="Open flight query"
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
                  aria-hidden="true"
                >
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </button>
            </div>
            <p className="text-[11px] opacity-70 mt-2">
              NLP and catcher actions only affect this listed TV baseline. Gate eligibility freezes at first click, and only checked flights are added to the Flow Basket.
            </p>
            <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
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
                {FLOW_CATCHER_TIMEFRAME_OPTIONS.map((option) => (
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
                  : "Choose a catcher mode, then draw to check/uncheck flights visible at gate start within this TV baseline list."}
              </p>
            </div>
          </div>
          {hourGlassData.length > 0 && (
            <HourGlass data={hourGlassData} label height={12} className="my-2" />
          )}

          {isFlightListLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
              <span className="ml-2 text-xs opacity-70">Loading flights...</span>
            </div>
          )}

          {effectiveFlightListError && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3">
              <p className="text-xs text-red-200">Error: {effectiveFlightListError}</p>
            </div>
          )}

          {flightTableData.length > 0 && !isFlightListLoading && (
            <>
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/10">
                      <th className="text-center p-2 font-semibold w-8">
                        <button
                          type="button"
                          className="w-full h-full text-center hover:text-white transition-colors"
                          onClick={() => {
                            const next = new Set<string>(useSimStore.getState().regulationTargetFlightIds);
                            const allChecked = listedFlightIds.length > 0 && listedFlightIds.every((id) => next.has(id));
                            if (allChecked) {
                              for (const id of listedFlightIds) next.delete(id);
                            } else {
                              for (const id of listedFlightIds) next.add(id);
                            }
                            setRegulationTargetFlightIds(next);
                          }}
                          title={listedFlightIds.length > 0 && listedFlightIds.every((id) => checkedListedFlightIdSet.has(id))
                            ? "Uncheck all listed flights"
                            : "Check all listed flights"}
                          aria-label={listedFlightIds.length > 0 && listedFlightIds.every((id) => checkedListedFlightIdSet.has(id))
                            ? "Uncheck all listed flights"
                            : "Check all listed flights"}
                        >
                          ✓
                        </button>
                      </th>
                      <th className="text-left p-2 font-semibold">CS</th>
                      <th className="text-left p-2 font-semibold">Ori.</th>
                      <th className="text-left p-2 font-semibold">Des.</th>
                      <th className="text-left p-2 font-semibold">T/O</th>
                      {selectedTvIds.map((tvId) => ([
                        <th key={`${tvId}-arr`} className="text-left p-2 font-semibold whitespace-nowrap">
                          {selectedTvIds.length === 1 ? "TV Arr." : `${tvId} Arr.`}
                        </th>,
                        <th key={`${tvId}-dwell`} className="text-left p-2 font-semibold whitespace-nowrap">
                          {selectedTvIds.length === 1 ? "Dwell" : `${tvId} Dwell`}
                        </th>,
                      ]))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((flight, index) => {
                      const flightId = String(flight.flightId);
                      const isChecked = checkedListedFlightIdSet.has(flightId);
                      const baseRowColor = index % 2 === 0 ? "bg-white/0" : "bg-white/5";
                      const selectedRowColor = isChecked ? baseRowColor : "bg-rose-500/15";
                      return (
                        <tr
                          key={flightId}
                          className={`border-t border-white/10 ${selectedRowColor} ${isChecked ? "hover:bg-white/10" : "hover:bg-rose-500/25"} cursor-pointer`}
                          onMouseEnter={() => setFlowPreviewFlightId(flightId)}
                          onMouseLeave={() => setFlowPreviewFlightId(null)}
                          onClick={() => toggleListedFlightInclusion(flightId)}
                        >
                          <td className="p-2 text-center w-8">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleListedFlightInclusion(flightId)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 cursor-pointer rounded border border-white/40 bg-white/10 accent-blue-400"
                              aria-label={`${isChecked ? "Uncheck" : "Check"} flight ${flight.callsign}`}
                            />
                          </td>
                          <td className={`p-2 font-mono ${isChecked ? "" : "text-white/60 line-through"}`}>{flight.callsign}</td>
                          <td className={`p-2 ${isChecked ? "" : "text-white/60 line-through"}`}>{flight.origin}</td>
                          <td className={`p-2 ${isChecked ? "" : "text-white/60 line-through"}`}>{flight.destination}</td>
                          <td className={`p-2 text-right font-mono ${isChecked ? "" : "text-white/60 line-through"}`}>{flight.takeoffTime}</td>
                          {selectedTvIds.map((tvId) => {
                            const cell = flight.perTv[tvId];
                            return [
                              <td key={`${flightId}-${tvId}-arr`} className={`p-2 text-right font-mono ${isChecked ? "" : "text-white/60 line-through"}`}>
                                {cell?.arrivalTime || "N/A"}
                              </td>,
                              <td key={`${flightId}-${tvId}-dwell`} className={`p-2 text-right font-mono ${isChecked ? "" : "text-white/60 line-through"}`}>
                                {formatDwellingTime(cell?.dwellSeconds ?? null)}
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                    {flightTableData.length > MAX_VISIBLE && (
                      <tr
                        className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                        onClick={() => setExpanded(!expanded)}
                      >
                        <td
                          className="p-2 text-center italic opacity-80"
                          colSpan={5 + (selectedTvIds.length * 2)}
                        >
                          {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenFlightCount)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {flightTableCount > MAX_FLIGHT_ROWS && (
                <p className="text-xs opacity-70 text-center mt-2">Showing first 500 flights</p>
              )}
              {hasPrimaryOrderedFlights && (
                <p className="text-xs opacity-70 text-center mt-2">Flights ordered by proximity to current time ({formatTime(t)})</p>
              )}
            </>
          )}

          {flightTableData.length === 0 && !isFlightListLoading && !effectiveFlightListError && (
            <p className="text-xs opacity-70 text-center py-4">
              {isMultiTv ? "No intersecting flights found for this window" : "No flights found for this window"}
            </p>
          )}
        </div>

        {/* Histogram (Focus Mode style) */}
        {displayChartData.length > 0 && (
          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm opacity-90">Rolling Hour Occupancy Count</h4>
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
                  <Line type="linear" dataKey="capacity" stroke="#fbbf24" strokeWidth={2} dot={false} connectNulls={false} name="Anchor capacity (rolling hour)" isAnimationActive={false} />
                  <ReferenceLine x={nearestCategoryForTime(displayChartData, t)} stroke="#ef4444" strokeWidth={2} strokeDasharray="0" label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center space-x-4 mt-2 text-xs opacity-70">
              <div className="flex items-center"><div className="w-3 h-3 bg-cyan-500 rounded mr-1"></div><span>Occupancy Count</span></div>
              <div className="flex items-center"><div className="w-3 h-0.5 bg-yellow-400 mr-1"></div><span>Capacity</span></div>
            </div>
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

        {/* Rate and Add removed for Flow Regulation */}
      </div>
      <FlightQueryDialog
        open={queryDialogOpen}
        onClose={() => setQueryDialogOpen(false)}
        initialPrompt={queryInitialPrompt}
        flightIds={listedFlightIds}
        onSelectFlights={handleFlightsSelectedFromQuery}
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

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

function secondsToDayTimeString(seconds: number): string {
  const day = 24 * 3600;
  const normalized = ((Math.floor(seconds) % day) + day) % day;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
}

function parseTimeToSeconds(value: string): number {
  const parts = value.split(":").map((p) => Number(p));
  const hours = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minutes = Number.isFinite(parts[1]) ? parts[1] : 0;
  const seconds = Number.isFinite(parts[2]) ? parts[2] : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseHHMMSSToSeconds(value: string): number | null {
  const match = String(value || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const s = Number.parseInt(match[3] || "0", 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

function parseTimeWindowStartSeconds(timeWindow: string): number | null {
  try {
    const [start = ""] = String(timeWindow || "").split("-");
    const [h = 0, m = 0] = start.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 3600 + m * 60;
  } catch {
    return null;
  }
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
