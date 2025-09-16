import { AutomaticRateAdjustmentResponse, BaseEvaluationResponse } from "@/lib/models";
import { AutorateOccupancyResponse, cloneAutorateOccupancyResponse } from "@/lib/autorate";
import { FlowInputPayload, sanitizeFlowInputPayload } from "@/lib/flow-input";

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_STORAGE_KEY = "cortex.solutionSnapshots";
export const MAX_SNAPSHOTS = 4;
// Warn once estimated snapshot payload size exceeds 4.5 MiB (~90% of typical 5 MiB quota)
export const SNAPSHOT_SIZE_WARN_THRESHOLD = Math.floor(4.5 * 1024 * 1024);

function cloneSeriesMap(src?: Record<string, number[]> | null) {
  if (!src) return undefined;
  const out: Record<string, number[]> = {};
  for (const [key, series] of Object.entries(src)) {
    out[key] = Array.isArray(series) ? [...series] : [];
  }
  return out;
}

export interface SnapshotObjectiveSummary {
  baseline: AutomaticRateAdjustmentResponse["objective_baseline"] | null;
  optimized: AutomaticRateAdjustmentResponse["objective_optimized"] | null;
  evaluation?: BaseEvaluationResponse["objective"] | null;
}

export interface SnapshotFlowOutcome {
  flowId: number;
  controlledVolume: string | null;
  n0?: number[];
  nOpt?: number[];
  targetDemand?: Record<string, number[]>;
  rippleDemand?: Record<string, number[]>;
  targetOccupancyOpt?: Record<string, number[]>;
  rippleOccupancyOpt?: Record<string, number[]>;
}

export interface SnapshotAggregatedOccupancy
  extends Pick<AutorateOccupancyResponse, "time_bin_minutes" | "pre_counts" | "post_counts" | "capacity" | "tv_ids_order"> {
  timeLabels?: string[];
}

export interface SolutionSnapshot {
  version: number;
  id: string;
  createdAt: string;
  description: string;
  sourceRoute: string;
  shareUrl?: string | null;
  payload: FlowInputPayload;
  weightsUsed?: Record<string, number> | null;
  weightsOverride?: Record<string, number> | null;
  saParamsUsed?: Record<string, number> | null;
  saParamsOverride?: Record<string, number> | null;
  minutesPerBin: number;
  timeLabels?: string[];
  objective: SnapshotObjectiveSummary;
  delaysMin?: Record<string, number> | null;
  flows: SnapshotFlowOutcome[];
  aggregatedOccupancy?: SnapshotAggregatedOccupancy | null;
}

export interface CreateSnapshotParams {
  description: string;
  payload: FlowInputPayload;
  weightsOverride?: Record<string, number> | null;
  weightsUsed?: Record<string, number> | null;
  saParamsOverride?: Record<string, number> | null;
  saParamsUsed?: Record<string, number> | null;
  evaluation?: BaseEvaluationResponse | null;
  optimization: AutomaticRateAdjustmentResponse;
  occupancy?: AutorateOccupancyResponse | null;
  minutesPerBin: number;
  shareUrl?: string | null;
  sourceRoute?: string;
  id?: string;
  createdAt?: string;
}

