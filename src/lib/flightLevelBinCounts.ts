export interface FlightLevelCountBin {
  label?: string;
  start_fl: number;
  end_fl: number;
  count: number;
  segments?: FlightLevelCountSegment[];
}

export interface FlightLevelCountSegment {
  start_time_str: string;
  end_time_str: string;
  count: number;
}

export interface FlightLevelCountsMetadata {
  unit?: string;
  max_fl?: number;
  num_input_flights?: number;
  num_counted_flights?: number;
  num_intervals_considered?: number;
  time_scope?: {
    from_time_str: string | null;
    to_time_str: string | null;
  };
}

export interface FlightLevelCountsPayload {
  bins: FlightLevelCountBin[];
  metadata?: FlightLevelCountsMetadata;
}

export type FlightLevelBinSizeFeet = 1000 | 2000 | 3000 | 5000;

export interface AggregatedFlightLevelBin {
  key: string;
  startFl: number;
  endFl: number;
  count: number;
  label: string;
}

const FEET_PER_FL = 100;

function toFlStep(binSizeFeet: FlightLevelBinSizeFeet) {
  return Math.max(1, Math.round(binSizeFeet / FEET_PER_FL));
}

function clampToStep(value: number, step: number, mode: "floor" | "ceil") {
  const normalized = Number.isFinite(value) ? value : 0;
  if (mode === "ceil") {
    return Math.ceil(normalized / step) * step;
  }
  return Math.floor(normalized / step) * step;
}

function formatFlightLevelLabel(value: number) {
  return `FL${Math.round(value).toString().padStart(3, "0")}`;
}

export function buildFlightLevelBinLabel(startFl: number, endFl: number) {
  return `${formatFlightLevelLabel(startFl)}-${Math.round(endFl).toString().padStart(3, "0")}`;
}

function parseClockTimeToSeconds(value: string): number | null {
  const parts = String(value).split(":").map(Number);
  const [hours = Number.NaN, minutes = Number.NaN, seconds = 0] = parts;
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function expandDailyInterval(startSeconds: number, endSeconds: number): Array<[number, number]> {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return [];
  const base =
    endSeconds >= startSeconds
      ? ([startSeconds, endSeconds] as [number, number])
      : ([startSeconds, endSeconds + 24 * 3600] as [number, number]);
  return [base, [base[0] + 24 * 3600, base[1] + 24 * 3600]];
}

function overlapsWindow(
  startSeconds: number,
  endSeconds: number,
  windowStartSeconds: number,
  windowSeconds: number,
) {
  const expandedSegments = expandDailyInterval(startSeconds, endSeconds);
  const windowEndSeconds = windowStartSeconds + windowSeconds;
  const windows: Array<[number, number]> =
    windowEndSeconds <= 24 * 3600
      ? [
          [windowStartSeconds, windowEndSeconds],
          [windowStartSeconds + 24 * 3600, windowEndSeconds + 24 * 3600],
        ]
      : [[windowStartSeconds, windowEndSeconds]];

  return expandedSegments.some(([segmentStart, segmentEnd]) =>
    windows.some(
      ([focusStart, focusEnd]) =>
        segmentStart < focusEnd && segmentEnd > focusStart,
    ),
  );
}

export function filterFlightLevelBinsToWindow({
  bins,
  windowStartSeconds,
  windowSeconds,
}: {
  bins: FlightLevelCountBin[];
  windowStartSeconds: number;
  windowSeconds: number;
}): FlightLevelCountBin[] {
  if (!Array.isArray(bins) || bins.length === 0) return [];
  if (!Number.isFinite(windowStartSeconds) || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return bins;
  }

  return bins.map((bin) => {
    if (!Array.isArray(bin.segments)) {
      return { ...bin };
    }

    const visibleSegments = bin.segments.filter((segment) => {
      const startSeconds = parseClockTimeToSeconds(segment.start_time_str);
      const endSeconds = parseClockTimeToSeconds(segment.end_time_str);
      if (startSeconds === null || endSeconds === null) return false;
      return overlapsWindow(startSeconds, endSeconds, windowStartSeconds, windowSeconds);
    });

    return {
      ...bin,
      count: visibleSegments.reduce((sum, segment) => sum + Number(segment.count ?? 0), 0),
      segments: visibleSegments,
    };
  });
}

export function aggregateFlightLevelBins({
  bins,
  binSizeFeet,
  rangeStartFl,
  rangeEndFl,
  includeEmpty = true,
}: {
  bins: FlightLevelCountBin[];
  binSizeFeet: FlightLevelBinSizeFeet;
  rangeStartFl?: number;
  rangeEndFl?: number;
  includeEmpty?: boolean;
}): AggregatedFlightLevelBin[] {
  if (!Array.isArray(bins) || bins.length === 0) return [];

  const normalizedBins = bins
    .filter(
      (bin) =>
        Number.isFinite(bin.start_fl) &&
        Number.isFinite(bin.end_fl) &&
        Number.isFinite(bin.count) &&
        bin.end_fl > bin.start_fl,
    )
    .sort((a, b) => a.start_fl - b.start_fl);

  if (normalizedBins.length === 0) return [];

  const stepFl = toFlStep(binSizeFeet);
  const derivedMinStart = normalizedBins[0]?.start_fl ?? 0;
  const derivedMaxEnd = normalizedBins[normalizedBins.length - 1]?.end_fl ?? stepFl;
  const minStart = clampToStep(rangeStartFl ?? derivedMinStart, stepFl, "floor");
  const maxEndRaw = rangeEndFl ?? derivedMaxEnd;
  const maxEnd = Number.isFinite(maxEndRaw) ? Math.max(maxEndRaw, minStart + stepFl) : derivedMaxEnd;
  const countByStart = new Map<number, number>();

  for (const bin of normalizedBins) {
    const bucketStart = clampToStep(bin.start_fl, stepFl, "floor");
    countByStart.set(bucketStart, (countByStart.get(bucketStart) ?? 0) + bin.count);
  }

  const rows: AggregatedFlightLevelBin[] = [];
  for (let startFl = minStart; startFl < maxEnd; startFl += stepFl) {
    const endFl = Math.min(startFl + stepFl, maxEnd);
    const row = {
      key: `${startFl}-${endFl}`,
      startFl,
      endFl,
      count: countByStart.get(startFl) ?? 0,
      label: buildFlightLevelBinLabel(startFl, endFl),
    };
    if (includeEmpty || row.count > 0) {
      rows.push(row);
    }
  }

  return rows;
}
