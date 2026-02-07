"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useSimStore } from "./useSimStore";
import TrafficVolumeInfoTooltip from "./TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "./TrafficOverloadBar";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
  Line,
} from "recharts";
import { Trajectory } from "@/lib/models";
import { authFetch } from "@/lib/auth";
import { normalizeCapacity } from "@/lib/capacity";
import { binIndexToRangeLabel } from "@/lib/time";

interface FlightListStatisticsProps {
  flightIds: string[];
  baselineFlightIds?: string[];
  metadata?: Record<string, any> | null;
  className?: string;
  highlightLabel?: string;
  baselineLabel?: string;
  show_occupancy_charts?: boolean;
}

type AirportSlice = {
  name: string;
  value: number;
  percent: number;
  isOthers?: boolean;
};

type PieData = {
  slices: AirportSlice[];
  total: number;
  primarySum: number;
  limitApplied: number;
};

type AirportTotalRow = {
  airport: string;
  originCount: number;
  destinationCount: number;
  total: number;
};

type TakeoffHourRow = {
  hour: number;
  label: string;
  flights: number;
};

type RouteRow = {
  origin: string;
  destination: string;
  count: number;
};

type DurationStats = {
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  count: number;
};

type LongestFlightInfo = {
  id: string;
  callSign?: string;
  origin: string;
  destination: string;
  duration: number;
};

// New integrated response for total vs flight list contribution counts
type ContribCountsResponse = {
  time_bin_minutes?: number;
  timebins?: { labels?: string[]; start_bin?: number; end_bin?: number };
  total_counts?: Record<string, number[]>;
  flight_list_counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  metadata?: (Record<string, any> & {
    ranked_tv_ids?: string[];
    missing_flight_ids?: string[];
  }) | null;
};

type TrafficVolumesState = {
  loading: boolean;
  error: string | null;
  ids: string[];
  metadata: Record<string, any> | null;
};

type ContribCountsState = {
  loading: boolean;
  error: string | null;
  data: ContribCountsResponse | null;
};

type TvOccupancyRow = {
  idx: number;
  label: string;
  labelShort: string;
  startMinute: number;
  selected: number;
  other: number;
  total: number;
  capacity: number | null;
};

type TvOccupancyMetrics = {
  totalSum: number;
  selectedSum: number;
  share: number;
  exceedance: number;
  peakTotal: number;
  peakSelected: number;
};

type TvOccupancyCard = {
  tvId: string;
  rows: TvOccupancyRow[];
  metrics: TvOccupancyMetrics;
  hasCapacity: boolean;
};

type TvOccupancyComputation = {
  list: TvOccupancyCard[];
  map: Map<string, TvOccupancyCard>;
  minutesPerBin: number;
  startBin: number;
  labelCount: number;
  minutesMismatch: boolean;
};

export interface FlightListAnalysis {
  selectedFlights: Trajectory[];
  requestedUniqueCount: number;
  missingCount: number;
  missingIds: string[];
  uniqueOrigins: number;
  uniqueDestinations: number;
  earliestTakeoff: number | null;
  latestTakeoff: number | null;
  takeoffKnown: number;
  topOrigins: PieData;
  topDestinations: PieData;
  airportTotals: AirportTotalRow[];
  takeoffByHour: TakeoffHourRow[];
  durations: DurationStats;
  routeRows: RouteRow[];
  routeCount: number;
  busiestTakeoffHour: TakeoffHourRow | null;
  longestFlight: LongestFlightInfo | null;
}

const PIE_COLORS = [
  "#60a5fa",
  "#a855f7",
  "#38bdf8",
  "#f97316",
  "#22c55e",
  "#facc15",
  "#f472b6",
  "#94a3b8",
  "#14b8a6",
  "#ef4444",
  "#c084fc",
  "#f59e0b",
];

const ORIGIN_BAR_COLOR = "#38bdf8";
const DESTINATION_BAR_COLOR = "#f97316";
const TV_PAGE_SIZE = 20;

const EMPTY_ANALYSIS: FlightListAnalysis = {
  selectedFlights: [],
  requestedUniqueCount: 0,
  missingCount: 0,
  missingIds: [],
  uniqueOrigins: 0,
  uniqueDestinations: 0,
  earliestTakeoff: null,
  latestTakeoff: null,
  takeoffKnown: 0,
  topOrigins: { slices: [], total: 0, primarySum: 0, limitApplied: 0 },
  topDestinations: { slices: [], total: 0, primarySum: 0, limitApplied: 0 },
  airportTotals: [],
  takeoffByHour: [],
  durations: { average: null, median: null, min: null, max: null, count: 0 },
  routeRows: [],
  routeCount: 0,
  busiestTakeoffHour: null,
  longestFlight: null,
};

