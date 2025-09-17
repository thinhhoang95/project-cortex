import { RegulationPlanSimulationResponse, RegulationPlanDelayStats } from "@/lib/models";

export const REG_SNAPSHOT_VERSION = 1;
export const REG_SNAPSHOT_STORAGE_KEY = "cortex.regulationSnapshots";
export const MAX_REG_SNAPSHOTS = 4;
export const REG_SNAPSHOT_SIZE_WARN_THRESHOLD = Math.floor(4.5 * 1024 * 1024);

export interface RegulationAggregatedRolling {
  time_bin_minutes: number;
  pre_counts?: Record<string, number[]>;
  post_counts: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  tv_ids_order?: string[];
  timeLabels?: string[];
}

export interface RegulationSnapshot {
  version: number;
  id: string;
  createdAt: string;
  description: string;
  sourceRoute: string;
  minutesPerBin: number;
  aggregatedRolling: RegulationAggregatedRolling;
  delayStats: RegulationPlanDelayStats;
  delaysMin?: Record<string, number> | null;
  metadata?: Record<string, any> | null;
  shareUrl?: string | null;
}

function cloneSeries(values?: number[] | null): number[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
}

export function generateRegSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `reg-snapshot-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function createRegulationSnapshot(params: {
  description: string;
  result: RegulationPlanSimulationResponse;
  sourceRoute?: string;
  id?: string;
  createdAt?: string;
  shareUrl?: string | null;
}): RegulationSnapshot {
  const { description, result, sourceRoute = "regulations", id = generateRegSnapshotId(), createdAt = new Date().toISOString(), shareUrl = null } = params;

  const rollingList = Array.isArray(result.rolling_changed_tvs) && result.rolling_changed_tvs.length > 0
    ? result.rolling_changed_tvs
    : Array.isArray(result.rolling_top_tvs)
      ? result.rolling_top_tvs
      : [];

  const minutesPerBin = Number(result.metadata?.time_bin_minutes ?? 15);
  const postCounts: Record<string, number[]> = {};
  const preCounts: Record<string, number[]> = {};
  const capacity: Record<string, number[]> = {};
  const tvOrder: string[] = [];

  rollingList.forEach((tv) => {
    if (!tv) return;
    const tvId = String(tv.traffic_volume_id ?? "");
    if (!tvId) return;
    if (!tvOrder.includes(tvId)) {
      tvOrder.push(tvId);
    }
    postCounts[tvId] = cloneSeries(tv.post_rolling_counts);
    const preSeries = cloneSeries(tv.pre_rolling_counts);
    if (preSeries.length > 0) {
      preCounts[tvId] = preSeries;
    }
    const capSeries = cloneSeries(tv.capacity_per_bin);
    if (capSeries.length > 0) {
      capacity[tvId] = capSeries;
    }
  });

  const aggregatedRolling: RegulationAggregatedRolling = {
    time_bin_minutes: minutesPerBin,
    post_counts: postCounts,
  };
  if (Object.keys(preCounts).length > 0) aggregatedRolling.pre_counts = preCounts;
  if (Object.keys(capacity).length > 0) aggregatedRolling.capacity = capacity;
  if (tvOrder.length > 0) aggregatedRolling.tv_ids_order = tvOrder;

  const delayStats: RegulationPlanDelayStats = {
    total_delay_seconds: Number(result.delay_stats?.total_delay_seconds ?? 0),
    mean_delay_seconds: Number(result.delay_stats?.mean_delay_seconds ?? 0),
    max_delay_seconds: Number(result.delay_stats?.max_delay_seconds ?? 0),
    min_delay_seconds: Number(result.delay_stats?.min_delay_seconds ?? 0),
    delayed_flights_count: Number(result.delay_stats?.delayed_flights_count ?? 0),
    num_flights: Number(result.delay_stats?.num_flights ?? 0),
  };

  const delaysMinEntries = Object.entries(result.delays_by_flight || {});
  const delaysMin: Record<string, number> = {};
  delaysMinEntries.forEach(([flightId, delayMinutes]) => {
    const minutes = Number(delayMinutes);
    if (!Number.isFinite(minutes)) return;
    delaysMin[String(flightId)] = minutes;
  });

  const snapshot: RegulationSnapshot = {
    version: REG_SNAPSHOT_VERSION,
    id,
    createdAt,
    description: description.trim() || "Untitled regulation plan",
    sourceRoute,
    minutesPerBin,
    aggregatedRolling,
    delayStats,
    delaysMin: Object.keys(delaysMin).length > 0 ? delaysMin : null,
    metadata: result.metadata ? { ...result.metadata } : null,
    shareUrl,
  };

  return snapshot;
}

function readRegSnapshotsFromStorage(): RegulationSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REG_SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const aggregated = (item as any).aggregatedRolling || {};
        const sanitizedAggregated: RegulationAggregatedRolling = {
          time_bin_minutes: Number(aggregated.time_bin_minutes ?? (item as any).minutesPerBin ?? 15),
          post_counts: aggregated.post_counts && typeof aggregated.post_counts === "object" ? { ...aggregated.post_counts } : {},
          pre_counts: aggregated.pre_counts && typeof aggregated.pre_counts === "object" ? { ...aggregated.pre_counts } : undefined,
          capacity: aggregated.capacity && typeof aggregated.capacity === "object" ? { ...aggregated.capacity } : undefined,
          tv_ids_order: Array.isArray(aggregated.tv_ids_order) ? [...aggregated.tv_ids_order] : undefined,
          timeLabels: Array.isArray(aggregated.timeLabels) ? [...aggregated.timeLabels] : undefined,
        };
        return {
          ...(item as any),
          version: typeof (item as any).version === "number" ? (item as any).version : REG_SNAPSHOT_VERSION,
          aggregatedRolling: sanitizedAggregated,
        } as RegulationSnapshot;
      })
      .filter((item): item is RegulationSnapshot => !!item && !!item.id);
  } catch (err) {
    console.warn("Failed to parse regulation snapshots from storage", err);
    return [];
  }
}

function writeRegSnapshotsToStorage(snapshots: RegulationSnapshot[]): void {
  if (typeof window === "undefined") return;
  const sanitized = snapshots.map((snap) => ({ ...snap, version: REG_SNAPSHOT_VERSION }));
  window.localStorage.setItem(REG_SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized));
}

export function loadRegSnapshots(): RegulationSnapshot[] {
  return readRegSnapshotsFromStorage();
}

export class RegSnapshotLimitError extends Error {
  limit: number;
  constructor(limit: number) {
    super(`Only ${limit} regulation snapshots can be stored for comparison.`);
    this.name = "RegSnapshotLimitError";
    this.limit = limit;
  }
}

export function addRegSnapshot(
  snapshot: RegulationSnapshot,
  opts: { replaceId?: string } = {},
): RegulationSnapshot[] {
  const existing = readRegSnapshotsFromStorage();
  let next: RegulationSnapshot[];
  if (opts.replaceId) {
    next = existing.map((s) => (s.id === opts.replaceId ? snapshot : s));
    if (!existing.some((s) => s.id === opts.replaceId)) {
      next = [...existing, snapshot];
    }
  } else {
    if (existing.length >= MAX_REG_SNAPSHOTS) {
      throw new RegSnapshotLimitError(MAX_REG_SNAPSHOTS);
    }
    next = [...existing, snapshot];
  }
  writeRegSnapshotsToStorage(next);
  return next;
}

export function updateRegSnapshotDescription(id: string, description: string): RegulationSnapshot[] {
  const existing = readRegSnapshotsFromStorage();
  const next = existing.map((snap) => (snap.id === id ? { ...snap, description } : snap));
  writeRegSnapshotsToStorage(next);
  return next;
}

export function deleteRegSnapshot(id: string): RegulationSnapshot[] {
  const existing = readRegSnapshotsFromStorage();
  const next = existing.filter((snap) => snap.id !== id);
  writeRegSnapshotsToStorage(next);
  return next;
}

export function clearRegSnapshots(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REG_SNAPSHOT_STORAGE_KEY);
}

export function reorderRegSnapshots(order: string[]): RegulationSnapshot[] {
  const existing = readRegSnapshotsFromStorage();
  const orderMap = new Map(order.map((id, idx) => [id, idx] as const));
  const sorted = [...existing].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  writeRegSnapshotsToStorage(sorted);
  return sorted;
}

export function estimateRegSnapshotsSize(snapshots?: RegulationSnapshot[]): number {
  const list = snapshots ?? readRegSnapshotsFromStorage();
  try {
    const json = JSON.stringify(list);
    return json ? json.length : 0;
  } catch (err) {
    console.warn("Failed to stringify regulation snapshots for size estimate", err);
    return 0;
  }
}

export function exportRegSnapshots(): string {
  const snaps = readRegSnapshotsFromStorage();
  return JSON.stringify(snaps, null, 2);
}

export function importRegSnapshots(raw: string): RegulationSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("Invalid regulation snapshot JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Snapshot import must be an array");
  }
  const sanitized: RegulationSnapshot[] = parsed
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;
      const { id, createdAt, description } = item;
      if (!id || !description) return null;
      const aggregated = item.aggregatedRolling || {};
      return {
        ...item,
        version: typeof item.version === "number" ? item.version : REG_SNAPSHOT_VERSION,
        createdAt: createdAt || new Date().toISOString(),
        aggregatedRolling: {
          time_bin_minutes: Number(aggregated.time_bin_minutes ?? item.minutesPerBin ?? 15),
          post_counts: aggregated.post_counts && typeof aggregated.post_counts === "object" ? { ...aggregated.post_counts } : {},
          pre_counts: aggregated.pre_counts && typeof aggregated.pre_counts === "object" ? { ...aggregated.pre_counts } : undefined,
          capacity: aggregated.capacity && typeof aggregated.capacity === "object" ? { ...aggregated.capacity } : undefined,
          tv_ids_order: Array.isArray(aggregated.tv_ids_order) ? [...aggregated.tv_ids_order] : undefined,
          timeLabels: Array.isArray(aggregated.timeLabels) ? [...aggregated.timeLabels] : undefined,
        },
      } as RegulationSnapshot;
    })
    .filter(Boolean) as RegulationSnapshot[];
  if (sanitized.length > MAX_REG_SNAPSHOTS) {
    throw new RegSnapshotLimitError(MAX_REG_SNAPSHOTS);
  }
  writeRegSnapshotsToStorage(sanitized);
  return sanitized;
}
