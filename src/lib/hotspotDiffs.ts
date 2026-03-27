import {
  OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
  getOccupancyWindowRange,
} from "@/lib/occupancyWindowStats";
import { hhmmToMinutesSafe, minutesToHHMM } from "@/lib/time";
import type {
  HotspotChangeSummary,
  HotspotSegment,
  OccupancySeriesByTv,
  WithHotspotDiffs,
} from "@/lib/models";

const DEFAULT_WINDOW_MINUTES = 60;

export type HotspotDiffsData = {
  new_hotspots: HotspotSegment[];
  extinguished_hotspots: HotspotSegment[];
  hotspot_change_summary: HotspotChangeSummary[];
};

export type HotspotDiffCategoryKey = "new" | "extinguished" | "changed";

export type HotspotDiffCategoryEntry = HotspotChangeSummary & {
  sort_score: number;
  sort_index: number;
};

export type HotspotDiffCategorySet = {
  new: HotspotDiffCategoryEntry[];
  extinguished: HotspotDiffCategoryEntry[];
  changed: HotspotDiffCategoryEntry[];
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTrafficVolumeId(value: unknown): string {
  return String(value ?? "").trim();
}

function cloneHotspotSegment(segment: HotspotSegment | null | undefined): HotspotSegment | null {
  const trafficVolumeId = normalizeTrafficVolumeId(segment?.traffic_volume_id);
  if (!trafficVolumeId) return null;
  return {
    traffic_volume_id: trafficVolumeId,
    start_bin: Math.max(0, Math.trunc(toFiniteNumber(segment?.start_bin))),
    end_bin: Math.max(0, Math.trunc(toFiniteNumber(segment?.end_bin))),
    start_label: String(segment?.start_label ?? ""),
    end_label: String(segment?.end_label ?? ""),
    time_bin_minutes: Math.max(1, Math.trunc(toFiniteNumber(segment?.time_bin_minutes, 15))),
    window_minutes: Math.max(1, Math.trunc(toFiniteNumber(segment?.window_minutes, DEFAULT_WINDOW_MINUTES))),
    max_excess: toFiniteNumber(segment?.max_excess),
    sum_excess: toFiniteNumber(segment?.sum_excess),
    peak_rolling_count: toFiniteNumber(segment?.peak_rolling_count),
    capacity_stats: {
      min: toFiniteNumber(segment?.capacity_stats?.min),
      max: toFiniteNumber(segment?.capacity_stats?.max),
    },
  };
}

export function cloneHotspotSegments(
  segments: HotspotSegment[] | null | undefined,
): HotspotSegment[] {
  if (!Array.isArray(segments)) return [];
  const cloned: HotspotSegment[] = [];
  for (const segment of segments) {
    const next = cloneHotspotSegment(segment);
    if (next) cloned.push(next);
  }
  return cloned;
}

function cloneHotspotChangeSummaryEntry(
  entry: HotspotChangeSummary | null | undefined,
): HotspotChangeSummary | null {
  const trafficVolumeId = normalizeTrafficVolumeId(entry?.traffic_volume_id);
  if (!trafficVolumeId) return null;
  return {
    traffic_volume_id: trafficVolumeId,
    new_hotspot_bin_count: Math.max(0, Math.trunc(toFiniteNumber(entry?.new_hotspot_bin_count))),
    extinguished_hotspot_bin_count: Math.max(0, Math.trunc(toFiniteNumber(entry?.extinguished_hotspot_bin_count))),
    net_hotspot_bin_delta: Math.trunc(toFiniteNumber(entry?.net_hotspot_bin_delta)),
    new_hotspot_segment_count: Math.max(0, Math.trunc(toFiniteNumber(entry?.new_hotspot_segment_count))),
    extinguished_hotspot_segment_count: Math.max(0, Math.trunc(toFiniteNumber(entry?.extinguished_hotspot_segment_count))),
  };
}

export function cloneHotspotChangeSummary(
  entries: HotspotChangeSummary[] | null | undefined,
): HotspotChangeSummary[] {
  if (!Array.isArray(entries)) return [];
  const cloned: HotspotChangeSummary[] = [];
  for (const entry of entries) {
    const next = cloneHotspotChangeSummaryEntry(entry);
    if (next) cloned.push(next);
  }
  return cloned;
}

export function normalizeHotspotDiffs(
  value: Partial<WithHotspotDiffs> | null | undefined,
): HotspotDiffsData {
  return {
    new_hotspots: cloneHotspotSegments(value?.new_hotspots),
    extinguished_hotspots: cloneHotspotSegments(value?.extinguished_hotspots),
    hotspot_change_summary: cloneHotspotChangeSummary(value?.hotspot_change_summary),
  };
}

function buildTvOrderIndex(options: {
  tvOrder?: string[] | null;
  summary?: HotspotChangeSummary[] | null;
  newHotspots?: HotspotSegment[] | null;
  extinguishedHotspots?: HotspotSegment[] | null;
}): Map<string, number> {
  const { tvOrder, summary, newHotspots, extinguishedHotspots } = options;
  const index = new Map<string, number>();
  const register = (raw: unknown) => {
    const tvId = normalizeTrafficVolumeId(raw);
    if (!tvId || index.has(tvId)) return;
    index.set(tvId, index.size);
  };

  for (const tvId of tvOrder || []) register(tvId);
  for (const entry of summary || []) register(entry?.traffic_volume_id);
  for (const segment of newHotspots || []) register(segment?.traffic_volume_id);
  for (const segment of extinguishedHotspots || []) register(segment?.traffic_volume_id);
  return index;
}

function computeIntersectingBinCount(
  segment: HotspotSegment,
  windowStartIndex: number,
  windowEndIndex: number,
): number {
  const start = Math.max(windowStartIndex, Math.trunc(toFiniteNumber(segment.start_bin)));
  const end = Math.min(windowEndIndex, Math.trunc(toFiniteNumber(segment.end_bin)));
  if (end < start) return 0;
  return end - start + 1;
}

function accumulateSegmentWindowCounts(
  target: Map<string, HotspotChangeSummary>,
  segments: HotspotSegment[],
  kind: "new" | "extinguished",
  windowStartIndex: number,
  windowEndIndex: number,
): void {
  for (const segment of segments) {
    const tvId = normalizeTrafficVolumeId(segment.traffic_volume_id);
    if (!tvId) continue;
    const binCount = computeIntersectingBinCount(segment, windowStartIndex, windowEndIndex);
    if (binCount <= 0) continue;

    const existing = target.get(tvId) || {
      traffic_volume_id: tvId,
      new_hotspot_bin_count: 0,
      extinguished_hotspot_bin_count: 0,
      net_hotspot_bin_delta: 0,
      new_hotspot_segment_count: 0,
      extinguished_hotspot_segment_count: 0,
    };

    if (kind === "new") {
      existing.new_hotspot_bin_count += binCount;
      existing.new_hotspot_segment_count += 1;
    } else {
      existing.extinguished_hotspot_bin_count += binCount;
      existing.extinguished_hotspot_segment_count += 1;
    }
    existing.net_hotspot_bin_delta =
      existing.new_hotspot_bin_count - existing.extinguished_hotspot_bin_count;
    target.set(tvId, existing);
  }
}

export function computeHotspotChangeSummaryForWindow(options: {
  hotspotDiffs?: Partial<WithHotspotDiffs> | null;
  tvOrder?: string[] | null;
  binMinutes: number;
  viewFrom: string;
  viewTo: string;
}): HotspotChangeSummary[] {
  const { hotspotDiffs, tvOrder, binMinutes, viewFrom, viewTo } = options;
  const normalized = normalizeHotspotDiffs(hotspotDiffs);
  const safeBinMinutes = Math.max(1, Math.trunc(toFiniteNumber(binMinutes, 15)));

  if (
    normalized.new_hotspots.length === 0 &&
    normalized.extinguished_hotspots.length === 0
  ) {
    const fullWindow =
      hhmmToMinutesSafe(viewFrom || "00:00") <= 0 &&
      hhmmToMinutesSafe(viewTo || "23:59") >= 24 * 60 - 1;
    if (!fullWindow) return [];
    const fallbackIndex = buildTvOrderIndex({
      tvOrder,
      summary: normalized.hotspot_change_summary,
    });
    return normalized.hotspot_change_summary
      .filter(
        (entry) =>
          entry.new_hotspot_bin_count > 0 ||
          entry.extinguished_hotspot_bin_count > 0,
      )
      .slice()
      .sort((a, b) => {
        const ai = fallbackIndex.get(a.traffic_volume_id) ?? Number.MAX_SAFE_INTEGER;
        const bi = fallbackIndex.get(b.traffic_volume_id) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.traffic_volume_id.localeCompare(b.traffic_volume_id);
      });
  }

  const windowRange = getOccupancyWindowRange(
    hhmmToMinutesSafe(viewFrom),
    hhmmToMinutesSafe(viewTo),
    safeBinMinutes,
  );
  const byTv = new Map<string, HotspotChangeSummary>();
  accumulateSegmentWindowCounts(
    byTv,
    normalized.new_hotspots,
    "new",
    windowRange.startIndex,
    windowRange.endIndex,
  );
  accumulateSegmentWindowCounts(
    byTv,
    normalized.extinguished_hotspots,
    "extinguished",
    windowRange.startIndex,
    windowRange.endIndex,
  );

  const orderIndex = buildTvOrderIndex({
    tvOrder,
    summary: normalized.hotspot_change_summary,
    newHotspots: normalized.new_hotspots,
    extinguishedHotspots: normalized.extinguished_hotspots,
  });

  return Array.from(byTv.values()).sort((a, b) => {
    const ai = orderIndex.get(a.traffic_volume_id) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(b.traffic_volume_id) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.traffic_volume_id.localeCompare(b.traffic_volume_id);
  });
}

export function buildHotspotDiffCategories(options: {
  hotspotDiffs?: Partial<WithHotspotDiffs> | null;
  tvOrder?: string[] | null;
  binMinutes: number;
  viewFrom: string;
  viewTo: string;
}): HotspotDiffCategorySet {
  const { hotspotDiffs, tvOrder, binMinutes, viewFrom, viewTo } = options;
  const normalized = normalizeHotspotDiffs(hotspotDiffs);
  const summary = computeHotspotChangeSummaryForWindow({
    hotspotDiffs: normalized,
    tvOrder,
    binMinutes,
    viewFrom,
    viewTo,
  });
  const orderIndex = buildTvOrderIndex({
    tvOrder,
    summary,
    newHotspots: normalized.new_hotspots,
    extinguishedHotspots: normalized.extinguished_hotspots,
  });
  const toEntry = (entry: HotspotChangeSummary): HotspotDiffCategoryEntry => ({
    ...entry,
    sort_score: 0,
    sort_index: orderIndex.get(entry.traffic_volume_id) ?? Number.MAX_SAFE_INTEGER,
  });

  const stableSort = (
    entries: HotspotDiffCategoryEntry[],
    scoreFor: (entry: HotspotDiffCategoryEntry) => number,
    tieBreaker?: (a: HotspotDiffCategoryEntry, b: HotspotDiffCategoryEntry) => number,
  ) =>
    entries
      .map((entry) => ({ ...entry, sort_score: scoreFor(entry) }))
      .sort((a, b) => {
        if (a.sort_score !== b.sort_score) return b.sort_score - a.sort_score;
        if (tieBreaker) {
          const tie = tieBreaker(a, b);
          if (tie !== 0) return tie;
        }
        if (a.sort_index !== b.sort_index) return a.sort_index - b.sort_index;
        return a.traffic_volume_id.localeCompare(b.traffic_volume_id);
      });

  const newEntries = stableSort(
    summary
      .filter((entry) => entry.new_hotspot_bin_count > 0)
      .map(toEntry),
    (entry) => entry.new_hotspot_bin_count,
    (a, b) => b.new_hotspot_segment_count - a.new_hotspot_segment_count,
  );

  const extinguishEntries = stableSort(
    summary
      .filter((entry) => entry.extinguished_hotspot_bin_count > 0)
      .map(toEntry),
    (entry) => entry.extinguished_hotspot_bin_count,
    (a, b) =>
      b.extinguished_hotspot_segment_count - a.extinguished_hotspot_segment_count,
  );

  const changedEntries = stableSort(
    summary
      .filter(
        (entry) =>
          entry.new_hotspot_bin_count > 0 &&
          entry.extinguished_hotspot_bin_count > 0,
      )
      .map(toEntry),
    (entry) =>
      Math.min(
        entry.new_hotspot_bin_count,
        entry.extinguished_hotspot_bin_count,
      ),
    (a, b) => {
      const totalA =
        a.new_hotspot_bin_count + a.extinguished_hotspot_bin_count;
      const totalB =
        b.new_hotspot_bin_count + b.extinguished_hotspot_bin_count;
      if (totalA !== totalB) return totalB - totalA;
      return 0;
    },
  );

  return {
    new: newEntries,
    extinguished: extinguishEntries,
    changed: changedEntries,
  };
}

function readCapacityValue(
  capacitySeries: number[] | undefined,
  index: number,
): number | null {
  const raw = Number(capacitySeries?.[index] ?? Number.NaN);
  if (!Number.isFinite(raw)) return null;
  if (raw < 0 || raw > OCCUPANCY_CAPACITY_HIDE_THRESHOLD) return null;
  return raw;
}

function isOverloaded(value: number, capacity: number | null): boolean {
  return capacity !== null && Number.isFinite(value) && value > capacity;
}

function collectTvIds(options: {
  tvOrder?: string[] | null;
  preCounts?: OccupancySeriesByTv | null;
  postCounts?: OccupancySeriesByTv | null;
  capacity?: OccupancySeriesByTv | null;
}): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const register = (raw: unknown) => {
    const tvId = normalizeTrafficVolumeId(raw);
    if (!tvId || seen.has(tvId)) return;
    seen.add(tvId);
    result.push(tvId);
  };

  for (const tvId of options.tvOrder || []) register(tvId);
  for (const tvId of Object.keys(options.preCounts || {})) register(tvId);
  for (const tvId of Object.keys(options.postCounts || {})) register(tvId);
  for (const tvId of Object.keys(options.capacity || {})) register(tvId);
  return result;
}

