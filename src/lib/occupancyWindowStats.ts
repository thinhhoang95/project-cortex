import type { OccupancySeriesByTv } from "@/lib/models";

export interface OccupancyWindowRange {
  startIndex: number;
  endIndex: number;
}

export interface OccupancyTvWindowStats {
  total: number;
  absChange: number;
  relativeDelta: number;
  relativeBase: number;
  exceedance: number;
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
  let netDelta = 0;

  if (length <= 0 || safeStartIndex > safeEndIndex) {
    return {
      total,
      absChange,
      relativeDelta,
      relativeBase,
      exceedance,
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
      const delta = Math.abs(postValue - preValue);
      absChange += delta;
      relativeDelta += delta;
      relativeBase += Math.abs(preValue);
      netDelta += postValue - preValue;
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
    netDelta,
    hasPreSeries,
    hasPostSeries,
  };
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
