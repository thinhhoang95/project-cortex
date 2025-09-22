"use client";

import { useEffect, useMemo, useState } from "react";
import ModalDialog from "./ModalDialog";
import { useSimStore } from "./useSimStore";
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
import { binIndexToRangeLabel } from "@/lib/time";

interface FlightStatisticsDialogProps {
  open: boolean;
  onClose: () => void;
  flightIds: string[];
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

type CountsResponse = {
  time_bin_minutes?: number;
  counts?: Record<string, number[]>;
  mentioned_counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  mentioned_capacity?: Record<string, number[]>;
  timebins?: { labels?: string[]; start_bin?: number; end_bin?: number };
  metadata?: Record<string, any> & { missing_flight_ids?: string[] };
};

type TrafficVolumesState = {
  loading: boolean;
  error: string | null;
  ids: string[];
  metadata: Record<string, any> | null;
};

type CountsState = {
  loading: boolean;
  error: string | null;
  data: CountsResponse | null;
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

interface Analysis {
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

const EMPTY_ANALYSIS: Analysis = {
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

export default function FlightStatisticsDialog({ open, onClose, flightIds }: FlightStatisticsDialogProps) {
  const flights = useSimStore(state => state.flights);

  const analysis = useMemo<Analysis>(() => {
    if (!Array.isArray(flightIds) || flightIds.length === 0) {
      return EMPTY_ANALYSIS;
    }

    const seen = new Set<string>();
    const orderedIds: string[] = [];
    for (const raw of flightIds) {
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
  }, [flightIds, flights]);

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

  const [trafficState, setTrafficState] = useState<TrafficVolumesState>({
    loading: false,
    error: null,
    ids: [],
    metadata: null,
  });
  const [overallCountsState, setOverallCountsState] = useState<CountsState>({ loading: false, error: null, data: null });
  const [flightCountsState, setFlightCountsState] = useState<CountsState>({ loading: false, error: null, data: null });
  const [selectedTrafficVolumes, setSelectedTrafficVolumes] = useState<string[]>([]);
  const [rankMode, setRankMode] = useState<"selected_total" | "selected_share" | "exceedance" | "peak_selected" | "total_peak">("selected_total");
  const [rankByParam, setRankByParam] = useState<"total_count" | "total_excess">("total_count");

  const commonTrafficVolumes = useMemo(() => trafficState.ids, [trafficState.ids]);
  const trafficOptions = useMemo<ChipOption[]>(() => commonTrafficVolumes.map(id => ({ id, label: id })), [commonTrafficVolumes]);

  useEffect(() => {
    if (!open) return;
    if (selectedFlightIds.length === 0) {
      setTrafficState({ loading: false, error: null, ids: [], metadata: null });
      setOverallCountsState({ loading: false, error: null, data: null });
      setFlightCountsState({ loading: false, error: null, data: null });
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
  }, [open, selectedFlightIds]);

  useEffect(() => {
    if (selectedTrafficVolumes.length === 0) return;
    const allowed = new Set(commonTrafficVolumes);
    if (selectedTrafficVolumes.some(id => !allowed.has(id))) {
      setSelectedTrafficVolumes(prev => prev.filter(id => allowed.has(id)));
    }
  }, [commonTrafficVolumes, selectedTrafficVolumes]);

  useEffect(() => {
    if (!open) return;
    if (selectedFlightIds.length === 0) return;
    if (commonTrafficVolumes.length === 0) {
      setOverallCountsState({ loading: false, error: null, data: null });
      setFlightCountsState({ loading: false, error: null, data: null });
      return;
    }

    let cancelled = false;
    const basePayload = {
      traffic_volume_ids: commonTrafficVolumes,
      rolling_hour: false,
      rank_by: rankByParam,
    };

    setOverallCountsState(prev => ({ ...prev, loading: true, error: null }));
    setFlightCountsState(prev => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const res = await authFetch("/api/original_counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
        });
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch original counts (${res.status})`);
        }
        const json = await res.json();
        if (cancelled) return;
        setOverallCountsState({ loading: false, error: null, data: json as CountsResponse });
      } catch (err: any) {
        if (cancelled) return;
        setOverallCountsState({
          loading: false,
          error: err?.message || "Failed to load occupancy totals",
          data: null,
        });
      }
    })();

    (async () => {
      try {
        const payload = { ...basePayload, flight_ids: selectedFlightIds };
        const res = await authFetch("/api/original_counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Failed to fetch filtered counts (${res.status})`);
        }
        const json = await res.json();
        if (cancelled) return;
        setFlightCountsState({ loading: false, error: null, data: json as CountsResponse });
      } catch (err: any) {
        if (cancelled) return;
        setFlightCountsState({
          loading: false,
          error: err?.message || "Failed to load flight list occupancy",
          data: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedFlightIds, commonTrafficVolumes, rankByParam]);

  const countsLoading = trafficState.loading || overallCountsState.loading || flightCountsState.loading;
  const countsError = overallCountsState.error || flightCountsState.error;
  const missingFlightIds = useMemo(() => (
    Array.isArray(flightCountsState.data?.metadata?.missing_flight_ids)
      ? (flightCountsState.data?.metadata?.missing_flight_ids as string[])
      : []
  ), [flightCountsState.data?.metadata?.missing_flight_ids]);

  const occupancyComputation = useMemo<TvOccupancyComputation>(() => {
    const list: TvOccupancyCard[] = [];
    const map = new Map<string, TvOccupancyCard>();

    const minutesAll = Number(overallCountsState.data?.time_bin_minutes);
    const minutesSel = Number(flightCountsState.data?.time_bin_minutes);
    const baseMinutes = Number.isFinite(minutesAll)
      ? Number(minutesAll)
      : Number.isFinite(minutesSel)
        ? Number(minutesSel)
        : 15;
    const minutesPerBin = baseMinutes > 0 ? baseMinutes : 15;
    const minutesMismatch = Number.isFinite(minutesAll) && Number.isFinite(minutesSel) && minutesAll !== minutesSel;
    const startBin = Number(overallCountsState.data?.timebins?.start_bin ?? flightCountsState.data?.timebins?.start_bin ?? 0);
    const labels = overallCountsState.data?.timebins?.labels ?? flightCountsState.data?.timebins?.labels ?? [];
    const labelCount = labels.length;

    if (commonTrafficVolumes.length === 0) {
      return { list, map, minutesPerBin, startBin, labelCount, minutesMismatch };
    }

    const countsAll = extractCounts(overallCountsState.data);
    const countsSelected = extractCounts(flightCountsState.data);
    const capacityMap = extractCapacities(overallCountsState.data);
    const binsPerHour = Math.max(1, Math.round(60 / Math.max(1, minutesPerBin)));

    for (const tvId of commonTrafficVolumes) {
      const totalsRaw = countsAll[tvId] || [];
      const selectedRaw = countsSelected[tvId] || [];
      const capacityRaw = capacityMap?.[tvId] || [];
      const n = Math.max(labelCount, totalsRaw.length, selectedRaw.length, capacityRaw.length);
      if (n === 0) continue;

      const totalSeries = new Array(n).fill(0).map((_, idx) => safeNumber(totalsRaw[idx]));
      const selectedSeries = new Array(n).fill(0).map((_, idx) => safeNumber(selectedRaw[idx]));
      const capacitySeries = new Array(n).fill(null).map((_, idx) => {
        const raw = capacityRaw[idx];
        if (raw === undefined || raw === null) return null;
        const num = Number(raw);
        return Number.isFinite(num) && num >= 0 ? num : null;
      });

      const totalRolling = rollingSum(totalSeries, binsPerHour);
      const selectedRolling = rollingSum(selectedSeries, binsPerHour);

      const rows: TvOccupancyRow[] = [];
      let totalSum = 0;
      let selectedSum = 0;
      let exceedance = 0;
      let peakTotal = 0;
      let peakSelected = 0;

      for (let i = 0; i < n; i++) {
        const total = clampNonNegative(totalRolling[i]);
        const selected = Math.min(total, clampNonNegative(selectedRolling[i]));
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
  }, [commonTrafficVolumes, overallCountsState.data, flightCountsState.data]);

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
        case "selected_share": {
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
        case "selected_total":
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

  return (
    <ModalDialog open={open} onClose={onClose} title={title}>
      <div className="p-6 space-y-6 text-white">
        {matchedCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="text-xl font-semibold text-white">No flights to analyze</div>
            <div className="text-sm text-white/70 max-w-md">
              {analysis.requestedUniqueCount === 0
                ? "Add one or more flight identifiers to see statistics."
                : "The requested flight identifiers are not present in the current dataset."}
            </div>
            {analysis.missingIds.length > 0 && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                Missing: {analysis.missingIds.slice(0, 6).join(", ")}
                {analysis.missingIds.length > 6 ? "…" : ""}
              </div>
            )}
          </div>
        ) : (
          <>
            {analysis.missingCount > 0 && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
                Unable to locate {formatCount(analysis.missingCount)} of {formatCount(analysis.requestedUniqueCount)} selected flights in the current dataset.
                {analysis.missingIds.length > 0 && (
                  <div className="mt-1 opacity-80">
                    Missing: {analysis.missingIds.slice(0, 6).join(", ")}
                    {analysis.missingIds.length > 6 ? "…" : ""}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  label: "Flights analyzed",
                  value: formatCount(matchedCount),
                  helper: analysis.requestedUniqueCount > matchedCount
                    ? `Matched ${formatCount(matchedCount)} of ${formatCount(analysis.requestedUniqueCount)}`
                    : undefined,
                },
                {
                  label: "Distinct origins",
                  value: formatCount(analysis.uniqueOrigins),
                },
                {
                  label: "Distinct destinations",
                  value: formatCount(analysis.uniqueDestinations),
                },
                {
                  label: "Distinct routes",
                  value: formatCount(analysis.routeCount),
                },
                {
                  label: "Earliest takeoff",
                  value: formatTimeOfDay(analysis.earliestTakeoff),
                  helper: analysis.takeoffKnown > 0
                    ? `Based on ${formatCount(analysis.takeoffKnown)} flights`
                    : "Not available",
                },
                {
                  label: "Latest takeoff",
                  value: formatTimeOfDay(analysis.latestTakeoff),
                  helper: analysis.takeoffKnown > 0 ? undefined : "Not available",
                },
                {
                  label: "Average duration",
                  value: formatDuration(analysis.durations.average),
                  helper: analysis.durations.count > 0
                    ? `Across ${formatCount(analysis.durations.count)} flights`
                    : "Not available",
                },
                {
                  label: "Median duration",
                  value: formatDuration(analysis.durations.median),
                  helper: analysis.durations.count > 0 ? undefined : "Not available",
                },
                {
                  label: "Longest duration",
                  value: formatDuration(analysis.durations.max),
                  helper: analysis.longestFlight
                    ? `${analysis.longestFlight.origin} → ${analysis.longestFlight.destination} (${analysis.longestFlight.callSign ?? analysis.longestFlight.id})`
                    : "Not available",
                },
              ].map((metric, idx) => (
                <div key={`${metric.label}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">{metric.label}</div>
                  <div className="text-2xl font-semibold text-white">{metric.value}</div>
                  {metric.helper && (
                    <div className="text-[12px] text-white/60 mt-1">{metric.helper}</div>
                  )}
                </div>
              ))}
            </div>

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
                        Flight list share {formatPercent(occupancySummary.selected / occupancySummary.total)}
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
                      <option value="selected_total">Flight list total</option>
                      <option value="selected_share">Flight list share</option>
                      <option value="peak_selected">Flight list peak</option>
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
                    Warning: bin size mismatch between total counts ({formatNumber(overallCountsState.data?.time_bin_minutes ?? NaN)} min) and filtered counts ({formatNumber(flightCountsState.data?.time_bin_minutes ?? NaN)} min).
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
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rankedCards.map(card => (
                      <div key={`occupancy-${card.tvId}`} className="bg-white/5 border border-white/10 rounded-xl p-3">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="text-sm font-semibold text-white truncate" title={card.tvId}>{card.tvId}</div>
                          <div className="text-right text-[11px] text-white/70 leading-tight">
                            <div>{formatPercent(card.metrics.share)} share</div>
                            <div>{formatNumber(card.metrics.selectedSum)} / {formatNumber(card.metrics.totalSum)}</div>
                          </div>
                        </div>
                        <div className="text-[11px] text-white/60 mb-2 flex flex-wrap gap-3">
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-sm bg-sky-400" />
                            Flight list
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-sm bg-slate-400" />
                            Others
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
                                  if (name === "selected") return [formatNumber(num), "Flight list"];
                                  if (name === "other") return [formatNumber(num), "Others"];
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
                              <Bar dataKey="selected" stackId="count" fill="#38bdf8" name="Flight list" />
                              <Bar dataKey="other" stackId="count" fill="#94a3b8" name="Others" />
                              {card.hasCapacity && (
                                <Line type="stepAfter" dataKey="capacity" stroke="#facc15" strokeWidth={1.5} dot={false} name="Capacity" />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="mt-2 text-[11px] text-white/60 flex flex-wrap gap-3">
                          <span>Peak {formatNumber(card.metrics.peakSelected)} / {formatNumber(card.metrics.peakTotal)}</span>
                          {card.metrics.exceedance > 0 && (
                            <span>Exceed {formatNumber(card.metrics.exceedance)}</span>
                          )}
                          <span>{formatCount(card.rows.length)} bins · {occupancyMinutesPerBin}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Top origins</div>
                  <div className="text-xs text-white/60">
                    {analysis.topOrigins.limitApplied > 0
                      ? `Top ${analysis.topOrigins.limitApplied} cover ${formatPercent(topOriginsCoverage)} of departures`
                      : "No departure data"}
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
                  <div className="text-xs text-white/60">
                    {analysis.topDestinations.limitApplied > 0
                      ? `Top ${analysis.topDestinations.limitApplied} cover ${formatPercent(topDestinationsCoverage)} of arrivals`
                      : "No arrival data"}
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
                    <div className="text-xs text-white/60">
                      {topAirport.airport} leads with {formatCount(topAirport.total)} touches ({formatPercent(topAirportShare)})
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
                        <Bar dataKey="originCount" name="Origins" fill={ORIGIN_BAR_COLOR} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="destinationCount" name="Destinations" fill={DESTINATION_BAR_COLOR} radius={[4, 4, 0, 0]} />
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
                  <div className="text-xs text-white/60">
                    {analysis.busiestTakeoffHour
                      ? `Peak at ${analysis.busiestTakeoffHour.label} (${formatCount(analysis.busiestTakeoffHour.flights)} flights)`
                      : analysis.takeoffKnown > 0
                        ? "Even distribution"
                        : "No takeoff data"}
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
                        <Bar dataKey="flights" name="Flights" fill="#38bdf8" radius={[4, 4, 0, 0]} />
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
                  <div className="text-xs text-white/60">
                    {analysis.routeCount > 0
                      ? `${formatCount(analysis.routeCount)} distinct routes · Top ${Math.min(topRoutes.length, 10)} cover ${formatPercent(topRoutesShare)}`
                      : "No route data"}
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
    </ModalDialog>
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

function extractCounts(data: CountsResponse | null | undefined): Record<string, number[]> {
  if (!data) return {};
  const mentioned = data.mentioned_counts;
  if (mentioned && Object.keys(mentioned).length > 0) return mentioned;
  return data.counts ?? {};
}

function extractCapacities(data: CountsResponse | null | undefined): Record<string, number[]> | undefined {
  if (!data) return undefined;
  const mentioned = data.mentioned_capacity;
  if (mentioned && Object.keys(mentioned).length > 0) return mentioned;
  return data.capacity ?? undefined;
}

function shortenLabel(label: string): string {
  if (!label) return "";
  const dash = label.indexOf("-");
  const short = dash > 0 ? label.slice(0, dash) : label;
  return short.trim();
}

function rollingSum(arr: number[], windowSize: number): number[] {
  const n = arr.length;
  if (n === 0) return [];
  if (windowSize <= 1) {
    return arr.map(v => clampNonNegative(v));
  }
  const out = new Array(n).fill(0);
  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    windowSum += clampNonNegative(arr[i]);
    if (i >= windowSize) {
      windowSum -= clampNonNegative(arr[i - windowSize]);
    }
    out[i] = windowSum;
  }
  return out;
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