function buildHotspotSegment(options: {
  trafficVolumeId: string;
  startBin: number;
  endBin: number;
  counts: number[];
  capacity: number[];
  binMinutes: number;
  windowMinutes: number;
}): HotspotSegment {
  const { trafficVolumeId, startBin, endBin, counts, capacity, binMinutes, windowMinutes } = options;
  let maxExcess = 0;
  let sumExcess = 0;
  let peakRollingCount = 0;
  let minCapacity = Number.POSITIVE_INFINITY;
  let maxCapacity = Number.NEGATIVE_INFINITY;

  for (let index = startBin; index <= endBin; index += 1) {
    const countValue = toFiniteNumber(counts[index]);
    const capacityValue = toFiniteNumber(capacity[index]);
    const excess = Math.max(0, countValue - capacityValue);
    maxExcess = Math.max(maxExcess, excess);
    sumExcess += excess;
    peakRollingCount = Math.max(peakRollingCount, countValue);
    minCapacity = Math.min(minCapacity, capacityValue);
    maxCapacity = Math.max(maxCapacity, capacityValue);
  }

  return {
    traffic_volume_id: trafficVolumeId,
    start_bin: startBin,
    end_bin: endBin,
    start_label: minutesToHHMM(startBin * binMinutes),
    end_label: minutesToHHMM(endBin * binMinutes),
    time_bin_minutes: binMinutes,
    window_minutes: windowMinutes,
    max_excess: maxExcess,
    sum_excess: sumExcess,
    peak_rolling_count: peakRollingCount,
    capacity_stats: {
      min: Number.isFinite(minCapacity) ? minCapacity : 0,
      max: Number.isFinite(maxCapacity) ? maxCapacity : 0,
    },
  };
}

