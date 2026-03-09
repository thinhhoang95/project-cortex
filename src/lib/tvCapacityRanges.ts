import { fetchCached } from "./cache";
import { getTvCapacityRangesPath, listLocalResourceDates } from "./dataPaths";
import { useSimStore } from "@/components/useSimStore";

export type TvCapacityRangeEntry = {
  constituent_es?: string[];
  related_tvs?: string[];
  min_capacity?: number | null;
  max_capacity?: number | null;
  [key: string]: unknown;
};

export type TvCapacityRangeMap = Record<string, TvCapacityRangeEntry>;

const tvCapacityRangesCacheByDate = new Map<string, TvCapacityRangeMap>();
const tvCapacityRangesLoadPromiseByDate = new Map<string, Promise<TvCapacityRangeMap>>();

export function clearTvCapacityRangesCache(): void {
  tvCapacityRangesCacheByDate.clear();
  tvCapacityRangesLoadPromiseByDate.clear();
}

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

function getCurrentResourceDate(): string {
  return useSimStore.getState().resourceDate ?? listLocalResourceDates()[0] ?? "";
}

export async function loadTvCapacityRanges(): Promise<TvCapacityRangeMap> {
  const resourceDate = getCurrentResourceDate();
  const cached = tvCapacityRangesCacheByDate.get(resourceDate);
  if (cached) return cached;

  if (!tvCapacityRangesLoadPromiseByDate.has(resourceDate)) {
    tvCapacityRangesLoadPromiseByDate.set(resourceDate, (async () => {
      const response = await fetchCached(getTvCapacityRangesPath(resourceDate));
      if (!response.ok) {
        throw new Error(`Failed to load TV capacity ranges: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json();
      const normalized = normalizeRangeMap(payload);
      tvCapacityRangesCacheByDate.set(resourceDate, normalized);
      return normalized;
    })().catch((error) => {
      tvCapacityRangesLoadPromiseByDate.delete(resourceDate);
      tvCapacityRangesCacheByDate.delete(resourceDate);
      throw error;
    }));
  }
  return tvCapacityRangesLoadPromiseByDate.get(resourceDate)!;
}

export function getCachedTvCapacityRanges(): TvCapacityRangeMap | null {
  const resourceDate = getCurrentResourceDate();
  if (!resourceDate) return null;
  return tvCapacityRangesCacheByDate.get(resourceDate) ?? null;
}

export function getDerivedCapacityRangeForTv(tvId: string | null | undefined): string | null {
  const normalizedTvId = normalizeTvId(tvId);
  const ranges = getCachedTvCapacityRanges();
  if (!normalizedTvId || !ranges) return null;
  return formatDerivedCapacityRange(ranges[normalizedTvId]);
}

export async function getDerivedCapacityRangeForTvAsync(tvId: string | null | undefined): Promise<string | null> {
  const normalizedTvId = normalizeTvId(tvId);
  if (!normalizedTvId) return null;
  const ranges = await loadTvCapacityRanges();
  return formatDerivedCapacityRange(ranges[normalizedTvId]);
}
