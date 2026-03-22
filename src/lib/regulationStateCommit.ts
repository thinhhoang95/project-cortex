import type {
  AutomaticRateAdjustmentResponse,
  RegulationPlanSimulationResponse,
  Trajectory,
} from "@/lib/models";
import type { FlowInputPayload } from "@/lib/flow-input";
import type { ResourceStateHistoryCommitRequest } from "@/lib/resourceStates";
import { buildUniqueCallsignIndex } from "@/lib/flightIdentity";
import { minutesToHHMM } from "@/lib/time";

type RegulationCommitDraft = {
  trafficVolume: string;
  activeTimeWindowFrom: number;
  activeTimeWindowTo: number;
  rate: number;
  flightIds?: string[];
  flightCallsigns?: string[];
};

const INTEGER_EPSILON = 1e-6;

function formatRegulationWindow(
  fromSeconds: number | null | undefined,
  toSeconds: number | null | undefined,
): string | null {
  const from = Number(fromSeconds);
  const to = Number(toSeconds);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return `${minutesToHHMM(Math.floor(from / 60))}-${minutesToHHMM(Math.floor(to / 60))}`;
}

function normalizeCommitDelayMinutes(
  value: unknown,
  flightKey: string,
): number | null {
  const delayMinutes = Number(value);

  if (!Number.isFinite(delayMinutes)) {
    throw new Error(`Delay for ${flightKey} is not numeric.`);
  }
  if (delayMinutes < 0) {
    throw new Error(`Delay for ${flightKey} must be non-negative.`);
  }
  if (delayMinutes === 0) {
    return null;
  }

  const roundedDelayMinutes = Math.round(delayMinutes);
  if (Math.abs(delayMinutes - roundedDelayMinutes) > INTEGER_EPSILON) {
    throw new Error(
      `Delay for ${flightKey} must be an integer number of minutes to commit exactly.`,
    );
  }

  return roundedDelayMinutes;
}

export function buildCommitDelayMinutesMap(
  delaysByFlight: RegulationPlanSimulationResponse["delays_by_flight"] | null | undefined,
  flights: Trajectory[],
): Record<string, number> {
  const flightsById = new Map<string, string>();
  const flightsByCallsign = buildUniqueCallsignIndex(flights);

  for (const flight of flights) {
    const flightId = String(flight?.flightId ?? "").trim();
    if (!flightId) continue;

    flightsById.set(flightId, flightId);
  }

  const normalized: Record<string, number> = {};
  for (const [rawFlightKey, rawDelayMinutes] of Object.entries(delaysByFlight ?? {})) {
    const flightKey = String(rawFlightKey ?? "").trim();
    if (!flightKey) continue;

    const delayMinutes = normalizeCommitDelayMinutes(rawDelayMinutes, flightKey);
    if (delayMinutes === null) continue;

    let canonicalFlightId = flightsById.get(flightKey);
    if (!canonicalFlightId && flightsByCallsign.has(flightKey)) {
      const resolved = flightsByCallsign.get(flightKey);
      if (!resolved) {
        throw new Error(`Delay assignment for callsign ${flightKey} is ambiguous.`);
      }
      canonicalFlightId = resolved;
    }
    canonicalFlightId = canonicalFlightId ?? flightKey;
    const existingDelay = normalized[canonicalFlightId];

    if (
      existingDelay !== undefined &&
      existingDelay !== delayMinutes
    ) {
      throw new Error(
        `Conflicting delay assignments found for ${canonicalFlightId}.`,
      );
    }

    normalized[canonicalFlightId] = delayMinutes;
  }

  return normalized;
}

export function buildRegulationCommitLabel(
  regulations: RegulationCommitDraft[],
): string {
  if (!Array.isArray(regulations) || regulations.length === 0) {
    return "Committed regulation";
  }

  const firstRegulation = regulations[0];
  const firstTrafficVolume =
    String(firstRegulation?.trafficVolume ?? "").trim() || "Unknown TV";
  const firstWindow = formatRegulationWindow(
    firstRegulation?.activeTimeWindowFrom,
    firstRegulation?.activeTimeWindowTo,
  );
  const firstSummary = firstWindow
    ? `${firstTrafficVolume} ${firstWindow}`
    : firstTrafficVolume;

  if (regulations.length === 1) {
    return firstSummary;
  }

  return `${firstSummary} +${regulations.length - 1} more`;
}