function collectSegmentsForMask(options: {
  trafficVolumeId: string;
  mask: boolean[];
  counts: number[];
  capacity: number[];
  binMinutes: number;
  windowMinutes: number;
}): HotspotSegment[] {
  const { trafficVolumeId, mask, counts, capacity, binMinutes, windowMinutes } = options;
  const segments: HotspotSegment[] = [];
  let activeStart: number | null = null;

  for (let index = 0; index <= mask.length; index += 1) {
    const isActive = index < mask.length ? Boolean(mask[index]) : false;
    if (isActive) {
      if (activeStart === null) activeStart = index;
      continue;
    }
    if (activeStart === null) continue;
    segments.push(
      buildHotspotSegment({
        trafficVolumeId,
        startBin: activeStart,
        endBin: index - 1,
        counts,
        capacity,
        binMinutes,
        windowMinutes,
      }),
    );
    activeStart = null;
  }

  return segments;
}

export function computeHotspotDiffsFromRollingCounts(options: {
  preCounts?: OccupancySeriesByTv | null;
  postCounts?: OccupancySeriesByTv | null;
  capacity?: OccupancySeriesByTv | null;
  tvOrder?: string[] | null;
  binMinutes: number;
  windowMinutes?: number;
}): HotspotDiffsData {
  const {
    preCounts,
    postCounts,
    capacity,
    tvOrder,
    binMinutes,
    windowMinutes = DEFAULT_WINDOW_MINUTES,
  } = options;
  const safeBinMinutes = Math.max(1, Math.trunc(toFiniteNumber(binMinutes, 15)));
  const safeWindowMinutes = Math.max(1, Math.trunc(toFiniteNumber(windowMinutes, DEFAULT_WINDOW_MINUTES)));
  const tvIds = collectTvIds({ tvOrder, preCounts, postCounts, capacity });

  const newHotspots: HotspotSegment[] = [];
  const extinguishHotspots: HotspotSegment[] = [];
  const summary: HotspotChangeSummary[] = [];

  for (const tvId of tvIds) {
    const preSeries = Array.isArray(preCounts?.[tvId]) ? preCounts?.[tvId] || [] : [];
    const postSeries = Array.isArray(postCounts?.[tvId]) ? postCounts?.[tvId] || [] : [];
    const capSeries = Array.isArray(capacity?.[tvId]) ? capacity?.[tvId] || [] : [];
    const length = Math.max(preSeries.length, postSeries.length, capSeries.length);
    if (length <= 0) continue;

    const newMask = new Array<boolean>(length).fill(false);
    const extinguishMask = new Array<boolean>(length).fill(false);
    const metricCapacity = new Array<number>(length).fill(0);
    const preMetricCounts = new Array<number>(length).fill(0);
    const postMetricCounts = new Array<number>(length).fill(0);

    let newBinCount = 0;
    let extinguishedBinCount = 0;

    for (let index = 0; index < length; index += 1) {
      const capacityValue = readCapacityValue(capSeries, index);
      if (capacityValue === null) continue;

      const preValue = toFiniteNumber(preSeries[index]);
      const postValue = toFiniteNumber(postSeries[index]);
      const preOverloaded = isOverloaded(preValue, capacityValue);
      const postOverloaded = isOverloaded(postValue, capacityValue);

      metricCapacity[index] = capacityValue;
      preMetricCounts[index] = preValue;
      postMetricCounts[index] = postValue;

      if (postOverloaded && !preOverloaded) {
        newMask[index] = true;
        newBinCount += 1;
      }
      if (preOverloaded && !postOverloaded) {
        extinguishMask[index] = true;
        extinguishedBinCount += 1;
      }
    }

    const nextNewHotspots = collectSegmentsForMask({
      trafficVolumeId: tvId,
      mask: newMask,
      counts: postMetricCounts,
      capacity: metricCapacity,
      binMinutes: safeBinMinutes,
      windowMinutes: safeWindowMinutes,
    });
    const nextExtinguishHotspots = collectSegmentsForMask({
      trafficVolumeId: tvId,
      mask: extinguishMask,
      counts: preMetricCounts,
      capacity: metricCapacity,
      binMinutes: safeBinMinutes,
      windowMinutes: safeWindowMinutes,
    });

    newHotspots.push(...nextNewHotspots);
    extinguishHotspots.push(...nextExtinguishHotspots);

    if (newBinCount > 0 || extinguishedBinCount > 0) {
      summary.push({
        traffic_volume_id: tvId,
        new_hotspot_bin_count: newBinCount,
        extinguished_hotspot_bin_count: extinguishedBinCount,
        net_hotspot_bin_delta: newBinCount - extinguishedBinCount,
        new_hotspot_segment_count: nextNewHotspots.length,
        extinguished_hotspot_segment_count: nextExtinguishHotspots.length,
      });
    }
  }

  return {
    new_hotspots: newHotspots,
    extinguished_hotspots: extinguishHotspots,
    hotspot_change_summary: summary,
  };
}
