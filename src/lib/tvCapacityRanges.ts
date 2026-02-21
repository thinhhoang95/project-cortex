import { fetchCached } from "./cache";
import { TV_CAPACITY_RANGES_BY_ES_PATH } from "./dataPaths";

export type TvCapacityRangeEntry = {
  constituent_es?: string[];
  related_tvs?: string[];
  min_capacity?: number | null;
  max_capacity?: number | null;
  [key: string]: unknown;
};

export type TvCapacityRangeMap = Record<string, TvCapacityRangeEntry>;

let tvCapacityRangesCache: TvCapacityRangeMap | null = null;
let tvCapacityRangesLoadPromise: Promise<TvCapacityRangeMap> | null = null;

function normalizeTvId(tvId: string | null | undefined): string {
  if (!tvId) return "";
  return String(tvId).trim();
}

function normalizeRangeMap(input: unknown): TvCapacityRangeMap {
  if (!input || typeof input !== "object") return {};
  const result: TvCapacityRangeMap = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeTvId(rawKey);
    if (!normalizedKey || !rawValue || typeof rawValue !== "object") continue;
    result[normalizedKey] = rawValue as TvCapacityRangeEntry;
  }
  return result;
}

export function formatDerivedCapacityRange(entry: TvCapacityRangeEntry | null | undefined): string | null {
  if (!entry) return null;
  if (typeof entry.min_capacity !== "number" || typeof entry.max_capacity !== "number") return null;
  if (!Number.isFinite(entry.min_capacity) || !Number.isFinite(entry.max_capacity)) return null;
  const minValue = entry.min_capacity;
  const maxValue = entry.max_capacity;
  const lower = Math.round(Math.min(minValue, maxValue));
  const upper = Math.round(Math.max(minValue, maxValue));
  return `${lower} to ${upper}`;
}

export async function loadTvCapacityRanges(): Promise<TvCapacityRangeMap> {
  if (tvCapacityRangesCache) return tvCapacityRangesCache;
  if (!tvCapacityRangesLoadPromise) {
    tvCapacityRangesLoadPromise = (async () => {
      const response = await fetchCached(TV_CAPACITY_RANGES_BY_ES_PATH);
      if (!response.ok) {
        throw new Error(`Failed to load TV capacity ranges: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json();
      const normalized = normalizeRangeMap(payload);
      tvCapacityRangesCache = normalized;
      return normalized;
    })().catch((error) => {
      tvCapacityRangesLoadPromise = null;
      tvCapacityRangesCache = null;
      throw error;
    });
  }
  return tvCapacityRangesLoadPromise;
}

export function getCachedTvCapacityRanges(): TvCapacityRangeMap | null {
  return tvCapacityRangesCache;
}

export function getDerivedCapacityRangeForTv(tvId: string | null | undefined): string | null {
  const normalizedTvId = normalizeTvId(tvId);
  if (!normalizedTvId || !tvCapacityRangesCache) return null;
  return formatDerivedCapacityRange(tvCapacityRangesCache[normalizedTvId]);
}

export async function getDerivedCapacityRangeForTvAsync(tvId: string | null | undefined): Promise<string | null> {
  const normalizedTvId = normalizeTvId(tvId);
  if (!normalizedTvId) return null;
  const ranges = await loadTvCapacityRanges();
  return formatDerivedCapacityRange(ranges[normalizedTvId]);
}