export function buildAnalysisForFlightIds(
  flights: Trajectory[],
  rawIds: string[] | null | undefined
): FlightListAnalysis {
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return EMPTY_ANALYSIS;
  }

  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const raw of rawIds) {
    if (raw === undefined || raw === null) continue;
    const normalized = String(raw).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    orderedIds.push(normalized);
  }

  if (orderedIds.length === 0) {
    return EMPTY_ANALYSIS;
  }

  const byId = new Map<string, Trajectory>();
  for (const flight of flights) {
    byId.set(String(flight.flightId), flight);
  }

  const selectedFlights: Trajectory[] = [];
  const missingIds: string[] = [];
  for (const id of orderedIds) {
    const flight = byId.get(id);
    if (flight) {
      selectedFlights.push(flight);
    } else {
      missingIds.push(id);
    }
  }

  if (selectedFlights.length === 0) {
    return {
      ...EMPTY_ANALYSIS,
      requestedUniqueCount: orderedIds.length,
      missingCount: missingIds.length,
      missingIds,
    };
  }

  const originCounts = new Map<string, number>();
  const destinationCounts = new Map<string, number>();
  const routeCounts = new Map<string, RouteRow>();
  const takeoffHistogram = Array.from({ length: 24 }, () => 0);

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let takeoffKnown = 0;

  const durations: number[] = [];
  let totalDuration = 0;
  let minDuration = Number.POSITIVE_INFINITY;
  let maxDuration = Number.NEGATIVE_INFINITY;
  let longestFlight: LongestFlightInfo | null = null;

  for (const flight of selectedFlights) {
    const origin = normalizeAirport(flight.origin);
    const destination = normalizeAirport(flight.destination);

    originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);
    destinationCounts.set(destination, (destinationCounts.get(destination) ?? 0) + 1);

    const routeKey = `${origin}→${destination}`;
    const existingRoute = routeCounts.get(routeKey);
    if (existingRoute) {
      existingRoute.count += 1;
    } else {
      routeCounts.set(routeKey, {
        origin,
        destination,
        count: 1,
      });
    }

    const t0 = Number(flight.t0);
    if (Number.isFinite(t0)) {
      takeoffKnown += 1;
      if (t0 < earliest) earliest = t0;
      if (t0 > latest) latest = t0;
      const hourIdx = clampHour(Math.floor(t0 / 3600));
      takeoffHistogram[hourIdx] += 1;
    }

    const t1 = Number(flight.t1);
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) {
      const duration = t1 - t0;
      durations.push(duration);
      totalDuration += duration;
      if (duration < minDuration) minDuration = duration;
      if (duration > maxDuration) {
        maxDuration = duration;
        longestFlight = {
          id: String(flight.flightId),
          callSign: sanitizeCallSign(flight.callSign),
          origin,
          destination,
          duration,
        };
      }
    }
  }

  const topOrigins = createPieData(originCounts);
  const topDestinations = createPieData(destinationCounts);
  const airportTotals = createAirportTotals(originCounts, destinationCounts);
  const takeoffByHour = takeoffHistogram.map((count, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    flights: count,
  }));
  const busiestTakeoffHour = takeoffByHour.reduce<TakeoffHourRow | null>((acc, row) => {
    if (row.flights === 0) return acc;
    if (!acc || row.flights > acc.flights) return row;
    return acc;
  }, null);

  const durationCount = durations.length;
  const averageDuration = durationCount > 0 ? totalDuration / durationCount : null;
  const sortedDurations = durationCount > 0 ? [...durations].sort((a, b) => a - b) : [];
  const medianDuration = durationCount > 0
    ? durationCount % 2 === 1
      ? sortedDurations[(durationCount - 1) / 2]
      : (sortedDurations[durationCount / 2 - 1] + sortedDurations[durationCount / 2]) / 2
    : null;

  const routeRows = Array.from(routeCounts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.origin !== b.origin) return a.origin.localeCompare(b.origin);
      return a.destination.localeCompare(b.destination);
    });

  return {
    selectedFlights,
    requestedUniqueCount: orderedIds.length,
    missingCount: missingIds.length,
    missingIds,
    uniqueOrigins: originCounts.size,
    uniqueDestinations: destinationCounts.size,
    earliestTakeoff: Number.isFinite(earliest) ? earliest : null,
    latestTakeoff: Number.isFinite(latest) ? latest : null,
    takeoffKnown,
    topOrigins,
    topDestinations,
    airportTotals,
    takeoffByHour,
    durations: {
      average: averageDuration,
      median: medianDuration,
      min: durationCount > 0 ? minDuration : null,
      max: durationCount > 0 ? maxDuration : null,
      count: durationCount,
    },
    routeRows,
    routeCount: routeCounts.size,
    busiestTakeoffHour,
    longestFlight,
  };
}

export default memo(FlightListStatistics);

type MetadataItem = { label: string; value: string; helper?: string };

function buildMetadataItems(metadata: Record<string, any> | null | undefined): MetadataItem[] {
  if (!metadata) return [];
  const items: MetadataItem[] = [];

  const totalMatches = metadata.total_matches ?? metadata.totalMatches;
  const totalMatchesNumber = Number(totalMatches);
  const hasTotalMatches = Number.isFinite(totalMatchesNumber);
  if (hasTotalMatches) {
    items.push({ label: "Total matches", value: formatCount(totalMatchesNumber) });
  }

  const resultSize = metadata.result_size ?? metadata.resultSize;
  const resultSizeNumber = Number(resultSize);
  if (Number.isFinite(resultSizeNumber) && (!hasTotalMatches || resultSizeNumber !== totalMatchesNumber)) {
    items.push({ label: "Result size", value: formatCount(resultSizeNumber) });
  }

  const evaluationMs = metadata.evaluation_ms ?? metadata.evaluationMs;
  if (Number.isFinite(evaluationMs)) {
    items.push({ label: "Evaluation time", value: `${formatNumber(Number(evaluationMs))} ms` });
  }

  const timeBinMinutes = metadata.time_bin_minutes ?? metadata.timeBinMinutes;
  if (Number.isFinite(timeBinMinutes)) {
    items.push({ label: "Time bin", value: `${formatNumber(Number(timeBinMinutes))} min` });
  }

  const nodeCacheHits = metadata.node_cache_hits ?? metadata.nodeCacheHits;
  if (Number.isFinite(nodeCacheHits)) {
    items.push({ label: "Cache hits", value: formatCount(Number(nodeCacheHits)) });
  }

  return items;
}

