import type { OccupancySeriesByTv } from "@/lib/models";

export const OCCUPANCY_CAPACITY_HIDE_THRESHOLD = 998;

export interface OccupancyWindowRange {
  startIndex: number;
  endIndex: number;
}

export type OccupancyWindowSortMode =
  | "total"
  | "abs_change"
  | "relative_change"
  | "exceedance"
  | "total_excess_reduced"
  | "total_excess_induced";

export interface OccupancyTvWindowStats {
  total: number;
  absChange: number;
  relativeDelta: number;
  relativeBase: number;
  exceedance: number;
  totalExcessReduced: number;
  totalExcessInduced: number;
  netDelta: number;
  hasPreSeries: boolean;
  hasPostSeries: boolean;
}

interface ComputeOccupancyTvWindowStatsOptions {
  preSeries?: number[];
  postSeries?: number[];
  capacitySeries?: number[];
  startIndex: number;
  endIndex: number;
  binMinutes: number;
  capacityHideThreshold?: number;
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getOccupancyWindowRange(
  viewFromMinutes: number,
  viewToMinutes: number,
  binMinutes: number,
): OccupancyWindowRange {
  const safeBinMinutes = Number.isFinite(binMinutes) && binMinutes > 0 ? Number(binMinutes) : 1;
  const from = Math.max(0, Math.min(viewFromMinutes, viewToMinutes));
  const to = Math.max(from, Math.max(viewFromMinutes, viewToMinutes));
  return {
    startIndex: Math.max(0, Math.ceil(from / safeBinMinutes)),
    endIndex: Math.max(0, Math.floor(to / safeBinMinutes)),
  };
}

export function computeOccupancyTvWindowStats({
  preSeries,
  postSeries,
  capacitySeries,
  startIndex,
  endIndex,
  binMinutes,
  capacityHideThreshold = Number.POSITIVE_INFINITY,
}: ComputeOccupancyTvWindowStatsOptions): OccupancyTvWindowStats {
  const hasPreSeries = Array.isArray(preSeries) && preSeries.length > 0;
  const hasPostSeries = Array.isArray(postSeries) && postSeries.length > 0;
  const hasCapacitySeries = Array.isArray(capacitySeries) && capacitySeries.length > 0;
  const length =
    hasPreSeries && hasPostSeries
      ? Math.min(preSeries.length, postSeries.length)
      : Math.max(preSeries?.length ?? 0, postSeries?.length ?? 0);
  const safeStartIndex = Math.max(0, startIndex);
  const safeEndIndex = Math.min(Math.max(safeStartIndex, endIndex), Math.max(0, length - 1));
  const preferPost = hasPostSeries;
  const exceedanceNormalization = binMinutes > 0 ? binMinutes / 60 : 1;

  let total = 0;
  let absChange = 0;
  let relativeDelta = 0;
  let relativeBase = 0;
  let exceedance = 0;
  let totalExcessReduced = 0;
  let totalExcessInduced = 0;
  let netDelta = 0;

  if (length <= 0 || safeStartIndex > safeEndIndex) {
    return {
      total,
      absChange,
      relativeDelta,
      relativeBase,
      exceedance,
      totalExcessReduced,
      totalExcessInduced,
      netDelta,
      hasPreSeries,
      hasPostSeries,
    };
  }

  for (let index = safeStartIndex; index <= safeEndIndex; index += 1) {
    const preValue = toFiniteNumber(preSeries?.[index]);
    const postValue = toFiniteNumber(postSeries?.[index]);
    const displayValue = preferPost ? postValue : preValue;
    const rawCapacityValue = Number(capacitySeries?.[index] ?? NaN);
    const hasCapacityValue =
      hasCapacitySeries &&
      Number.isFinite(rawCapacityValue) &&
      rawCapacityValue >= 0 &&
      rawCapacityValue <= capacityHideThreshold;

    total += displayValue;

    if (hasPreSeries && hasPostSeries) {
      const rawDelta = postValue - preValue;
      const absDelta = Math.abs(rawDelta);
      absChange += absDelta;
      relativeDelta += absDelta;
      relativeBase += Math.abs(preValue);
      netDelta += rawDelta;

      if (hasCapacityValue) {
        if (rawDelta < 0 && preValue > rawCapacityValue) {
          totalExcessReduced += -rawDelta;
        }
        if (rawDelta > 0 && postValue > rawCapacityValue) {
          totalExcessInduced += rawDelta;
        }
      }
    }

    if (hasCapacityValue) {
      exceedance += Math.max(0, displayValue - rawCapacityValue) * exceedanceNormalization;
    }
  }

  return {
    total,
    absChange,
    relativeDelta,
    relativeBase,
    exceedance,
    totalExcessReduced,
    totalExcessInduced,
    netDelta,
    hasPreSeries,
    hasPostSeries,
  };
}

export function scoreOccupancyTvWindowStats(
  stats: OccupancyTvWindowStats | null | undefined,
  sortMode: OccupancyWindowSortMode,
): number {
  if (!stats) return 0;

  if (sortMode === "total") {
    return stats.total;
  }

  if (sortMode === "abs_change") {
    return stats.hasPreSeries && stats.hasPostSeries ? stats.absChange : 0;
  }

  if (sortMode === "relative_change") {
    if (!stats.hasPreSeries || !stats.hasPostSeries) {
      return 0;
    }
    if (stats.relativeBase > 0) {
      return stats.relativeDelta / stats.relativeBase;
    }
    return stats.relativeDelta > 0 ? Number.MAX_SAFE_INTEGER : 0;
  }

  if (sortMode === "exceedance") {
    return stats.exceedance;
  }

  if (sortMode === "total_excess_reduced") {
    return stats.totalExcessReduced;
  }

  return stats.totalExcessInduced;
}

export function computeOccupancyWindowStatsByTv(options: {
  postCounts: OccupancySeriesByTv;
  preCounts?: OccupancySeriesByTv;
  capacity?: OccupancySeriesByTv;
  tvIds: string[];
  windowRange: OccupancyWindowRange;
  binMinutes: number;
  capacityHideThreshold?: number;
}): Record<string, OccupancyTvWindowStats> {
  const {
    postCounts,
    preCounts,
    capacity,
    tvIds,
    windowRange,
    binMinutes,
    capacityHideThreshold,
  } = options;
  const statsByTv: Record<string, OccupancyTvWindowStats> = {};

  for (const tvId of tvIds) {
    statsByTv[tvId] = computeOccupancyTvWindowStats({
      preSeries: preCounts?.[tvId],
      postSeries: postCounts?.[tvId],
      capacitySeries: capacity?.[tvId],
      startIndex: windowRange.startIndex,
      endIndex: windowRange.endIndex,
      binMinutes,
      capacityHideThreshold,
    });
  }

  return statsByTv;
}
