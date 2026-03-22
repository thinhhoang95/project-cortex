import { normalizeCapacity } from "./capacity";

export interface OccupancyDataLike {
  occupancy_counts: Record<string, number>;
  hourly_capacity: Record<string, number>;
  anchor_capacity?: Record<string, number>;
  metadata?: {
    time_bin_minutes?: number;
  };
}

export interface RollingChartDataPoint {
  time: string;
  count: number;
  hour: number;
  capacity?: number;
}

export type MergedMultiTvChartRow = {
  time: string;
  hour: number;
  [key: string]: string | number | null | undefined;
};

export type FlightSortMetric = {
  flightId: string;
  perTv: Record<
    string,
    {
      arrivalSeconds: number | null;
      deltaSeconds: number | null;
      windowStartSeconds: number | null;
    }
  >;
};

export function buildRollingChartDataFromOccupancy(
  occupancyData: OccupancyDataLike | null | undefined,
): { chartData: RollingChartDataPoint[]; timeBinMinutes: number } {
  if (!occupancyData) {
    return { chartData: [], timeBinMinutes: 60 };
  }

  const baseChartData: RollingChartDataPoint[] = Object.entries(
    occupancyData.occupancy_counts || {},
  )
    .map(([timeRange, count]) => {
      const [startTime = "00:00"] = String(timeRange).split("-");
      const [hours = 0, minutes = 0] = startTime.split(":").map(Number);
      const hour = hours + minutes / 60;

      const anchorKey = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
      const hourKey = `${hours.toString().padStart(2, "0")}:00-${(hours + 1)
        .toString()
        .padStart(2, "0")}:00`;
      const capacity = normalizeCapacity(
        occupancyData.anchor_capacity?.[anchorKey] ??
          occupancyData.hourly_capacity?.[hourKey],
      );

      return {
        time: timeRange,
        count: Number(count ?? 0),
        hour,
        capacity,
      };
    })
    .sort((a, b) => a.hour - b.hour);

  if (baseChartData.length === 0) {
    return { chartData: [], timeBinMinutes: 60 };
  }

  let timeBinMinutes = 60;
  const metaBin = occupancyData.metadata?.time_bin_minutes;
  if (typeof metaBin === "number" && Number.isFinite(metaBin) && metaBin > 0) {
    timeBinMinutes = metaBin;
  } else {
    try {
      const [start, end] = baseChartData[0].time.split("-");
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      const diff = eh * 60 + em - (sh * 60 + sm);
      if (diff > 0) timeBinMinutes = diff;
    } catch {
      timeBinMinutes = 60;
    }
  }

  const binsPerHour = Math.max(1, Math.round(60 / timeBinMinutes));
  const chartData = baseChartData.map((_, idx) => {
    let rollingSum = 0;
    const endIdx = Math.min(idx + binsPerHour, baseChartData.length);
    for (let j = idx; j < endIdx; j += 1) {
      rollingSum += baseChartData[j].count;
    }
    return { ...baseChartData[idx], count: rollingSum };
  });

  return { chartData, timeBinMinutes };
}

export function buildMergedMultiTvChartRows(params: {
  selectedTvIds: string[];
  chartDataByTv: Record<string, RollingChartDataPoint[]>;
  keyByTv: Record<string, { countKey: string; capacityKey: string }>;
}): MergedMultiTvChartRow[] {
  const { selectedTvIds, chartDataByTv, keyByTv } = params;
  const byTime = new Map<string, MergedMultiTvChartRow>();

  for (const tvId of selectedTvIds) {
    const rows = chartDataByTv[tvId] || [];
    const keys = keyByTv[tvId];
    if (!keys) continue;
    for (const row of rows) {
      const existing = byTime.get(row.time) || { time: row.time, hour: row.hour };
      existing.hour = row.hour;
      existing[keys.countKey] = Number.isFinite(row.count) ? row.count : null;
      existing[keys.capacityKey] =
        typeof row.capacity === "number" && Number.isFinite(row.capacity)
          ? row.capacity
          : null;
      byTime.set(row.time, existing);
    }
  }

  const merged = Array.from(byTime.values()).sort(
    (a, b) => Number(a.hour ?? 0) - Number(b.hour ?? 0),
  );

  for (const row of merged) {
    for (const tvId of selectedTvIds) {
      const keys = keyByTv[tvId];
      if (!keys) continue;
      if (!(keys.countKey in row)) row[keys.countKey] = null;
      if (!(keys.capacityKey in row)) row[keys.capacityKey] = null;
    }
  }

  return merged;
}

