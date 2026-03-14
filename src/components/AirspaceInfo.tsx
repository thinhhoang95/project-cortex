"use client";

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import { normalizeCapacity } from "@/lib/capacity";
import { formatDwellingTime } from "@/lib/dwellTime";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { formatFlightLevelRange } from "@/lib/trafficVolumeFormat";
import { getDerivedCapacityRangeForTvAsync } from "@/lib/tvCapacityRanges";
import HourGlass from "@/components/HourGlass";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import FlightLevelBinCountChart from "@/components/FlightLevelBinCountChart";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";
import {
  buildMergedMultiTvChartRows,
  buildRollingChartDataFromOccupancy,
  compareIntersectionFlightRows,
  filterChartRowsByWindow,
  intersectStringSets,
  type FlightSortMetric,
  type MergedMultiTvChartRow,
  type RollingChartDataPoint,
} from "@/lib/airspaceInfoMultiTv";
import { type FlightLevelCountsPayload } from "@/lib/flightLevelBinCounts";

interface OccupancyData {
  traffic_volume_id: string;
  occupancy_counts: Record<string, number>;
  hourly_capacity: Record<string, number>;
  anchor_capacity?: Record<string, number>;
  flight_level_counts?: FlightLevelCountsPayload;
  metadata: {
    time_bin_minutes: number;
    total_time_windows: number;
    total_flights_in_tv: number;
  };
}

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

type FlightTableRow = {
  flightId: string;
  callsign: string;
  origin: string;
  destination: string;
  takeoffTime: string;
  perTv: Record<string, TvFlightCell>;
  sortMetric: FlightSortMetric;
};

type ChartSeriesMeta = {
  tvId: string;
  countKey: string;
  capacityKey: string;
  color: string;
  isPrimary: boolean;
};

const MAX_VISIBLE = 20;
const MAX_FLIGHT_ROWS = 500;
const CHART_COLORS = [
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#a78bfa",
];