export function generateSnapshotId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `snapshot-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function createSolutionSnapshot(params: CreateSnapshotParams): SolutionSnapshot {
  const {
    description,
    payload,
    weightsOverride,
    weightsUsed,
    saParamsOverride,
    saParamsUsed,
    evaluation,
    optimization,
    occupancy,
    minutesPerBin,
    shareUrl,
    sourceRoute = "flow-evaluation",
    id = generateSnapshotId(),
    createdAt = new Date().toISOString(),
  } = params;

  const flows: SnapshotFlowOutcome[] = (optimization.flows || []).map((f) => ({
    flowId: Number(f.flow_id),
    controlledVolume: f.controlled_volume ?? null,
    n0: Array.isArray(f.n0) ? [...f.n0] : undefined,
    nOpt: Array.isArray(f.n_opt) ? [...f.n_opt] : undefined,
    targetDemand: cloneSeriesMap(f.target_demands) || undefined,
    rippleDemand: cloneSeriesMap(f.ripple_demands) || undefined,
    targetOccupancyOpt: cloneSeriesMap(f.target_occupancy_opt) || undefined,
    rippleOccupancyOpt: cloneSeriesMap(f.ripple_occupancy_opt) || undefined,
  }));

  const aggregated: SnapshotAggregatedOccupancy | null = (() => {
    const clone = cloneAutorateOccupancyResponse(occupancy);
    if (!clone) return null;
    return {
      time_bin_minutes: clone.time_bin_minutes,
      pre_counts: clone.pre_counts,
      post_counts: clone.post_counts,
      capacity: clone.capacity,
      tv_ids_order: clone.tv_ids_order,
      timeLabels: clone.timebins?.labels ? [...clone.timebins.labels] : undefined,
    };
  })();

  const snapshot: SolutionSnapshot = {
    version: SNAPSHOT_VERSION,
    id,
    createdAt,
    description,
    sourceRoute,
    shareUrl,
    payload: sanitizeFlowInputPayload(payload) || {
      flows: {},
      targets: {},
    },
    weightsUsed: weightsUsed ? { ...weightsUsed } : null,
    weightsOverride: weightsOverride ? { ...weightsOverride } : null,
    saParamsUsed: saParamsUsed ? { ...saParamsUsed } : null,
    saParamsOverride: saParamsOverride ? { ...saParamsOverride } : null,
    minutesPerBin,
    timeLabels: aggregated?.timeLabels,
    objective: {
      baseline: optimization.objective_baseline ?? null,
      optimized: optimization.objective_optimized ?? null,
      evaluation: evaluation?.objective ?? null,
    },
    delaysMin: optimization.delays_min ? { ...optimization.delays_min } : null,
    flows,
    aggregatedOccupancy: aggregated,
  };

  return snapshot;
}

function readSnapshotsFromStorage(): SolutionSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => ({
        ...item,
        version: typeof item?.version === "number" ? item.version : SNAPSHOT_VERSION,
      }))
      .filter((item) => item && item.id);
  } catch (err) {
    console.warn("Failed to parse solution snapshots from storage", err);
    return [];
  }
}

function writeSnapshotsToStorage(snapshots: SolutionSnapshot[]): void {
  if (typeof window === "undefined") return;
  const sanitized = snapshots.map((snap) => ({ ...snap, version: SNAPSHOT_VERSION }));
  window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(sanitized));
}

export function loadSnapshots(): SolutionSnapshot[] {
  return readSnapshotsFromStorage();
}

export class SnapshotLimitError extends Error {
  limit: number;
  constructor(limit: number) {
    super(`Only ${limit} snapshots can be stored for comparison.`);
    this.name = "SnapshotLimitError";
    this.limit = limit;
  }
}

export function addSnapshot(
  snapshot: SolutionSnapshot,
  opts: { replaceId?: string } = {},
): SolutionSnapshot[] {
  const existing = readSnapshotsFromStorage();
  let next: SolutionSnapshot[];
  if (opts.replaceId) {
    next = existing.map((s) => (s.id === opts.replaceId ? snapshot : s));
    if (!existing.some((s) => s.id === opts.replaceId)) {
      next = [...existing, snapshot];
    }
  } else {
    if (existing.length >= MAX_SNAPSHOTS) {
      throw new SnapshotLimitError(MAX_SNAPSHOTS);
    }
    next = [...existing, snapshot];
  }
  writeSnapshotsToStorage(next);
  return next;
}

export function updateSnapshotDescription(id: string, description: string): SolutionSnapshot[] {
  const existing = readSnapshotsFromStorage();
  const next = existing.map((snap) =>
    snap.id === id ? { ...snap, description } : snap
  );
  writeSnapshotsToStorage(next);
  return next;
}

export function deleteSnapshot(id: string): SolutionSnapshot[] {
  const existing = readSnapshotsFromStorage();
  const next = existing.filter((snap) => snap.id !== id);
  writeSnapshotsToStorage(next);
  return next;
}

export function clearSnapshots(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
}

export function reorderSnapshots(order: string[]): SolutionSnapshot[] {
  const existing = readSnapshotsFromStorage();
  const orderMap = new Map(order.map((id, idx) => [id, idx] as const));
  const sorted = [...existing].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  writeSnapshotsToStorage(sorted);
  return sorted;
}

export function estimateSnapshotsSize(snapshots?: SolutionSnapshot[]): number {
  const list = snapshots ?? readSnapshotsFromStorage();
  try {
    const json = JSON.stringify(list);
    return json ? json.length : 0;
  } catch (err) {
    console.warn("Failed to stringify snapshots for size estimate", err);
    return 0;
  }
}

export function exportSnapshots(): string {
  const snaps = readSnapshotsFromStorage();
  return JSON.stringify(snaps, null, 2);
}

export function importSnapshots(raw: string): SolutionSnapshot[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("Invalid snapshot JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Snapshot import must be an array");
  }
  const sanitized: SolutionSnapshot[] = parsed
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;
      const { id, createdAt, description } = item;
      if (!id || !description) return null;
      return {
        ...item,
        version: typeof item.version === "number" ? item.version : SNAPSHOT_VERSION,
        createdAt: createdAt || new Date().toISOString(),
      } as SolutionSnapshot;
    })
    .filter(Boolean) as SolutionSnapshot[];
  if (sanitized.length > MAX_SNAPSHOTS) {
    throw new SnapshotLimitError(MAX_SNAPSHOTS);
  }
  writeSnapshotsToStorage(sanitized);
  return sanitized;
}