export function filterChartRowsByWindow<T extends { hour: number }>(
  rows: T[],
  fromSeconds: number,
  windowSeconds: number,
): T[] {
  const toSeconds = fromSeconds + windowSeconds;
  return rows.filter((row) => {
    const pointTimeSeconds = Number(row.hour ?? 0) * 3600;
    return pointTimeSeconds >= fromSeconds && pointTimeSeconds <= toSeconds;
  });
}

function metricArrivalForWindow(metric: FlightSortMetric["perTv"][string]): number | null {
  if (!metric) return null;
  if (typeof metric.arrivalSeconds === "number" && Number.isFinite(metric.arrivalSeconds)) {
    return metric.arrivalSeconds;
  }
  if (
    typeof metric.windowStartSeconds === "number" &&
    Number.isFinite(metric.windowStartSeconds)
  ) {
    return metric.windowStartSeconds;
  }
  return null;
}

export function matchesSelectedTvTraversalOrder(
  metricByTv: FlightSortMetric["perTv"],
  selectedTvIds: readonly string[],
): boolean {
  if (!selectedTvIds.length) return true;

  let previousComparableTime: number | null = null;

  for (const tvId of selectedTvIds) {
    const comparableTime = metricArrivalForWindow(metricByTv[tvId]);
    if (comparableTime === null) continue;

    if (previousComparableTime !== null && comparableTime < previousComparableTime) {
      return false;
    }

    previousComparableTime = comparableTime;
  }

  // Missing timing data should not exclude the row; this stays best-effort client logic.
  return true;
}

function minAbsDelta(metricByTv: FlightSortMetric["perTv"]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const metric of Object.values(metricByTv)) {
    if (typeof metric.deltaSeconds === "number" && Number.isFinite(metric.deltaSeconds)) {
      best = Math.min(best, Math.abs(metric.deltaSeconds));
    }
  }
  return best;
}

export function compareIntersectionFlightRows(
  a: FlightSortMetric,
  b: FlightSortMetric,
  primaryTvId: string | null | undefined,
): number {
  const aMinAbsDelta = minAbsDelta(a.perTv);
  const bMinAbsDelta = minAbsDelta(b.perTv);
  if (aMinAbsDelta !== bMinAbsDelta) return aMinAbsDelta - bMinAbsDelta;

  const aPrimary = primaryTvId ? a.perTv[primaryTvId] : undefined;
  const bPrimary = primaryTvId ? b.perTv[primaryTvId] : undefined;
  const aPrimaryAbsDelta =
    typeof aPrimary?.deltaSeconds === "number" && Number.isFinite(aPrimary.deltaSeconds)
      ? Math.abs(aPrimary.deltaSeconds)
      : Number.POSITIVE_INFINITY;
  const bPrimaryAbsDelta =
    typeof bPrimary?.deltaSeconds === "number" && Number.isFinite(bPrimary.deltaSeconds)
      ? Math.abs(bPrimary.deltaSeconds)
      : Number.POSITIVE_INFINITY;
  if (aPrimaryAbsDelta !== bPrimaryAbsDelta) return aPrimaryAbsDelta - bPrimaryAbsDelta;

  const aPrimaryArrival = metricArrivalForWindow(aPrimary || { arrivalSeconds: null, deltaSeconds: null, windowStartSeconds: null }) ?? Number.POSITIVE_INFINITY;
  const bPrimaryArrival = metricArrivalForWindow(bPrimary || { arrivalSeconds: null, deltaSeconds: null, windowStartSeconds: null }) ?? Number.POSITIVE_INFINITY;
  if (aPrimaryArrival !== bPrimaryArrival) return aPrimaryArrival - bPrimaryArrival;

  return String(a.flightId).localeCompare(String(b.flightId));
}

export function intersectStringSets(sets: Array<Set<string>>): Set<string> {
  if (!sets.length) return new Set<string>();
  const [first, ...rest] = sets;
  const out = new Set<string>();
  first.forEach((value) => {
    if (rest.every((s) => s.has(value))) out.add(value);
  });
  return out;
}