function AirspaceCustomTooltip({
  active,
  payload,
  label,
  chartSeries,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  chartSeries: ChartSeriesMeta[];
}) {
  if (!active) return null;
  const row = (payload || []).find((entry) => entry?.payload)?.payload as MergedMultiTvChartRow | undefined;
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

export default function AirspaceInfo() {
  const {
    selectedTrafficVolume,
    selectedTrafficVolumes,
    selectedTrafficVolumeData,
    t,
    flights,
    focusMode,
    setFocusMode,
    setFocusFlightIds,
    setT,
    setFlowPreviewFlightId,
  } = useSimStore();

  const deferredT = useDeferredValue(t);

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
  const secondaryTvIds = selectedTvIds.slice(1);
  const currentTimeStr = useMemo(() => formatTimeForAPI(t), [t]);

  const [occupancyByTv, setOccupancyByTv] = useState<Record<string, OccupancyData>>({});
  const [flightDataByTv, setFlightDataByTv] = useState<Record<string, TvFlightsPayload>>({});
  const [loading, setLoading] = useState(false);
  const [flightListLoading, setFlightListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flightListError, setFlightListError] = useState<string | null>(null);
  const [interestWindowLength, setInterestWindowLength] = useState<string>("1h");
  const [expanded, setExpanded] = useState(false);
  const [capacityRangeLabel, setCapacityRangeLabel] = useState<string | null>(null);
  const occupancyRequestSeq = useRef(0);
  const flightsRequestSeq = useRef(0);

  const flightLevelRange = formatFlightLevelRange(
    selectedTrafficVolumeData?.properties?.min_fl,
    selectedTrafficVolumeData?.properties?.max_fl,
  );

  useEffect(() => {
    const reqId = ++occupancyRequestSeq.current;
    if (!selectedTvIds.length) {
      setOccupancyByTv({});
      setLoading(false);
      setError(null);
      return;
    }
    const hasCachedSelection = selectedTvIds.every((tvId) =>
      Object.prototype.hasOwnProperty.call(occupancyByTv, tvId),
    );
    if (hasCachedSelection) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    Promise.all(
      selectedTvIds.map(async (trafficVolumeId) => {
        const response = await authFetch(
          `/api/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}`,
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(
            errorData.error || `Failed to fetch occupancy data (${response.statusText})`,
          );
        }

        const data: OccupancyData = await response.json();
        return [trafficVolumeId, data] as const;
      }),
    )
      .then((entries) => {
        if (reqId !== occupancyRequestSeq.current) return;
        setOccupancyByTv(Object.fromEntries(entries));
        setLoading(false);
      })
      .catch((err) => {
        if (reqId !== occupancyRequestSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to fetch occupancy data");
        setOccupancyByTv({});
        setLoading(false);
      });
  }, [selectedTvKey, t, selectedTvIds, occupancyByTv]);

  useEffect(() => {
    const reqId = ++flightsRequestSeq.current;
    if (!selectedTvIds.length) {
      setFlightDataByTv({});
      setFlightListLoading(false);
      setFlightListError(null);
      return;
    }

    setFlightListLoading(true);
    setFlightListError(null);

    Promise.all(
      selectedTvIds.map(async (trafficVolumeId) => {
        const response = await authFetch(
          `/api/tv_flights?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}&ref_time_str=${encodeURIComponent(currentTimeStr)}`,
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(
            errorData.error || `Failed to fetch flight data (${response.statusText})`,
          );
        }

        const data = await response.json();
        const payload: TvFlightsPayload = data.ordered_flights && data.details
          ? { kind: "ordered", data: data as OrderedFlightsData }
          : { kind: "legacy", data: data as FlightIdentifiersData };
        return [trafficVolumeId, payload] as const;
      }),
    )
      .then((entries) => {
        if (reqId !== flightsRequestSeq.current) return;
        setFlightDataByTv(Object.fromEntries(entries));
        setFlightListLoading(false);
      })
      .catch((err) => {
        if (reqId !== flightsRequestSeq.current) return;
        setFlightListError(err instanceof Error ? err.message : "Failed to fetch flight identifiers");
        setFlightDataByTv({});
        setFlightListLoading(false);
      });
  }, [selectedTvKey, currentTimeStr, selectedTvIds]);

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
  }, [primaryTvId]);

  useEffect(() => {
    return () => {
      setFlowPreviewFlightId(null);
    };
  }, [setFlowPreviewFlightId]);

  useEffect(() => {
    setExpanded(false);
  }, [selectedTvKey, t, focusMode, interestWindowLength, flightListError]);

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights || []) {
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  const occupancyReadyForSelection =
    selectedTvIds.length > 0 && selectedTvIds.every((tvId) => Object.prototype.hasOwnProperty.call(occupancyByTv, tvId));
  const flightDataReadyForSelection =
    selectedTvIds.length > 0 && selectedTvIds.every((tvId) => Object.prototype.hasOwnProperty.call(flightDataByTv, tvId));

  const { chartDataByTv, timeBinMinutesByTv } = useMemo(() => {
    const nextChartDataByTv: Record<string, RollingChartDataPoint[]> = {};
    const nextTimeBinMinutesByTv: Record<string, number> = {};

    for (const tvId of selectedTvIds) {
      const occupancy = occupancyByTv[tvId];
      if (!occupancy) continue;
      const { chartData, timeBinMinutes } = buildRollingChartDataFromOccupancy(occupancy);
      nextChartDataByTv[tvId] = chartData;
      nextTimeBinMinutesByTv[tvId] = timeBinMinutes;
    }

    return { chartDataByTv: nextChartDataByTv, timeBinMinutesByTv: nextTimeBinMinutesByTv };
  }, [selectedTvIds, occupancyByTv]);

  const chartSeries = useMemo<ChartSeriesMeta[]>(() => {
    return selectedTvIds.map((tvId, index) => ({
      tvId,
      countKey: `tv_${index}_count`,
      capacityKey: `tv_${index}_capacity`,
      color: CHART_COLORS[index % CHART_COLORS.length],
      isPrimary: index === 0,
    }));
  }, [selectedTvKey]);

  const chartKeyByTv = useMemo(() => {
    const map: Record<string, { countKey: string; capacityKey: string }> = {};
    for (const series of chartSeries) {
      map[series.tvId] = { countKey: series.countKey, capacityKey: series.capacityKey };
    }
    return map;
  }, [chartSeries]);

  const mergedChartRows = useMemo<MergedMultiTvChartRow[]>(() => {
    if (!occupancyReadyForSelection || error || !selectedTvIds.length) return [];
    return buildMergedMultiTvChartRows({
      selectedTvIds,
      chartDataByTv,
      keyByTv: chartKeyByTv,
    });
  }, [selectedTvIds, occupancyReadyForSelection, error, chartDataByTv, chartKeyByTv]);

  const primaryOccupancyData = primaryTvId ? occupancyByTv[primaryTvId] ?? null : null;
  const primaryChartData = primaryTvId ? chartDataByTv[primaryTvId] ?? [] : [];
  const primaryTimeBinMinutes = primaryTvId ? timeBinMinutesByTv[primaryTvId] ?? 60 : 60;

  const windowSeconds = useMemo(
    () => getInterestWindowSeconds(interestWindowLength),
    [interestWindowLength],
  );

  const displayChartRows = useMemo(() => {
    if (!focusMode) return mergedChartRows;
    return filterChartRowsByWindow(mergedChartRows, deferredT, windowSeconds);
  }, [focusMode, mergedChartRows, deferredT, windowSeconds]);

  const primaryDisplayChartData = useMemo(() => {
    if (!focusMode) return primaryChartData;
    return filterChartRowsByWindow(primaryChartData, deferredT, windowSeconds);
  }, [focusMode, primaryChartData, deferredT, windowSeconds]);

  const currentTimeHours = t / 3600;

  const { intersectionFlightRows, hasAnyOrderedFlightData, primaryFlightPayload } = useMemo(() => {
    if (!selectedTvIds.length || !flightDataReadyForSelection || flightListError) {
      return {
        intersectionFlightRows: [] as FlightTableRow[],
        hasAnyOrderedFlightData: false,
        primaryFlightPayload: null as TvFlightsPayload | null,
      };
    }

    const membershipSets: Array<Set<string>> = [];
    const orderedDetailMapByTv: Record<string, Map<string, OrderedFlightsData["details"][number]>> = {};
    const legacyWindowStartByTv: Record<string, Map<string, number | null>> = {};
    let anyOrdered = false;

    for (const tvId of selectedTvIds) {
      const payload = flightDataByTv[tvId];
      if (!payload) {
        return {
          intersectionFlightRows: [] as FlightTableRow[],
          hasAnyOrderedFlightData: false,
          primaryFlightPayload: null as TvFlightsPayload | null,
        };
      }

      if (payload.kind === "ordered") {
        anyOrdered = true;
        const membership = new Set<string>();
        for (const fid of payload.data.ordered_flights || []) {
          membership.add(String(fid));
        }
        if (membership.size === 0) {
          for (const detail of payload.data.details || []) {
            membership.add(String(detail.flight_id));
          }
        }
        membershipSets.push(membership);

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
        membershipSets.push(membership);
        legacyWindowStartByTv[tvId] = startMap;
      }
    }

    const intersectionIds = Array.from(intersectStringSets(membershipSets));
    const rows: FlightTableRow[] = intersectionIds.map((flightId) => {
      const flight = flightsById.get(String(flightId));
      const perTv: Record<string, TvFlightCell> = {};
      const sortPerTv: FlightSortMetric["perTv"] = {};

      for (const tvId of selectedTvIds) {
        const payload = flightDataByTv[tvId];
        if (!payload) continue;

        if (payload.kind === "ordered") {
          const detail = orderedDetailMapByTv[tvId]?.get(String(flightId));
          const arrivalSeconds =
            detail && typeof detail.arrival_seconds === "number" && Number.isFinite(detail.arrival_seconds)
              ? detail.arrival_seconds
              : null;
          const deltaSeconds =
            detail && typeof detail.delta_seconds === "number" && Number.isFinite(detail.delta_seconds)
              ? detail.delta_seconds
              : null;
          const cell: TvFlightCell = {
            arrivalTime: detail?.arrival_time || "N/A",
            dwellSeconds: detail?.dwell_seconds ?? null,
            arrivalSeconds,
            deltaSeconds,
            windowStartSeconds: null,
          };
          perTv[tvId] = cell;
          sortPerTv[tvId] = {
            arrivalSeconds: cell.arrivalSeconds,
            deltaSeconds: cell.deltaSeconds,
            windowStartSeconds: cell.windowStartSeconds,
          };
        } else {
          const windowStartSeconds = legacyWindowStartByTv[tvId]?.get(String(flightId)) ?? null;
          const cell: TvFlightCell = {
            arrivalTime: "N/A",
            dwellSeconds: null,
            arrivalSeconds: null,
            deltaSeconds: null,
            windowStartSeconds,
          };
          perTv[tvId] = cell;
          sortPerTv[tvId] = {
            arrivalSeconds: null,
            deltaSeconds: null,
            windowStartSeconds,
          };
        }
      }

      return {
        flightId: String(flightId),
        callsign: flight?.callSign || "N/A",
        origin: flight?.origin || "N/A",
        destination: flight?.destination || "N/A",
        takeoffTime: flight ? formatTime(flight.t0) : "N/A",
        perTv,
        sortMetric: {
          flightId: String(flightId),
          perTv: sortPerTv,
        },
      };
    });

    rows.sort((a, b) => compareIntersectionFlightRows(a.sortMetric, b.sortMetric, primaryTvId));

    return {
      intersectionFlightRows: rows,
      hasAnyOrderedFlightData: anyOrdered,
      primaryFlightPayload: primaryTvId ? flightDataByTv[primaryTvId] ?? null : null,
    };
  }, [selectedTvIds, flightDataReadyForSelection, flightListError, flightDataByTv, flightsById, primaryTvId]);

  const { displayFlightTableData, filteredFlightIds } = useMemo(() => {
    if (!selectedTvIds.length || !flightDataReadyForSelection || flightListError) {
      return {
        displayFlightTableData: [] as FlightTableRow[],
        filteredFlightIds: new Set<string>(),
      };
    }

    let rows = intersectionFlightRows;
    if (focusMode) {
      const windowEnd = deferredT + windowSeconds;
      rows = rows.filter((row) =>
        selectedTvIds.some((tvId) => {
          const metric = row.sortMetric.perTv[tvId];
          if (!metric) return false;
          const candidate =
            typeof metric.arrivalSeconds === "number" && Number.isFinite(metric.arrivalSeconds)
              ? metric.arrivalSeconds
              : typeof metric.windowStartSeconds === "number" && Number.isFinite(metric.windowStartSeconds)
                ? metric.windowStartSeconds
                : null;
          return candidate !== null && candidate >= deferredT && candidate <= windowEnd;
        }),
      );
    }

    const capped = rows.slice(0, MAX_FLIGHT_ROWS);
    return {
      displayFlightTableData: capped,
      filteredFlightIds: new Set(capped.map((row) => String(row.flightId))),
    };
  }, [selectedTvIds, flightDataReadyForSelection, flightListError, intersectionFlightRows, focusMode, deferredT, windowSeconds]);

  const hiddenFlightCount = Math.max(0, displayFlightTableData.length - MAX_VISIBLE);

  const visibleFlightTableData = useMemo(() => {
    if (!expanded && displayFlightTableData.length > MAX_VISIBLE) {
      return displayFlightTableData.slice(0, MAX_VISIBLE);
    }
    return displayFlightTableData;
  }, [displayFlightTableData, expanded]);

  const hourGlassData = useMemo(() => {
    if (!primaryTvId || !primaryFlightPayload || displayFlightTableData.length === 0) {
      return [] as string[];
    }

    const want = new Set(displayFlightTableData.map((f) => String(f.flightId)));

    if (primaryFlightPayload.kind === "ordered") {
      const arr: string[] = [];
      for (const detail of primaryFlightPayload.data.details || []) {
        if (want.has(String(detail.flight_id)) && detail.arrival_time) {
          arr.push(String(detail.arrival_time));
        }
      }
      return arr;
    }

    const idToStart = new Map<string, string>();
    for (const [timeWindow, ids] of Object.entries(primaryFlightPayload.data || {})) {
      const start = String(timeWindow.split("-")[0] || "").trim();
      for (const id of ids || []) {
        const key = String(id);
        if (!idToStart.has(key)) idToStart.set(key, start);
      }
    }

    const arr: string[] = [];
    for (const row of displayFlightTableData) {
      const timeLabel = idToStart.get(String(row.flightId));
      if (timeLabel) arr.push(timeLabel);
    }
    return arr;
  }, [primaryTvId, primaryFlightPayload, displayFlightTableData]);

  useEffect(() => {
    if (!focusMode) return;
    const current = useSimStore.getState().focusFlightIds;
    if (!areSetsEqual(current, filteredFlightIds)) {
      setFocusFlightIds(filteredFlightIds);
    }
  }, [focusMode, filteredFlightIds, setFocusFlightIds]);

  const currentXAxisCategory = displayChartRows.length
    ? (displayChartRows.find((d) => currentTimeHours <= d.hour) ?? displayChartRows[displayChartRows.length - 1]).time
    : undefined;

  const currentCount = primaryDisplayChartData.length
    ? (primaryDisplayChartData.find((d) => currentTimeHours <= d.hour) ?? primaryDisplayChartData[primaryDisplayChartData.length - 1]).count
    : 0;

  const currentAnchorCapacity = useMemo(() => {
    if (!primaryOccupancyData || !Number.isFinite(primaryTimeBinMinutes) || primaryTimeBinMinutes <= 0) {
      return undefined;
    }
    const minutesPerDay = 24 * 60;
    const totalMinutes = Math.floor(t / 60) % minutesPerDay;
    const binStartMinutes = totalMinutes - (totalMinutes % primaryTimeBinMinutes);
    const hours = Math.floor(binStartMinutes / 60);
    const minutes = binStartMinutes % 60;
    const anchorKey = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    const hourKey = `${hours.toString().padStart(2, "0")}:00-${(hours + 1).toString().padStart(2, "0")}:00`;
    const value = primaryOccupancyData.anchor_capacity?.[anchorKey] ?? primaryOccupancyData.hourly_capacity?.[hourKey];
    const normalized = normalizeCapacity(value);
    return typeof normalized === "number" ? normalized : undefined;
  }, [primaryOccupancyData, primaryTimeBinMinutes, t]);

  const windowAnchorCapacityRange = useMemo(() => {
    if (!focusMode) return null;
    const values = primaryDisplayChartData
      .map((d) => (typeof d.capacity === "number" && Number.isFinite(d.capacity) ? d.capacity : null))
      .filter((v): v is number => v !== null);
    if (!values.length) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [primaryDisplayChartData, focusMode]);

  const windowCapacityLabel = windowAnchorCapacityRange
    ? `${Math.round(windowAnchorCapacityRange.min)}–${Math.round(windowAnchorCapacityRange.max)}`
    : null;

  const summaryGridClassName = typeof currentAnchorCapacity === "number"
    ? "grid grid-cols-2 md:grid-cols-3 gap-3"
    : "grid grid-cols-2 gap-3";

  const trafficOverloadSegments = useMemo(() => {
    if (!primaryDisplayChartData.length) {
      return { data: [], fromTime: undefined as string | undefined, toTime: undefined as string | undefined };
    }

    let firstStart: string | undefined;
    let lastEnd: string | undefined;

    const data = primaryDisplayChartData.map((point) => {
      const [rawStart = "", rawEnd = ""] = point.time.split("-");
      const start = rawStart.trim();
      const end = rawEnd.trim();
      if (!firstStart && start) firstStart = start;
      if (end) lastEnd = end;

      const occupancy = Number(point.count ?? 0);
      const capacity = Number(point.capacity ?? 0);
      const ratio = capacity > 0 ? occupancy / capacity : 0;

      let color = "#34d399";
      if (capacity <= 0) {
        color = "#94a3b8";
      } else if (ratio >= 1.4) {
        color = "#b91c1c";
      } else if (ratio >= 1.2) {
        color = "#f97316";
      } else if (ratio >= 1.0) {
        color = "#fb923c";
      }

      const metadata: string[] = [`Rolling occupancy: ${Math.round(occupancy)}`];
      if (capacity > 0) {
        metadata.push(`Anchor capacity (rolling hour): ${Math.round(capacity)}`);
        metadata.push(`Load ratio: ${(occupancy / capacity).toFixed(2)}`);
        const diff = occupancy - capacity;
        metadata.push(`${diff >= 0 ? "Excess" : "Available"}: ${Math.abs(Math.round(diff))}`);
      } else {
        metadata.push("Anchor capacity unavailable");
      }

      return {
        period: point.time,
        color,
        metadata,
        label: primaryTvId ? `${primaryTvId} load (primary)` : undefined,
      };
    });

    return {
      data,
      fromTime: firstStart,
      toTime: lastEnd,
    };
  }, [primaryDisplayChartData, primaryTvId]);

  const formatXAxisTick = (tickItem: string, index: number) => {
    if (index % 12 === 0) {
      const [startTime] = tickItem.split("-");
      const [hours] = startTime.split(":").map(Number);
      return hours.toString();
    }
    return "";
  };

  const dynamicFlightColumnCount = selectedTvIds.length * 2;
  const tableColSpan = 4 + dynamicFlightColumnCount;

  const renderTooltip = useCallback(
    (props: any) => <AirspaceCustomTooltip {...props} chartSeries={chartSeries} />,
    [chartSeries],
  );

  return (
    <div className="space-y-4">
      {selectedTvIds.length === 0 ? (
        <div className="text-center py-8 opacity-70">
          <p className="text-sm">Click on a traffic volume to view occupancy data</p>
        </div>
      ) : (
        <>
          <div className="border-b border-white/20 pb-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <h3 className="font-medium text-sm opacity-90">Selected Traffic Volumes ({selectedTvIds.length})</h3>
                {primaryTvId && <p className="text-lg font-semibold break-all">{primaryTvId}</p>}
                {secondaryTvIds.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {secondaryTvIds.map((tvId) => (
                      <p key={tvId} className="text-xs opacity-75 break-all">
                        {tvId}
                      </p>
                    ))}
                  </div>
                )}
                {flightLevelRange && (
                  <p className="text-xs opacity-70 mt-1">Primary FL range: {flightLevelRange}</p>
                )}
                {capacityRangeLabel && (
                  <p className="text-xs opacity-70 mt-1">Primary capacity range: {capacityRangeLabel}</p>
                )}
              </div>
              <button
                onClick={() => {
                  const newFocusMode = !focusMode;
                  setFocusMode(newFocusMode);
                  if (!newFocusMode) {
                    setFocusFlightIds(new Set());
                  }
                }}
                className={`flex flex-col items-center px-3 py-2 rounded-lg backdrop-blur-sm border transition-all duration-200 min-w-[70px] ${
                  focusMode
                    ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                    : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30"
                }`}
              >
                <div className="text-lg mb-1">🎯</div>
                <span className="text-xs font-medium">Focus</span>
              </button>
            </div>
          </div>

          {focusMode && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm opacity-90">Interest Window Length</h4>
              <div className="grid grid-cols-4 gap-2">
                {["15", "30", "45", "1h", "2h", "4h", "6h"].map((duration) => (
                  <button
                    key={duration}
                    onClick={() => setInterestWindowLength(duration)}
                    className={`px-3 py-2 text-xs font-medium rounded-md backdrop-blur-sm border transition-all duration-200 ${
                      interestWindowLength === duration
                        ? "bg-blue-500/30 border-blue-400/50 text-blue-200"
                        : "bg-white/10 border-white/20 text-white/80 hover:bg-white/15 hover:border-white/30"
                    }`}
                  >
                    {duration}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]" />
              <span className="ml-2 text-sm opacity-70">Loading traffic volumes...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-3">
              <p className="text-sm text-red-200">Error: {error}</p>
            </div>
          )}

          {occupancyReadyForSelection && !loading && !error && primaryOccupancyData && (
            <div className="space-y-4">
              <div className={summaryGridClassName}>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Primary TV Movements</p>
                  <p className="text-lg font-semibold">{primaryOccupancyData.metadata.total_flights_in_tv}</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3">
                  <p className="text-xs opacity-70">Primary Current Count</p>
                  <p className="text-lg font-semibold">{currentCount}</p>
                </div>
                {typeof currentAnchorCapacity === "number" && (
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="text-xs opacity-70">Primary Capacity</p>
                    <p className="text-lg font-semibold">{Math.round(currentAnchorCapacity)}</p>
                  </div>
                )}
              </div>
              {focusMode && windowCapacityLabel && (
                <p className="text-xs opacity-70">Primary capacity anchors (window): {windowCapacityLabel}</p>
              )}

              <div className="bg-white/5 rounded-lg p-4">
                <h4 className="font-medium text-sm mb-3 opacity-90">Rolling Hour Occupancy & Anchor Capacity (Multi-TV)</h4>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={displayChartRows} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={2} barGap={1}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickFormatter={formatXAxisTick}
                        interval={0}
                        tickMargin={0}
                        padding={{ left: 0, right: 0 }}
                        height={16}
                      />
                      <YAxis
                        tick={{ fill: "#e2e8f0", fontSize: 10 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickMargin={0}
                        width={32}
                      />
                      <Tooltip content={renderTooltip} />
                      {chartSeries.map((series) => (
                        <Bar
                          key={series.countKey}
                          dataKey={series.countKey}
                          fill={series.color}
                          fillOpacity={series.isPrimary ? 0.95 : 0.5}
                          radius={[2, 2, 0, 0]}
                          onClick={(_, index) => {
                            const point = displayChartRows[index];
                            if (point && point.hour !== undefined) {
                              setT(point.hour * 3600);
                            }
                          }}
                          style={{ cursor: "pointer" }}
                          isAnimationActive={false}
                        />
                      ))}
                      {chartSeries.map((series) => (
                        <Line
                          key={series.capacityKey}
                          type="linear"
                          dataKey={series.capacityKey}
                          stroke={series.color}
                          strokeWidth={series.isPrimary ? 2.25 : 1.5}
                          strokeDasharray={series.isPrimary ? "0" : "4 3"}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      ))}
                      {currentXAxisCategory && (
                        <ReferenceLine
                          x={currentXAxisCategory}
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="0"
                          label={{ value: "Current Time", position: "top", fill: "#ef4444", fontSize: 10 }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1 text-xs opacity-80">
                  {chartSeries.map((series) => (
                    <div key={`legend-${series.tvId}`} className="flex items-center gap-2 flex-wrap">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: series.color, opacity: series.isPrimary ? 1 : 0.6 }} />
                      <span>{series.tvId}{series.isPrimary ? " (Primary)" : ""}</span>
                      <div className="w-4 h-0.5" style={{ backgroundColor: series.color }} />
                      <span className="opacity-70">capacity</span>
                    </div>
                  ))}
                </div>
              </div>

              <FlightLevelBinCountChart
                data={primaryOccupancyData.flight_level_counts}
                trafficVolumeId={primaryTvId}
                filterToWindow={focusMode}
                windowStartSeconds={deferredT}
                windowSeconds={windowSeconds}
              />

              {trafficOverloadSegments.data.length > 0 && (
                <div className="bg-white/5 rounded-lg p-4">
                  <h4 className="font-medium text-sm mb-3 opacity-90">Traffic Volume Load (Primary TV)</h4>
                  <TrafficOverloadBar
                    fromTime={trafficOverloadSegments.fromTime}
                    toTime={trafficOverloadSegments.toTime}
                    data={trafficOverloadSegments.data}
                    height={16}
                    showTime
                  />
                </div>
              )}
            </div>
          )}

          <div className="bg-white/5 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h4 className="font-medium text-sm opacity-90">Flight List (Intersection)</h4>
                <FlightStatisticsButton
                  flightIds={displayFlightTableData.map((flight) => flight.flightId)}
                  sourceTrafficVolumeId={primaryTvId}
                  buttonClassName="border-white/20 text-white/80"
                />
              </div>
              {focusMode && (
                <span className="text-xs bg-blue-500/20 text-blue-200 px-2 py-1 rounded border border-blue-400/30 whitespace-nowrap">
                  Focus Mode: {interestWindowLength}
                </span>
              )}
            </div>

            {hourGlassData.length > 0 && (
              <HourGlass data={hourGlassData} label height={12} className="my-2" />
            )}

            {flightListLoading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]" />
                <span className="ml-2 text-xs opacity-70">Loading flights...</span>
              </div>
            )}

            {flightListError && (
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-2 mb-3">
                <p className="text-xs text-red-200">Error: {flightListError}</p>
              </div>
            )}

            {displayFlightTableData.length > 0 && !flightListLoading && !flightListError && (
              <div className="rounded-lg border border-white/10 overflow-x-auto">
                <table className="w-full min-w-max text-xs">
                  <thead>
                    <tr className="bg-white/10">
                      <th className="text-left p-2 font-semibold">CS</th>
                      <th className="text-left p-2 font-semibold">Ori.</th>
                      <th className="text-left p-2 font-semibold">Des.</th>
                      <th className="text-left p-2 font-semibold">T/O</th>
                      {selectedTvIds.map((tvId) => (
                        <Fragment key={`cols-${tvId}`}>
                          <th className="text-left p-2 font-semibold whitespace-nowrap">
                            Arr. ({tvId})
                          </th>
                          <th className="text-left p-2 font-semibold whitespace-nowrap">
                            Dwell ({tvId})
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFlightTableData.map((flight, index) => (
                      <tr
                        key={flight.flightId}
                        className={`border-t border-white/10 ${index % 2 === 0 ? "bg-white/0" : "bg-white/5"} hover:bg-white/10 cursor-pointer`}
                        onMouseEnter={() => setFlowPreviewFlightId(String(flight.flightId))}
                        onMouseLeave={() => setFlowPreviewFlightId(null)}
                        onClick={() => {
                          const fullFlight = flights.find((f) => String(f.flightId) === String(flight.flightId));
                          if (fullFlight) {
                            window.dispatchEvent(
                              new CustomEvent("flight-search-select", {
                                detail: { flight: fullFlight },
                              }),
                            );
                          }
                        }}
                      >
                        <td className="p-2 font-mono">{flight.callsign}</td>
                        <td className="p-2">{flight.origin}</td>
                        <td className="p-2">{flight.destination}</td>
                        <td className="p-2 text-right font-mono">{flight.takeoffTime}</td>
                        {selectedTvIds.map((tvId) => (
                          <Fragment key={`${flight.flightId}-${tvId}`}>
                            <td className="p-2 text-right font-mono">
                              {flight.perTv[tvId]?.arrivalTime ?? "N/A"}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {formatDwellingTime(flight.perTv[tvId]?.dwellSeconds)}
                            </td>
                          </Fragment>
                        ))}
                      </tr>
                    ))}
                    {displayFlightTableData.length > MAX_VISIBLE && (
                      <tr
                        className="border-t border-white/10 cursor-pointer hover:bg-white/10"
                        onClick={() => setExpanded(!expanded)}
                      >
                        <td className="p-2 text-center italic opacity-80" colSpan={tableColSpan}>
                          {expanded ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenFlightCount)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {expanded && displayFlightTableData.length === MAX_FLIGHT_ROWS && (
                  <p className="text-xs opacity-70 text-center mt-2">Showing first {MAX_FLIGHT_ROWS} flights</p>
                )}
                <p className="text-xs opacity-70 text-center mt-2">
                  Intersection across {selectedTvIds.length} selected traffic volume{selectedTvIds.length === 1 ? "" : "s"}
                  {hasAnyOrderedFlightData ? `, ordered by proximity to current time (${formatTime(t)})` : ""}
                </p>
              </div>
            )}

            {displayFlightTableData.length === 0 && !flightListLoading && !flightListError && (
              <p className="text-xs opacity-70 text-center py-4">
                {selectedTvIds.length > 1
                  ? "No intersected flights found for the selected traffic volumes"
                  : "No flights found for this traffic volume"}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatTimeForAPI(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, "0")}${minutes.toString().padStart(2, "0")}${secs.toString().padStart(2, "0")}`;
}

function getInterestWindowSeconds(windowLength: string): number {
  const numValue = parseInt(windowLength, 10);
  if (windowLength.includes("h")) {
    return numValue * 3600;
  }
  return numValue * 60;
}

function parseTimeWindowStartSeconds(timeWindow: string): number | null {
  try {
    const [startTime = ""] = String(timeWindow).split("-");
    const [hours = 0, minutes = 0] = startTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 3600 + minutes * 60;
  } catch {
    return null;
  }
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
