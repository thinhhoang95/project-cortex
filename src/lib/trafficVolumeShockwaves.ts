import { hhmmToMinutesSafe } from "./time";

type SeriesByTv = Record<string, number[] | undefined>;

export interface ComputeShockwaveDeltaByTvOptions {
  counts?: SeriesByTv | null;
  binMinutes: number;
  selectedTime?: string;
  offsetMinutes?: number;
  labels?: string[];
  startBin?: number;
  tvIds?: string[];
}

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeBinMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Number(value);
}

function normalizeOffsetMinutes(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function normalizeLabelStartMinutes(label?: string): number | null {
  const raw = String(label ?? "").trim();
  if (!raw) return null;
  const startLabel = raw.includes("-") ? raw.slice(0, raw.indexOf("-")).trim() : raw;
  if (!/^\d{1,2}:\d{2}$/.test(startLabel)) return null;
  return hhmmToMinutesSafe(startLabel);
}

function collectTvIds(counts?: SeriesByTv | null, tvIds?: string[]): string[] {
  if (Array.isArray(tvIds) && tvIds.length > 0) {
    return Array.from(
      new Set(
        tvIds
          .map((id) => String(id ?? "").trim())
          .filter((id) => id.length > 0),
      ),
    );
  }

  return Object.keys(counts || {});
}

function buildStartMinutes(
  count: number,
  binMinutes: number,
  startBin?: number,
  labels?: string[],
): number[] {
  const safeCount = Math.max(0, Math.floor(count));
  const safeStartBin =
    Number.isFinite(startBin) && Number(startBin) >= 0 ? Math.floor(Number(startBin)) : 0;

  return new Array(safeCount).fill(0).map((_, idx) => {
    const labelMinutes = normalizeLabelStartMinutes(labels?.[idx]);
    if (labelMinutes != null) return labelMinutes;
    return (safeStartBin + idx) * binMinutes;
  });
}

function resolveNearestIndex(startMinutes: number[], targetMinutes: number, tolerance: number): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let idx = 0; idx < startMinutes.length; idx++) {
    const candidate = Number(startMinutes[idx]);
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - targetMinutes);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = idx;
    }
  }

  if (bestIndex < 0) return -1;
  return bestDistance <= tolerance ? bestIndex : -1;
}

export function computeShockwaveDeltaByTv(
  options: ComputeShockwaveDeltaByTvOptions,
): Record<string, number> {
  const counts = options.counts || {};
  const ids = collectTvIds(counts, options.tvIds);
  const binMinutes = normalizeBinMinutes(options.binMinutes);
  const offsetMinutes = normalizeOffsetMinutes(options.offsetMinutes);
  const selectedMinutes = hhmmToMinutesSafe(options.selectedTime || "00:00");
  const maxSeriesLength = ids.reduce((max, tvId) => {
    const series = counts?.[tvId];
    return Math.max(max, Array.isArray(series) ? series.length : 0);
  }, Array.isArray(options.labels) ? options.labels.length : 0);

  if (maxSeriesLength <= 0) return {};

  const startMinutes = buildStartMinutes(
    maxSeriesLength,
    binMinutes,
    options.startBin,
    options.labels,
  );
  const tolerance = Math.max(1, binMinutes * 0.51);
  const referenceIndex = resolveNearestIndex(startMinutes, selectedMinutes, tolerance);
  if (referenceIndex < 0) return {};

  const referenceMinutes = startMinutes[referenceIndex] ?? selectedMinutes;
  const targetIndex = resolveNearestIndex(
    startMinutes,
    referenceMinutes + offsetMinutes,
    tolerance,
  );
  if (targetIndex < 0) return {};

  const result: Record<string, number> = {};
  for (const tvId of ids) {
    const series = counts?.[tvId];
    if (!Array.isArray(series) || series.length === 0) continue;
    if (referenceIndex >= series.length || targetIndex >= series.length) continue;
    result[tvId] =
      toFiniteNumber(series[targetIndex]) - toFiniteNumber(series[referenceIndex]);
  }

  return result;
}

export function formatShockwaveHorizonLabel(offsetMinutes?: number): string {
  const safeOffset = normalizeOffsetMinutes(offsetMinutes);
  if (safeOffset <= 0) return "T";
  return `T+${Math.round(safeOffset)}`;
}