function buildTargetWindowCommitLabel(
  targets: FlowInputPayload["targets"] | null | undefined,
): string {
  const entries = Object.entries(targets ?? {})
    .map(([trafficVolume, window]) => ({
      trafficVolume: String(trafficVolume ?? "").trim(),
      from: String(window?.from ?? "").trim(),
      to: String(window?.to ?? "").trim(),
    }))
    .filter((entry) => entry.trafficVolume.length > 0)
    .sort((a, b) => a.trafficVolume.localeCompare(b.trafficVolume));

  if (entries.length === 0) {
    return "Committed flow optimization";
  }

  const first = entries[0];
  const hasWindow = first.from.length > 0 && first.to.length > 0;
  const firstSummary = hasWindow
    ? `${first.trafficVolume} ${first.from}-${first.to}`
    : first.trafficVolume;

  if (entries.length === 1) {
    return firstSummary;
  }

  return `${firstSummary} +${entries.length - 1} more`;
}

export function buildResourceStateHistoryCommitFromSimulation({
  parentStateId,
  regulations,
  result,
  flights,
}: {
  parentStateId: string;
  regulations: RegulationCommitDraft[];
  result: RegulationPlanSimulationResponse;
  flights: Trajectory[];
}): ResourceStateHistoryCommitRequest {
  const trimmedParentStateId = String(parentStateId ?? "").trim();
  if (!trimmedParentStateId) {
    throw new Error("The current head state is not available for commit.");
  }

  const delaysMin = buildCommitDelayMinutesMap(result?.delays_by_flight, flights);
  if (Object.keys(delaysMin).length === 0) {
    throw new Error("No positive delay assignments are available to commit.");
  }

  return {
    parent_state_id: trimmedParentStateId,
    label: buildRegulationCommitLabel(regulations),
    metadata: {
      source: "regulation_results",
      num_regulations: Array.isArray(regulations) ? regulations.length : 0,
      regulations: (regulations ?? []).map((regulation, index) => ({
        order: index + 1,
        traffic_volume: String(regulation?.trafficVolume ?? "").trim() || null,
        rate: Number.isFinite(Number(regulation?.rate))
          ? Number(regulation.rate)
          : null,
        time_window: formatRegulationWindow(
          regulation?.activeTimeWindowFrom,
          regulation?.activeTimeWindowTo,
        ),
        num_target_flights: Array.isArray(regulation?.flightIds)
          ? regulation.flightIds.filter((value) => String(value ?? "").trim().length > 0).length
          : Array.isArray(regulation?.flightCallsigns)
            ? regulation.flightCallsigns.filter((value) => String(value ?? "").trim().length > 0).length
            : 0,
      })),
    },
    delays_min: delaysMin,
  };
}

export function buildResourceStateHistoryCommitFromFlowOptimization({
  parentStateId,
  input,
  result,
  flights,
}: {
  parentStateId: string;
  input: FlowInputPayload;
  result: AutomaticRateAdjustmentResponse;
  flights: Trajectory[];
}): ResourceStateHistoryCommitRequest {
  const trimmedParentStateId = String(parentStateId ?? "").trim();
  if (!trimmedParentStateId) {
    throw new Error("The current head state is not available for commit.");
  }

  const delaysMin = buildCommitDelayMinutesMap(result?.delays_min, flights);
  if (Object.keys(delaysMin).length === 0) {
    throw new Error("No positive delay assignments are available to commit.");
  }

  const targets = Object.entries(input?.targets ?? {})
    .map(([trafficVolume, window], index) => ({
      order: index + 1,
      traffic_volume: String(trafficVolume ?? "").trim() || null,
      time_window:
        window?.from && window?.to
          ? `${String(window.from).trim()}-${String(window.to).trim()}`
          : null,
    }))
    .filter((target) => target.traffic_volume);

  const controlledVolumes = Array.from(
    new Set(
      (result?.flows ?? [])
        .map((flow) => String(flow?.controlled_volume ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return {
    parent_state_id: trimmedParentStateId,
    label: buildTargetWindowCommitLabel(input?.targets),
    metadata: {
      source: "flow_evaluation",
      num_targets: targets.length,
      num_flows: Array.isArray(result?.flows) ? result.flows.length : 0,
      num_delayed_flights: Object.keys(delaysMin).length,
      targets,
      controlled_volumes: controlledVolumes,
      objective_baseline_score: Number.isFinite(Number(result?.objective_baseline?.score))
        ? Number(result.objective_baseline.score)
        : null,
      objective_optimized_score: Number.isFinite(Number(result?.objective_optimized?.score))
        ? Number(result.objective_optimized.score)
        : null,
      improvement_absolute: Number.isFinite(Number(result?.improvement?.absolute))
        ? Number(result.improvement.absolute)
        : null,
      improvement_percent: Number.isFinite(Number(result?.improvement?.percent))
        ? Number(result.improvement.percent)
        : null,
    },
    delays_min: delaysMin,
  };
}