function FlightListStatistics({
  flightIds,
  baselineFlightIds,
  metadata,
  className,
  highlightLabel = "Flight list",
  baselineLabel = "Baseline",
  show_occupancy_charts: showOccupancyCharts = true,
}: FlightListStatisticsProps) {
  const flights = useSimStore(state => state.flights);

  const analysis = useMemo<FlightListAnalysis>(() => buildAnalysisForFlightIds(flights, flightIds), [flights, flightIds]);

  const selectedFlightIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const flight of analysis.selectedFlights) {
      const id = String(flight.flightId ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    ids.sort();
    return ids;
  }, [analysis.selectedFlights]);

  const baselineAnalysis = useMemo<FlightListAnalysis | null>(() => {
    if (!baselineFlightIds || baselineFlightIds.length === 0) return null;
    return buildAnalysisForFlightIds(flights, baselineFlightIds);
  }, [baselineFlightIds, flights]);

  const metadataItems = useMemo(() => buildMetadataItems(metadata), [metadata]);
  const metadataLine = useMemo(() => {
    if (metadataItems.length === 0) return "";
    return metadataItems
      .map(item => {
        const base = `${item.label}: ${item.value}`;
        return item.helper ? `${base} (${item.helper})` : base;
      })
      .join(" · ");
  }, [metadataItems]);
  const baselineCount = baselineAnalysis?.selectedFlights.length ?? 0;
  const baselineAvailable = Boolean(baselineAnalysis && baselineCount > 0);
  const baselineShare = baselineAvailable && baselineCount > 0 ? analysis.selectedFlights.length / baselineCount : null;

  const [trafficState, setTrafficState] = useState<TrafficVolumesState>({
    loading: false,
    error: null,
    ids: [],
    metadata: null,
  });
  const [contribCountsState, setContribCountsState] = useState<ContribCountsState>({ loading: false, error: null, data: null });
  const [selectedTrafficVolumes, setSelectedTrafficVolumes] = useState<string[]>([]);
  const [rankMode, setRankMode] = useState<
    "flight_list_count" | "flight_list_relative" | "exceedance" | "peak_selected" | "total_peak"
  >("flight_list_count");
  const [rankByParam, setRankByParam] = useState<
    "total_count" | "total_excess" | "flight_list_count" | "flight_list_relative"
  >("total_count");
  const [visibleTvCount, setVisibleTvCount] = useState<number>(TV_PAGE_SIZE);

  const commonTrafficVolumes = useMemo(() => trafficState.ids, [trafficState.ids]);
  const trafficOptions = useMemo<ChipOption[]>(() => commonTrafficVolumes.map(id => ({ id, label: id })), [commonTrafficVolumes]);

  useEffect(() => {
    if (!showOccupancyCharts) {
      setTrafficState({ loading: false, error: null, ids: [], metadata: null });
      setContribCountsState({ loading: false, error: null, data: null });
      return;
    }
    if (selectedFlightIds.length === 0) {
      setTrafficState({ loading: false, error: null, ids: [], metadata: null });
      setContribCountsState({ loading: false, error: null, data: null });
      return;
    }
    let cancelled = false;
    setTrafficState(prev => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const res = await authFetch("/api/common_traffic_volumes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flight_ids: selectedFlightIds }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch common traffic volumes (${res.status})`);
        }
        const json = await res.json();
        const ids = Array.isArray(json?.traffic_volumes)
          ? (json.traffic_volumes as any[]).map(v => String(v)).filter(Boolean)
          : [];
        setTrafficState({
          loading: false,
          error: null,
          ids,
          metadata: (json?.metadata ?? null) as Record<string, any> | null,
        });
      } catch (err: any) {
        if (cancelled) return;
        setTrafficState({
          loading: false,
          error: err?.message || "Failed to load common traffic volumes",
          ids: [],
          metadata: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFlightIds, showOccupancyCharts]);

  useEffect(() => {
    if (!showOccupancyCharts) return;
    if (selectedTrafficVolumes.length === 0) return;
    const allowed = new Set(commonTrafficVolumes);
    if (selectedTrafficVolumes.some(id => !allowed.has(id))) {
      setSelectedTrafficVolumes(prev => prev.filter(id => allowed.has(id)));
    }
  }, [showOccupancyCharts, commonTrafficVolumes, selectedTrafficVolumes]);

  useEffect(() => {
    if (!showOccupancyCharts) {
      setContribCountsState({ loading: false, error: null, data: null });
      return;
    }
    if (selectedFlightIds.length === 0) {
      setContribCountsState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;

    const payload: Record<string, any> = {
      flight_ids: selectedFlightIds,
      rank_by: rankByParam,
      rolling_hour: true,
    };
    // Optional focus filter: only include if user selected at least one TV
    if (selectedTrafficVolumes.length > 0) {
      payload.traffic_volume_ids = selectedTrafficVolumes;
    }

    setContribCountsState(prev => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const res = await authFetch("/api/original_flight_contrib_counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch contribution counts (${res.status})`);
        }
        const json = await res.json();
        if (cancelled) return;
        setContribCountsState({ loading: false, error: null, data: json as ContribCountsResponse });
      } catch (err: any) {
        if (cancelled) return;
        setContribCountsState({
          loading: false,
          error: err?.message || "Failed to load contribution occupancy",
          data: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFlightIds, selectedTrafficVolumes, rankByParam, showOccupancyCharts]);

  const countsLoading = trafficState.loading || contribCountsState.loading;
  const countsError = contribCountsState.error;
  const missingFlightIds = useMemo(() => (
    Array.isArray(contribCountsState.data?.metadata?.missing_flight_ids)
      ? (contribCountsState.data?.metadata?.missing_flight_ids as string[])
      : []
  ), [contribCountsState.data?.metadata?.missing_flight_ids]);

  const occupancyComputation = useMemo<TvOccupancyComputation>(() => {
    if (!showOccupancyCharts) {
      return { list: [], map: new Map<string, TvOccupancyCard>(), minutesPerBin: 15, startBin: 0, labelCount: 0, minutesMismatch: false };
    }
    const list: TvOccupancyCard[] = [];
    const map = new Map<string, TvOccupancyCard>();
    const minutesPerBinRaw = Number(contribCountsState.data?.time_bin_minutes);
    const minutesPerBin = Number.isFinite(minutesPerBinRaw) && minutesPerBinRaw > 0 ? minutesPerBinRaw : 15;
    const startBin = Number(contribCountsState.data?.timebins?.start_bin ?? 0);
    const labels = contribCountsState.data?.timebins?.labels ?? [];
    const labelCount = labels.length;
    const minutesMismatch = false; // single integrated source

    const totalCounts = contribCountsState.data?.total_counts ?? {};
    const flightCounts = contribCountsState.data?.flight_list_counts ?? {};
    const capacityMap = contribCountsState.data?.capacity ?? {};

    const ranked = contribCountsState.data?.metadata?.ranked_tv_ids ?? Object.keys(totalCounts);
    if (!Array.isArray(ranked) || ranked.length === 0) {
      return { list, map, minutesPerBin, startBin, labelCount, minutesMismatch };
    }

    for (const tvId of ranked) {
      const totalsRaw = totalCounts[tvId] || [];
      const selectedRaw = flightCounts[tvId] || [];
      const capacityRaw = capacityMap?.[tvId] || [];
      const n = Math.max(labelCount, totalsRaw.length, selectedRaw.length, capacityRaw.length);
      if (n === 0) continue;

      const totalSeries = new Array(n).fill(0).map((_, idx) => clampNonNegative(totalsRaw[idx]));
      const selectedSeries = new Array(n).fill(0).map((_, idx) => clampNonNegative(selectedRaw[idx]));
      const capacitySeries = new Array(n).fill(null).map((_, idx) => normalizeCapacity(capacityRaw[idx]));

      const rows: TvOccupancyRow[] = [];
      let totalSum = 0;
      let selectedSum = 0;
      let exceedance = 0;
      let peakTotal = 0;
      let peakSelected = 0;

      for (let i = 0; i < n; i++) {
        const total = clampNonNegative(totalSeries[i]);
        const selected = Math.min(total, clampNonNegative(selectedSeries[i]));
        const other = Math.max(0, total - selected);
        const capacity = capacitySeries[i];
        if (capacity !== null) {
          exceedance += Math.max(0, total - capacity);
        }
        totalSum += total;
        selectedSum += selected;
        if (total > peakTotal) peakTotal = total;
        if (selected > peakSelected) peakSelected = selected;
        const label = labels[i] ?? binIndexToRangeLabel(startBin + i, minutesPerBin);
        const labelShort = shortenLabel(label);
        const startMinute = (startBin + i) * minutesPerBin;
        rows.push({
          idx: i,
          label,
          labelShort,
          startMinute,
          selected,
          other,
          total,
          capacity,
        });
      }

      const share = totalSum > 0 ? selectedSum / totalSum : 0;
      const card: TvOccupancyCard = {
        tvId,
        rows,
        metrics: {
          totalSum,
          selectedSum,
          share,
          exceedance,
          peakTotal,
          peakSelected,
        },
        hasCapacity: capacitySeries.some(v => Number.isFinite(v as number) && (v as number) >= 0),
      };
      list.push(card);
      map.set(tvId, card);
    }

    return { list, map, minutesPerBin, startBin, labelCount, minutesMismatch };
  }, [contribCountsState.data, showOccupancyCharts]);

  const occupancyCards = occupancyComputation.list;
  const occupancyMap = occupancyComputation.map;
  const occupancyMinutesPerBin = occupancyComputation.minutesPerBin;
  const occupancyMinutesMismatch = occupancyComputation.minutesMismatch;

  const filteredCards = useMemo(() => {
    if (selectedTrafficVolumes.length === 0) return occupancyCards;
    const acc: TvOccupancyCard[] = [];
    const seen = new Set<string>();
    for (const id of selectedTrafficVolumes) {
      if (seen.has(id)) continue;
      seen.add(id);
      const card = occupancyMap.get(id);
      if (card) acc.push(card);
    }
    return acc;
  }, [selectedTrafficVolumes, occupancyCards, occupancyMap]);

  const rankedCards = useMemo(() => {
    const arr = [...filteredCards];
    arr.sort((a, b) => {
      const am = a.metrics;
      const bm = b.metrics;
      switch (rankMode) {
        case "flight_list_relative": {
          if (bm.share !== am.share) return bm.share - am.share;
          if (bm.selectedSum !== am.selectedSum) return bm.selectedSum - am.selectedSum;
          break;
        }
        case "exceedance": {
          if (bm.exceedance !== am.exceedance) return bm.exceedance - am.exceedance;
          if (bm.totalSum !== am.totalSum) return bm.totalSum - am.totalSum;
          break;
        }
        case "peak_selected": {
          if (bm.peakSelected !== am.peakSelected) return bm.peakSelected - am.peakSelected;
          if (bm.selectedSum !== am.selectedSum) return bm.selectedSum - am.selectedSum;
          break;
        }
        case "total_peak": {
          if (bm.peakTotal !== am.peakTotal) return bm.peakTotal - am.peakTotal;
          if (bm.totalSum !== am.totalSum) return bm.totalSum - am.totalSum;
          break;
        }
        case "flight_list_count":
        default: {
          if (bm.selectedSum !== am.selectedSum) return bm.selectedSum - am.selectedSum;
          if (bm.share !== am.share) return bm.share - am.share;
          break;
        }
      }
      if (bm.totalSum !== am.totalSum) return bm.totalSum - am.totalSum;
      return a.tvId.localeCompare(b.tvId);
    });
    return arr;
  }, [filteredCards, rankMode]);

  // Reset pagination when filters/sort scope changes
  useEffect(() => {
    if (!showOccupancyCharts) return;
    setVisibleTvCount(TV_PAGE_SIZE);
  }, [selectedTrafficVolumes, rankMode, commonTrafficVolumes, showOccupancyCharts]);

  const visibleRankedCards = useMemo(() => {
    const limit = Math.max(0, Math.min(visibleTvCount, rankedCards.length));
    return rankedCards.slice(0, limit);
  }, [rankedCards, visibleTvCount]);

  const occupancySummary = useMemo(() => {
    if (rankedCards.length === 0) return null;
    return rankedCards.reduce(
      (acc, card) => {
        acc.total += card.metrics.totalSum;
        acc.selected += card.metrics.selectedSum;
        acc.exceed += card.metrics.exceedance;
        return acc;
      },
      { total: 0, selected: 0, exceed: 0 }
    );
  }, [rankedCards]);

  const matchedCount = analysis.selectedFlights.length;
  const title = `Flight List Insights${analysis.requestedUniqueCount > 0 ? ` (${formatCount(matchedCount)})` : ""}`;

  const topOriginsCoverage = analysis.topOrigins.total > 0
    ? analysis.topOrigins.primarySum / analysis.topOrigins.total
    : 0;
  const topDestinationsCoverage = analysis.topDestinations.total > 0
    ? analysis.topDestinations.primarySum / analysis.topDestinations.total
    : 0;
  const topAirport = analysis.airportTotals[0];
  const airportTouchTotal = matchedCount * 2;
  const topAirportShare = topAirport && airportTouchTotal > 0
    ? topAirport.total / airportTouchTotal
    : 0;
  const topRoutes = analysis.routeRows.slice(0, 10);
  const topRoutesShare = matchedCount > 0
    ? topRoutes.reduce((sum, row) => sum + row.count, 0) / matchedCount
    : 0;

  const baselineMatchedCount = baselineAnalysis?.selectedFlights.length ?? 0;
  const baselineTopOriginsCoverage = baselineAnalysis
    ? baselineAnalysis.topOrigins.total > 0
      ? baselineAnalysis.topOrigins.primarySum / baselineAnalysis.topOrigins.total
      : 0
    : null;
  const baselineTopDestinationsCoverage = baselineAnalysis
    ? baselineAnalysis.topDestinations.total > 0
      ? baselineAnalysis.topDestinations.primarySum / baselineAnalysis.topDestinations.total
      : 0
    : null;
  const baselineTopAirport = baselineAnalysis?.airportTotals[0];
  const baselineAirportTouchTotal = baselineMatchedCount * 2;
  const baselineTopAirportShare = baselineTopAirport && baselineAirportTouchTotal > 0
    ? baselineTopAirport.total / baselineAirportTouchTotal
    : 0;
  const baselineTopRoutes = baselineAnalysis ? baselineAnalysis.routeRows.slice(0, 10) : [];
  const baselineTopRoutesShare = baselineAnalysis && baselineMatchedCount > 0
    ? baselineTopRoutes.reduce((sum, row) => sum + row.count, 0) / baselineMatchedCount
    : 0;

  const containerClassName = ["space-y-6 text-white", className].filter(Boolean).join(" ");
  const remainderLegendLabel = baselineAvailable ? `${baselineLabel} remainder` : "Other flights";
  const headerDescription = baselineAvailable
    ? `${highlightLabel} compared with ${baselineLabel}.`
    : `Insights for ${highlightLabel}.`;

  const summaryCards = [
    {
      key: "flights",
      label: "Flights analyzed",
      highlightValue: formatCount(matchedCount),
      highlightHelper:
        analysis.requestedUniqueCount > matchedCount
          ? `Matched ${formatCount(matchedCount)} of ${formatCount(analysis.requestedUniqueCount)}`
          : undefined,
      baselineValue: baselineAvailable ? formatCount(baselineMatchedCount) : undefined,
      baselineHelper:
        baselineAvailable && baselineShare !== null
          ? `${formatPercent(baselineShare)} of ${baselineLabel}`
          : baselineAnalysis && baselineAnalysis.requestedUniqueCount > baselineMatchedCount
            ? `Matched ${formatCount(baselineMatchedCount)} of ${formatCount(baselineAnalysis.requestedUniqueCount)}`
            : undefined,
    },
    {
      key: "origins",
      label: "Distinct origins",
      highlightValue: formatCount(analysis.uniqueOrigins),
      baselineValue: baselineAnalysis ? formatCount(baselineAnalysis.uniqueOrigins) : undefined,
    },
    {
      key: "destinations",
      label: "Distinct destinations",
      highlightValue: formatCount(analysis.uniqueDestinations),
      baselineValue: baselineAnalysis ? formatCount(baselineAnalysis.uniqueDestinations) : undefined,
    },
    {
      key: "routes",
      label: "Distinct routes",
      highlightValue: formatCount(analysis.routeCount),
      baselineValue: baselineAnalysis ? formatCount(baselineAnalysis.routeCount) : undefined,
    },
    {
      key: "earliest",
      label: "Earliest takeoff",
      highlightValue: formatTimeOfDay(analysis.earliestTakeoff),
      highlightHelper:
        analysis.takeoffKnown > 0
          ? `Based on ${formatCount(analysis.takeoffKnown)} flights`
          : "Not available",
      baselineValue: baselineAnalysis ? formatTimeOfDay(baselineAnalysis.earliestTakeoff) : undefined,
      baselineHelper:
        baselineAnalysis && baselineAnalysis.takeoffKnown > 0
          ? `Based on ${formatCount(baselineAnalysis.takeoffKnown)} flights`
          : baselineAnalysis
            ? "Not available"
            : undefined,
    },
    {
      key: "latest",
      label: "Latest takeoff",
      highlightValue: formatTimeOfDay(analysis.latestTakeoff),
      highlightHelper: analysis.takeoffKnown > 0 ? undefined : "Not available",
      baselineValue: baselineAnalysis ? formatTimeOfDay(baselineAnalysis.latestTakeoff) : undefined,
      baselineHelper:
        baselineAnalysis && baselineAnalysis.takeoffKnown > 0 ? undefined : baselineAnalysis ? "Not available" : undefined,
    },
    {
      key: "avgDuration",
      label: "Average duration",
      highlightValue: formatDuration(analysis.durations.average),
      highlightHelper:
        analysis.durations.count > 0
          ? `Across ${formatCount(analysis.durations.count)} flights`
          : "Not available",
      baselineValue: baselineAnalysis ? formatDuration(baselineAnalysis.durations.average) : undefined,
      baselineHelper:
        baselineAnalysis && baselineAnalysis.durations.count > 0
          ? `Across ${formatCount(baselineAnalysis.durations.count)} flights`
          : baselineAnalysis
            ? "Not available"
            : undefined,
    },
    {
      key: "medianDuration",
      label: "Median duration",
      highlightValue: formatDuration(analysis.durations.median),
      highlightHelper: analysis.durations.count > 0 ? undefined : "Not available",
      baselineValue: baselineAnalysis ? formatDuration(baselineAnalysis.durations.median) : undefined,
      baselineHelper:
        baselineAnalysis && baselineAnalysis.durations.count > 0
          ? undefined
          : baselineAnalysis
            ? "Not available"
            : undefined,
    },
    {
      key: "maxDuration",
      label: "Longest duration",
      highlightValue: formatDuration(analysis.durations.max),
      highlightHelper:
        analysis.longestFlight
          ? `${analysis.longestFlight.origin} → ${analysis.longestFlight.destination} (${analysis.longestFlight.callSign ?? analysis.longestFlight.id})`
          : "Not available",
      baselineValue: baselineAnalysis ? formatDuration(baselineAnalysis.durations.max) : undefined,
      baselineHelper:
        baselineAnalysis && baselineAnalysis.longestFlight
          ? `${baselineAnalysis.longestFlight.origin} → ${baselineAnalysis.longestFlight.destination} (${baselineAnalysis.longestFlight.callSign ?? baselineAnalysis.longestFlight.id})`
          : baselineAnalysis
            ? "Not available"
            : undefined,
    },
  ];

  return (
    <div className={containerClassName}>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-1.5">
          <div className="text-xl font-semibold text-white">{title}</div>
          {metadataLine && <div className="text-xs text-white/60">{metadataLine}</div>}
          <div className="text-sm text-white/60">{headerDescription}</div>
          {baselineAvailable && baselineShare !== null && (
            <div className="text-xs text-white/50">
              {highlightLabel} covers {formatPercent(baselineShare)} of {baselineLabel}.
            </div>
          )}
        </div>
      </div>

      {analysis.missingCount > 0 && (
        <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
          Unable to locate {formatCount(analysis.missingCount)} of {formatCount(analysis.requestedUniqueCount)} requested flights
          in {highlightLabel}.
          {analysis.missingIds.length > 0 && (
            <div className="mt-1 opacity-80">
              Missing: {analysis.missingIds.slice(0, 6).join(", ")}
              {analysis.missingIds.length > 6 ? "…" : ""}
            </div>
          )}
        </div>
      )}

      {baselineAnalysis && baselineAnalysis.missingCount > 0 && (
        <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
          Unable to locate {formatCount(baselineAnalysis.missingCount)} of {formatCount(baselineAnalysis.requestedUniqueCount)}
          requested flights in {baselineLabel}.
          {baselineAnalysis.missingIds.length > 0 && (
            <div className="mt-1 opacity-80">
              Missing: {baselineAnalysis.missingIds.slice(0, 6).join(", ")}
              {baselineAnalysis.missingIds.length > 6 ? "…" : ""}
            </div>
          )}
        </div>
      )}

      {matchedCount === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-white">
          <div className="text-xl font-semibold">No flights to analyze</div>
          <div className="text-sm text-white/70 max-w-md">
            {analysis.requestedUniqueCount === 0
              ? `Add flight identifiers to populate ${highlightLabel}.`
              : `The requested identifiers were not found for ${highlightLabel}.`}
          </div>
          {analysis.missingIds.length > 0 && (
            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
              Missing: {analysis.missingIds.slice(0, 6).join(", ")}
              {analysis.missingIds.length > 6 ? "…" : ""}
            </div>
          )}
          {baselineAvailable && baselineMatchedCount === 0 && baselineAnalysis?.requestedUniqueCount ? (
            <div className="text-xs text-white/60">
              {baselineLabel} contains {formatCount(baselineAnalysis.requestedUniqueCount)} requested flights.
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {summaryCards.map(card => (
              <div
                key={card.key}
                className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 shadow-inner shadow-slate-900/30"
              >
                <div className="text-[11px] uppercase tracking-wider text-white/60">{card.label}</div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-white/50">{highlightLabel}</div>
                  <div className="text-2xl font-semibold text-white">{card.highlightValue}</div>
                  {card.highlightHelper && (
                    <div className="mt-1 text-[12px] text-white/60">{card.highlightHelper}</div>
                  )}
                </div>
                {card.baselineValue !== undefined && (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                    <div className="flex items-center justify-between gap-2">
                      <span>{baselineLabel}</span>
                      <span className="font-mono text-white/80">{card.baselineValue}</span>
                    </div>
                    {card.baselineHelper && (
                      <div className="mt-1 text-[11px] text-white/60">{card.baselineHelper}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {showOccupancyCharts && (
            <section className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-white/60">Common Traffic Volumes</div>
                    <div className="text-sm text-white/80">Rolling-hour occupancy contributions</div>
                  </div>
                  {occupancySummary && occupancySummary.total > 0 && (
                    <div className="text-right text-xs text-white/70">
                      <div>{formatCount(rankedCards.length)} volumes</div>
                      <div>
                        {highlightLabel} share {formatPercent(occupancySummary.selected / occupancySummary.total)}
                        {baselineAvailable ? ` of ${baselineLabel}` : ""}
                      </div>
                      {occupancySummary.exceed > 0 && (
                        <div>Exceedance {formatNumber(occupancySummary.exceed)}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-[11px] opacity-80 mb-1 text-white">Filter traffic volumes</div>
                    <MultiSelectWithChips
                      options={trafficOptions}
                      selectedIds={selectedTrafficVolumes}
                      onChange={setSelectedTrafficVolumes}
                      placeholder={trafficState.loading ? "Loading traffic volumes…" : trafficOptions.length === 0 ? "No common traffic volumes" : "Search traffic volumes"}
                      disabled={trafficState.loading || trafficOptions.length === 0}
                    />
                  </div>
                  <div className="min-w-[160px]">
                    <div className="text-[11px] opacity-80 mb-1 text-white">Sort charts by</div>
                    <select
                      value={rankMode}
                      onChange={(e) => setRankMode(e.currentTarget.value as typeof rankMode)}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-white/90 focus:outline-none"
                    >
                      <option value="flight_list_count">{highlightLabel} count</option>
                      <option value="flight_list_relative">{highlightLabel} relative share</option>
                      <option value="peak_selected">{highlightLabel} peak</option>
                      <option value="total_peak">Total peak</option>
                      <option value="exceedance">Capacity exceedance</option>
                    </select>
                  </div>
                  <div className="min-w-[160px]">
                    <div className="text-[11px] opacity-80 mb-1 text-white">API ranking metric</div>
                    <select
                      value={rankByParam}
                      onChange={(e) => setRankByParam(e.currentTarget.value as typeof rankByParam)}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-white/90 focus:outline-none"
                    >
                      <option value="total_count">Total count</option>
                      <option value="total_excess">Total excess</option>
                      <option value="flight_list_count">{highlightLabel} count</option>
                      <option value="flight_list_relative">{highlightLabel} relative share</option>
                    </select>
                  </div>
                </div>

                {trafficState.error && (
                  <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-400/40 rounded-lg px-3 py-2">
                    {trafficState.error}
                  </div>
                )}
                {countsError && (
                  <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-400/40 rounded-lg px-3 py-2">
                    {countsError}
                  </div>
                )}
                {missingFlightIds.length > 0 && (
                  <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                    Ignored {formatCount(missingFlightIds.length)} unknown flights in occupancy query.
                  </div>
                )}
                {occupancyMinutesMismatch && (
                  <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                    Warning: bin size mismatch detected in response.
                  </div>
                )}

                {countsLoading ? (
                  <div className="flex items-center gap-3 text-sm text-white/70">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                    <span>Loading occupancy data…</span>
                  </div>
                ) : rankedCards.length === 0 ? (
                  <div className="text-xs text-white/70 border border-white/10 rounded-lg px-3 py-4 text-center">
                    {trafficOptions.length === 0
                      ? "The selected flights do not share any traffic volumes."
                      : "No occupancy data available for the selected filters."}
                  </div>
                ) : (
                  <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleRankedCards.map(card => {
                      const overloadSegments: TrafficOverloadDatum[] = [];
                      const rawMinutes = Number(occupancyMinutesPerBin);
                      const binMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 1;
                      for (const row of card.rows) {
                        if (row.capacity == null) continue;
                        const capacity = Number(row.capacity);
                        const occupancy = Number(row.total);
                        if (!Number.isFinite(capacity) || capacity < 0) continue;
                        if (!Number.isFinite(occupancy)) continue;
                        if (occupancy <= capacity) continue;
                        const ratio = capacity > 0 ? occupancy / capacity : Infinity;
                        let color = "#fb923c";
                        if (ratio >= 1.4) {
                          color = "#b91c1c";
                        } else if (ratio >= 1.2) {
                          color = "#f97316";
                        }
                        const startMinutes = row.startMinute;
                        const endMinutes = startMinutes + binMinutes;
                        const startLabel = formatMinutesToHHMM(startMinutes);
                        const endLabel = formatMinutesToHHMMWith24(endMinutes);
                        overloadSegments.push({
                          period: `${startLabel}-${endLabel}`,
                          color,
                          metadata: [
                            `Count: ${formatNumber(occupancy)}`,
                            `Capacity: ${formatNumber(capacity)}`,
                            `Excess: ${formatNumber(occupancy - capacity)}`,
                          ],
                          label: `${card.tvId} overload`,
                        });
                      }
                      return (
                        <div key={`occupancy-${card.tvId}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="text-sm font-semibold text-white truncate">
                              <TrafficVolumeInfoTooltip
                                trafficVolumeId={card.tvId}
                                className="truncate max-w-full"
                              >
                                <span className="truncate">{card.tvId}</span>
                              </TrafficVolumeInfoTooltip>
                            </div>
                            <div className="text-right text-[11px] text-white/70 leading-tight">
                              <div>{formatPercent(card.metrics.share)} share</div>
                              <div>{formatNumber(card.metrics.selectedSum)} / {formatNumber(card.metrics.totalSum)}</div>
                            </div>
                          </div>
                          <div className="text-[11px] text-white/60 mb-2 flex flex-wrap gap-3">
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-sm bg-sky-400" />
                              {highlightLabel}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-sm bg-slate-400" />
                              {remainderLegendLabel}
                            </span>
                            {card.hasCapacity && (
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-4 h-[2px] bg-amber-300" />
                                Capacity
                              </span>
                            )}
                          </div>
                          <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={card.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                                <XAxis
                                  dataKey="idx"
                                  tick={{ fontSize: 10, fill: "rgba(226,232,240,0.9)" }}
                                  interval="preserveStartEnd"
                                  height={18}
                                  tickFormatter={(value: any) => {
                                    const idx = Number(value ?? 0);
                                    return card.rows[idx]?.labelShort ?? card.rows[idx]?.label ?? "";
                                  }}
                                />
                                <YAxis
                                  tick={{ fontSize: 10, fill: "rgba(226,232,240,0.9)" }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={28}
                                  allowDecimals={false}
                                />
                                <Tooltip
                                  formatter={(value: any, name) => {
                                    const num = Number(value ?? 0);
                                    if (name === "selected") return [formatNumber(num), highlightLabel];
                                    if (name === "other") return [formatNumber(num), remainderLegendLabel];
                                    if (name === "capacity") return [formatNumber(num), "Capacity"];
                                    return [formatNumber(num), String(name)];
                                  }}
                                  labelFormatter={(value: any) => {
                                    const idx = Number(value ?? 0);
                                    return card.rows[idx]?.label ?? `Bin ${idx}`;
                                  }}
                                  contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                                  itemStyle={{ color: "white" }}
                                />
                                <Bar dataKey="selected" stackId="count" fill="#38bdf8" name={highlightLabel} isAnimationActive={false} />
                                <Bar dataKey="other" stackId="count" fill="#94a3b8" name={remainderLegendLabel} isAnimationActive={false} />
                                {card.hasCapacity && (
                                  <Line type="stepAfter" dataKey="capacity" stroke="#facc15" strokeWidth={1.5} dot={false} name="Capacity" isAnimationActive={false} />
                                )}
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-3">
                            <TrafficOverloadBar
                              data={overloadSegments}
                              showTime={overloadSegments.length > 0}
                              showOkWhenNoData={false}
                            />
                          </div>
                          <div className="mt-2 text-[11px] text-white/60 flex flex-wrap gap-3">
                            <span>Peak {formatNumber(card.metrics.peakSelected)} / {formatNumber(card.metrics.peakTotal)}</span>
                            {card.metrics.exceedance > 0 && (
                              <span>Exceed {formatNumber(card.metrics.exceedance)}</span>
                            )}
                            <span>{formatCount(card.rows.length)} bins · {occupancyMinutesPerBin}m</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {rankedCards.length > visibleRankedCards.length && (
                    <div className="mt-2 flex justify-center">
                      <button
                        onClick={() => setVisibleTvCount(count => Math.min(count + TV_PAGE_SIZE, rankedCards.length))}
                        className="px-3 py-1.5 text-sm rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-white"
                      >
                        Show more
                      </button>
                    </div>
                  )}
                  </>
                )}
              </div>
            </section>
          )}

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top origins</div>
                  <div className="text-xs text-white/60 space-y-1">
                    <div>
                      {analysis.topOrigins.limitApplied > 0
                        ? `${highlightLabel}: Top ${analysis.topOrigins.limitApplied} cover ${formatPercent(topOriginsCoverage)} of departures`
                        : `No departure data for ${highlightLabel}`}
                    </div>
                    {baselineAvailable && baselineAnalysis?.topOrigins.limitApplied ? (
                      <div className="text-[11px] text-white/50">
                        {baselineLabel}: Top {baselineAnalysis.topOrigins.limitApplied} cover {formatPercent(baselineTopOriginsCoverage ?? 0)} of departures
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex-1">
                  {analysis.topOrigins.slices.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.topOrigins.slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={1.5}
                            isAnimationActive={false}
                          >
                            {analysis.topOrigins.slices.map((slice, index) => (
                              <Cell
                                key={`origin-${slice.name}-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                opacity={slice.isOthers ? 0.65 : 1}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => {
                              const numericValue = Number(value);
                              const percent = analysis.topOrigins.total > 0
                                ? (numericValue / analysis.topOrigins.total) * 100
                                : 0;
                              return [`${formatCount(numericValue)} flights (${percent.toFixed(1)}%)`, name];
                            }}
                            contentStyle={{
                              background: "rgba(15,23,42,0.95)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              borderRadius: 8,
                              color: "white",
                            }}
                            itemStyle={{ color: "white" }}
                            labelStyle={{ color: "white" }}
                          />
                          <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-white/70">
                      No origin data available.
                    </div>
                  )}
                </div>
                {analysis.topOrigins.slices.length > 0 && (
                  <div className="mt-4 space-y-1 text-xs">
                    {analysis.topOrigins.slices.map((slice, index) => (
                      <div key={`origin-row-${slice.name}-${index}`} className="flex items-center justify-between text-white/70">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                              opacity: slice.isOthers ? 0.65 : 1,
                            }}
                          />
                          <span className="text-white/80">{slice.name}</span>
                        </div>
                        <div className="font-mono text-white/80">
                          {formatCount(slice.value)} ({formatPercent(slice.percent)})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top destinations</div>
                  <div className="text-xs text-white/60 space-y-1">
                    <div>
                      {analysis.topDestinations.limitApplied > 0
                        ? `${highlightLabel}: Top ${analysis.topDestinations.limitApplied} cover ${formatPercent(topDestinationsCoverage)} of arrivals`
                        : `No arrival data for ${highlightLabel}`}
                    </div>
                    {baselineAvailable && baselineAnalysis?.topDestinations.limitApplied ? (
                      <div className="text-[11px] text-white/50">
                        {baselineLabel}: Top {baselineAnalysis.topDestinations.limitApplied} cover {formatPercent(baselineTopDestinationsCoverage ?? 0)} of arrivals
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex-1">
                  {analysis.topDestinations.slices.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.topDestinations.slices}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={1.5}
                            isAnimationActive={false}
                          >
                            {analysis.topDestinations.slices.map((slice, index) => (
                              <Cell
                                key={`dest-${slice.name}-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                opacity={slice.isOthers ? 0.65 : 1}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => {
                              const numericValue = Number(value);
                              const percent = analysis.topDestinations.total > 0
                                ? (numericValue / analysis.topDestinations.total) * 100
                                : 0;
                              return [`${formatCount(numericValue)} flights (${percent.toFixed(1)}%)`, name];
                            }}
                            contentStyle={{
                              background: "rgba(15,23,42,0.95)",
                              border: "1px solid rgba(255,255,255,0.15)",
                              borderRadius: 8,
                              color: "white",
                            }}
                            itemStyle={{ color: "white" }}
                            labelStyle={{ color: "white" }}
                          />
                          <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-white/70">
                      No destination data available.
                    </div>
                  )}
                </div>
                {analysis.topDestinations.slices.length > 0 && (
                  <div className="mt-4 space-y-1 text-xs">
                    {analysis.topDestinations.slices.map((slice, index) => (
                      <div key={`dest-row-${slice.name}-${index}`} className="flex items-center justify-between text-white/70">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{
                              backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                              opacity: slice.isOthers ? 0.65 : 1,
                            }}
                          />
                          <span className="text-white/80">{slice.name}</span>
                        </div>
                        <div className="font-mono text-white/80">
                          {formatCount(slice.value)} ({formatPercent(slice.percent)})
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2 xl:col-span-3 bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Airport involvement</div>
                  {topAirport ? (
                    <div className="text-xs text-white/60 space-y-1 text-right sm:text-left">
                      <div>
                        {highlightLabel}: {topAirport.airport} leads with {formatCount(topAirport.total)} touches ({formatPercent(topAirportShare)})
                      </div>
                      {baselineAvailable && baselineTopAirport ? (
                        <div className="text-[11px] text-white/50">
                          {baselineLabel}: {baselineTopAirport.airport} ({formatPercent(baselineTopAirportShare)})
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-white/60">No airport data available</div>
                  )}
                </div>
                {analysis.airportTotals.length > 0 ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analysis.airportTotals} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis
                          dataKey="airport"
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${formatCount(Number(value))} flights`,
                            name === "originCount" ? "Origin count" : name === "destinationCount" ? "Destination count" : name,
                          ]}
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 8,
                            color: "white",
                          }}
                          itemStyle={{ color: "white" }}
                          labelStyle={{ color: "white" }}
                        />
                        <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        <Bar dataKey="originCount" name="Origins" fill={ORIGIN_BAR_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        <Bar dataKey="destinationCount" name="Destinations" fill={DESTINATION_BAR_COLOR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">No airport data to display.</div>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Takeoffs by hour</div>
                  <div className="text-xs text-white/60 space-y-1 text-right sm:text-left">
                    <div>
                      {analysis.busiestTakeoffHour
                        ? `${highlightLabel}: Peak at ${analysis.busiestTakeoffHour.label} (${formatCount(analysis.busiestTakeoffHour.flights)} flights)`
                        : analysis.takeoffKnown > 0
                          ? `${highlightLabel}: Even distribution`
                          : `No takeoff data for ${highlightLabel}`}
                    </div>
                    {baselineAvailable ? (
                      <div className="text-[11px] text-white/50">
                        {baselineAnalysis?.busiestTakeoffHour
                          ? `${baselineLabel}: Peak at ${baselineAnalysis.busiestTakeoffHour.label} (${formatCount(baselineAnalysis.busiestTakeoffHour.flights)} flights)`
                          : baselineAnalysis?.takeoffKnown
                            ? `${baselineLabel}: Even distribution`
                            : `No takeoff data for ${baselineLabel}`}
                      </div>
                    ) : null}
                  </div>
                </div>
                {analysis.takeoffKnown > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analysis.takeoffByHour} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(value: number) => [`${formatCount(Number(value))} flights`, "Flights"]}
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 8,
                            color: "white",
                          }}
                          itemStyle={{ color: "white" }}
                          labelStyle={{ color: "white" }}
                        />
                        <Bar dataKey="flights" name="Flights" fill="#38bdf8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">No takeoff times available for the selected flights.</div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top routes</div>
                  <div className="text-xs text-white/60 space-y-1">
                    <div>
                      {analysis.routeCount > 0
                        ? `${highlightLabel}: ${formatCount(analysis.routeCount)} distinct routes · Top ${Math.min(topRoutes.length, 10)} cover ${formatPercent(topRoutesShare)}`
                        : `No route data for ${highlightLabel}`}
                    </div>
                    {baselineAvailable && baselineAnalysis ? (
                      <div className="text-[11px] text-white/50">
                        {baselineLabel}: {formatCount(baselineAnalysis.routeCount)} routes · Top {Math.min(baselineTopRoutes.length, 10)} cover {formatPercent(baselineTopRoutesShare)}
                      </div>
                    ) : null}
                  </div>
                </div>
                {topRoutes.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm text-white/90">
                      <thead className="bg-white/5 text-white/70">
                        <tr>
                          <th className="px-3 py-2 text-left">Route</th>
                          <th className="px-3 py-2 text-right">Flights</th>
                          <th className="px-3 py-2 text-right">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topRoutes.map((row, index) => (
                          <tr
                            key={`${row.origin}-${row.destination}-${index}`}
                            className={`border-t border-white/10 ${index % 2 === 1 ? "bg-white/5" : "bg-white/0"}`}
                          >
                            <td className="px-3 py-2 font-medium text-white">
                              {row.origin} → {row.destination}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-white/80">{formatCount(row.count)}</td>
                            <td className="px-3 py-2 text-right font-mono text-white/80">
                              {matchedCount > 0 ? formatPercent(row.count / matchedCount) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">
                    Not enough route information to display.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
    </div>
  );
}

function normalizeAirport(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Unknown";
  }
  if (value === null || value === undefined) return "Unknown";
  const text = String(value).trim();
  return text.length > 0 ? text : "Unknown";
}

function sanitizeCallSign(callSign: unknown): string | undefined {
  if (typeof callSign !== "string") return undefined;
  const trimmed = callSign.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  if (hour < 0) return 0;
  if (hour > 23) return 23;
  return hour;
}

function createPieData(map: Map<string, number>, limit = 10): PieData {
  const entries = Array.from(map.entries());
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const topEntries = entries.slice(0, limit);
  const primarySum = topEntries.reduce((sum, [, value]) => sum + value, 0);
  const slices: AirportSlice[] = topEntries.map(([name, value]) => ({
    name,
    value,
    percent: total > 0 ? value / total : 0,
  }));
  if (entries.length > limit) {
    const othersValue = total - primarySum;
    slices.push({
      name: "Others",
      value: othersValue,
      percent: total > 0 ? othersValue / total : 0,
      isOthers: true,
    });
  }
  return {
    slices,
    total,
    primarySum,
    limitApplied: topEntries.length,
  };
}

function createAirportTotals(originCounts: Map<string, number>, destinationCounts: Map<string, number>, limit = 12): AirportTotalRow[] {
  const totals = new Map<string, AirportTotalRow>();
  for (const [airport, count] of originCounts.entries()) {
    totals.set(airport, {
      airport,
      originCount: count,
      destinationCount: 0,
      total: count,
    });
  }
  for (const [airport, count] of destinationCounts.entries()) {
    const existing = totals.get(airport);
    if (existing) {
      existing.destinationCount += count;
      existing.total += count;
    } else {
      totals.set(airport, {
        airport,
        originCount: 0,
        destinationCount: count,
        total: count,
      });
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.airport.localeCompare(b.airport);
    })
    .slice(0, limit);
}

function safeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function clampNonNegative(value: unknown): number {
  const num = safeNumber(value);
  return num > 0 ? num : 0;
}

function shortenLabel(label: string): string {
  if (!label) return "";
  const dash = label.indexOf("-");
  const short = dash > 0 ? label.slice(0, dash) : label;
  return short.trim();
}

function formatMinutesToHHMM(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const clamped = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatMinutesToHHMMWith24(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const clamped = Math.max(0, Math.floor(totalMinutes));
  if (clamped >= 24 * 60) {
    return "24:00";
  }
  return formatMinutesToHHMM(clamped);
}

function formatTimeOfDay(seconds: number | null): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(seconds: number | null): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes === 0 && totalSeconds > 0) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value).toLocaleString("en-US");
}

function formatNumber(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (Math.abs(num) < 1e-3) return "0";
  if (Math.abs(num - Math.round(num)) < 1e-6) {
    return formatCount(Math.round(num));
  }
  const abs = Math.abs(num);
  const fractionDigits = abs >= 1000 ? 0 : 1;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value <= 0) return "0%";
  if (value >= 0.995) return `${(value * 100).toFixed(0)}%`;
  if (value <= 0.005) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}
