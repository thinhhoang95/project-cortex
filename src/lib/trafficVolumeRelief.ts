import { hhmmToMinutesSafe } from "./time";

type SeriesByTv = Record<string, number[] | undefined>;

export interface ComputeNetDeltaByTvOptions {
  preCounts?: SeriesByTv | null;
  postCounts?: SeriesByTv | null;
  binMinutes: number;
  viewFrom?: string;
  viewTo?: string;
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

function normalizeWindow(viewFrom?: string, viewTo?: string): { from: number; to: number } {
  const start = hhmmToMinutesSafe(viewFrom || "00:00");
  const end = hhmmToMinutesSafe(viewTo || "23:59");
  return {
    from: Math.min(start, end),
    to: Math.max(start, end),
  };
}

function collectTvIds(preCounts?: SeriesByTv | null, postCounts?: SeriesByTv | null, tvIds?: string[]): string[] {
  if (Array.isArray(tvIds) && tvIds.length > 0) {
    return Array.from(
      new Set(
        tvIds
          .map((id) => String(id ?? "").trim())
          .filter((id) => id.length > 0),
      ),
    );
  }

  const idSet = new Set<string>();
  Object.keys(preCounts || {}).forEach((id) => idSet.add(String(id)));
  Object.keys(postCounts || {}).forEach((id) => idSet.add(String(id)));
  return Array.from(idSet);
}

export function computeNetDeltaByTv(options: ComputeNetDeltaByTvOptions): Record<string, number> {
  const preCounts = options.preCounts || {};
  const postCounts = options.postCounts || {};
  const ids = collectTvIds(preCounts, postCounts, options.tvIds);
  const binMinutes = normalizeBinMinutes(options.binMinutes);
  const { from, to } = normalizeWindow(options.viewFrom, options.viewTo);
  const result: Record<string, number> = {};

  for (const tvId of ids) {
    const preSeries = preCounts?.[tvId];
    const postSeries = postCounts?.[tvId];
    if (!Array.isArray(preSeries) || !Array.isArray(postSeries)) continue;
    if (preSeries.length === 0 || postSeries.length === 0) continue;

    const n = Math.min(preSeries.length, postSeries.length);
    if (n <= 0) continue;

    let delta = 0;
    let hasWindowBin = false;
    for (let i = 0; i < n; i++) {
      const startMin = i * binMinutes;
      if (startMin < from || startMin > to) continue;
      hasWindowBin = true;
      delta += toFiniteNumber(postSeries[i]) - toFiniteNumber(preSeries[i]);
    }
    if (!hasWindowBin) continue;
    result[tvId] = delta;
  }

  return result;
}

export function computeRobustSymmetricDomain(
  values: number[],
  percentile = 0.95,
  fallback = 1,
): number {
  const safeFallback = Number.isFinite(fallback) && fallback > 0 ? Number(fallback) : 1;
  const p = Number.isFinite(percentile) ? Math.min(1, Math.max(0, Number(percentile))) : 0.95;
  const magnitudes = (values || [])
    .map((value) => Math.abs(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (magnitudes.length === 0) return safeFallback;

  const idx = p * (magnitudes.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loValue = magnitudes[lo] ?? magnitudes[magnitudes.length - 1];
  const hiValue = magnitudes[hi] ?? loValue;
  const quantile = lo === hi ? loValue : loValue + (hiValue - loValue) * (idx - lo);

  if (!Number.isFinite(quantile) || quantile <= 0) {
    const maxValue = magnitudes[magnitudes.length - 1];
    return Number.isFinite(maxValue) && maxValue > 0 ? maxValue : safeFallback;
  }
  return quantile;
}

export function clipToDomain(value: number, domain: number): number {
  const safeDomain = Number.isFinite(domain) && domain > 0 ? Number(domain) : 1;
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  if (safeValue > safeDomain) return safeDomain;
  if (safeValue < -safeDomain) return -safeDomain;
  return safeValue;
}
