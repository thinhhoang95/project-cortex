import type { Trajectory } from "@/lib/models";

export type ResourceStateSummary = {
  state_id: string;
  parent_state_id: string | null;
  episode_index: number;
  label: string | null;
  num_affected_flights: number;
  num_delayed_flights: number;
  total_incremental_delay_minutes: number;
  total_cumulative_delay_minutes: number;
  is_selected: boolean;
  is_head: boolean;
  is_state_zero: boolean;
};

export type ResourceStateDetail = ResourceStateSummary & {
  created_at?: string | null;
  resource_date?: string | null;
  metadata?: Record<string, unknown> | null;
  incremental_delays_min?: Record<string, number> | null;
  cumulative_delays_min?: Record<string, number> | null;
};

export type ResourceStateHistoryResponse = {
  resource_date: string | null;
  state_zero_id: string | null;
  selected_state_id: string | null;
  head_state_id: string | null;
  num_states: number;
  state_history_generation: number;
  states: ResourceStateDetail[];
};

export type ResourceStateSyncPayload = {
  resourceDate: string | null;
  selectedStateId: string | null;
  headStateId: string | null;
  stateZeroId: string | null;
  numStates: number;
  stateHistoryGeneration: number;
  states: ResourceStateSummary[];
  selectedCumulativeDelaysMin: Record<string, number>;
};

export type ResourceStateHistoryCommitRequest = {
  parent_state_id: string;
  label?: string;
  metadata?: Record<string, unknown> | null;
  delays_min: Record<string, number>;
};

type ResourceContextLike = {
  selected_date?: string | null;
  selected_state_id?: string | null;
  head_state_id?: string | null;
  state_zero_id?: string | null;
  num_states?: number | null;
  state_history_generation?: number | null;
  states?: ResourceStateSummary[] | null;
};

export type ResourceStateBundleDateValidation = {
  matches: boolean;
  bundleDate: string | null;
};

function toFiniteInteger(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.trunc(numeric);
}

function normalizeResourceDateValue(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export function cloneResourceStateSummary(summary: ResourceStateSummary): ResourceStateSummary {
  return {
    state_id: String(summary?.state_id ?? ""),
    parent_state_id: summary?.parent_state_id ? String(summary.parent_state_id) : null,
    episode_index: toFiniteInteger(summary?.episode_index),
    label: summary?.label == null ? null : String(summary.label),
    num_affected_flights: Math.max(0, toFiniteInteger(summary?.num_affected_flights)),
    num_delayed_flights: Math.max(0, toFiniteInteger(summary?.num_delayed_flights)),
    total_incremental_delay_minutes: Math.max(0, toFiniteInteger(summary?.total_incremental_delay_minutes)),
    total_cumulative_delay_minutes: Math.max(0, toFiniteInteger(summary?.total_cumulative_delay_minutes)),
    is_selected: Boolean(summary?.is_selected),
    is_head: Boolean(summary?.is_head),
    is_state_zero: Boolean(summary?.is_state_zero),
  };
}

export function normalizeDelayMinutesMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};

  const normalized: Record<string, number> = {};
  for (const [rawFlightId, rawDelayMinutes] of Object.entries(value as Record<string, unknown>)) {
    const flightId = String(rawFlightId ?? "").trim();
    if (!flightId) continue;

    const delayMinutes = toFiniteInteger(rawDelayMinutes);
    if (delayMinutes <= 0) continue;
    normalized[flightId] = delayMinutes;
  }
  return normalized;
}

function toSummary(detail: ResourceStateDetail): ResourceStateSummary {
  return cloneResourceStateSummary(detail);
}

export function buildResourceStateSyncPayload(
  context: ResourceContextLike | null | undefined,
  history: ResourceStateHistoryResponse | null | undefined,
): ResourceStateSyncPayload {
  const historyStates = Array.isArray(history?.states) ? history.states : [];
  const contextStates = Array.isArray(context?.states) ? context.states : [];
  const states = (contextStates.length > 0 ? contextStates : historyStates.map(toSummary)).map(cloneResourceStateSummary);

  const selectedStateId =
    context?.selected_state_id ??
    history?.selected_state_id ??
    states.find((state) => state.is_selected)?.state_id ??
    null;
  const headStateId =
    context?.head_state_id ??
    history?.head_state_id ??
    states.find((state) => state.is_head)?.state_id ??
    null;
  const stateZeroId =
    context?.state_zero_id ??
    history?.state_zero_id ??
    states.find((state) => state.is_state_zero)?.state_id ??
    null;
  const selectedState =
    historyStates.find((state) => state.state_id === selectedStateId) ??
    historyStates.find((state) => state.is_selected) ??
    null;

  return {
    resourceDate: context?.selected_date ?? history?.resource_date ?? null,
    selectedStateId,
    headStateId,
    stateZeroId,
    numStates:
      Math.max(
        toFiniteInteger(context?.num_states),
        toFiniteInteger(history?.num_states),
        states.length,
      ) || states.length,
    stateHistoryGeneration: Math.max(
      toFiniteInteger(context?.state_history_generation),
      toFiniteInteger(history?.state_history_generation),
    ),
    states,
    selectedCumulativeDelaysMin: normalizeDelayMinutesMap(selectedState?.cumulative_delays_min),
  };
}

export function validateResourceStateBundleDate(
  expectedResourceDate: string | null | undefined,
  context: ResourceContextLike | null | undefined,
  history: ResourceStateHistoryResponse | null | undefined,
): ResourceStateBundleDateValidation {
  const expectedDate = normalizeResourceDateValue(expectedResourceDate);
  const contextDate = normalizeResourceDateValue(context?.selected_date);
  const historyDate = normalizeResourceDateValue(history?.resource_date);

  if (contextDate && historyDate && contextDate !== historyDate) {
    return {
      matches: false,
      bundleDate: contextDate,
    };
  }

  const bundleDate = contextDate ?? historyDate;
  if (!expectedDate || !bundleDate) {
    return {
      matches: false,
      bundleDate,
    };
  }

  return {
    matches: bundleDate === expectedDate,
    bundleDate,
  };
}

export function applyCumulativeDelaysToTrajectories(
  baselineFlights: Trajectory[],
  cumulativeDelaysMin: Record<string, number> | null | undefined,
): Trajectory[] {
  if (!Array.isArray(baselineFlights) || baselineFlights.length === 0) return [];

  const delays = normalizeDelayMinutesMap(cumulativeDelaysMin);
  const delayedFlightIds = Object.keys(delays);
  if (delayedFlightIds.length === 0) return baselineFlights;

  return baselineFlights.map((trajectory) => {
    const delayMinutes = delays[String(trajectory?.flightId ?? "")] ?? 0;
    const delaySeconds = delayMinutes * 60;
    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
      return trajectory;
    }

    return {
      ...trajectory,
      t0: trajectory.t0 + delaySeconds,
      t1: trajectory.t1 + delaySeconds,
      times: Array.isArray(trajectory.times)
        ? trajectory.times.map((time) => time + delaySeconds)
        : [],
    };
  });
}

export function computeTrajectoryRange(trajectories: Trajectory[]): [number, number] | null {
  if (!Array.isArray(trajectories) || trajectories.length === 0) return null;

  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const trajectory of trajectories) {
    const start = Number(trajectory?.t0);
    const end = Number(trajectory?.t1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    minT = Math.min(minT, start);
    maxT = Math.max(maxT, end);
  }

  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return null;
  return [minT, maxT];
}
