"use client";

import { authFetch } from "@/lib/auth";
import {
  RegulationPlanPerAccAttribMode,
  RegulationPlanSimulationResponse,
  Trajectory,
} from "@/lib/models";

export type RegulationPlanSimulationTvKind = "as" | "nonas" | "any";

export type RegulationPlanSimulationUiRegulation = {
  trafficVolume: string;
  rate: number;
  activeTimeWindowFrom: number;
  activeTimeWindowTo: number;
  flightCallsigns: string[];
};

export type RegulationPlanSimulationRequestPayload = {
  regulations: Array<{
    location: string;
    rate: number;
    time_windows: number[];
    target_flight_ids: string[];
  }>;
  weights: Record<string, number>;
  tv_kind: RegulationPlanSimulationTvKind;
  include_excess_vector: boolean;
  per_acc_attrib_mode: RegulationPlanPerAccAttribMode;
};

type BuildRegulationPlanSimulationPayloadParams = {
  regulations: RegulationPlanSimulationUiRegulation[];
  flights: Trajectory[];
  perAccAttribMode?: RegulationPlanPerAccAttribMode;
  tvKind?: RegulationPlanSimulationTvKind;
  includeExcessVector?: boolean;
  weights?: Record<string, number>;
};

type SimulateRegulationPlanParams = BuildRegulationPlanSimulationPayloadParams;

const DEFAULT_LEGACY_WEIGHTS: Record<string, number> = {
  alpha: 1.0,
  beta: 0.0,
  gamma: 0.0,
  delta: 0.0,
};

export function computeRegulationTimeWindowBins(fromSeconds: number, toSeconds: number): number[] {
  const binSize = 15 * 60;
  if (toSeconds <= fromSeconds) {
    return [Math.floor(fromSeconds / binSize)];
  }
  const startBin = Math.floor(fromSeconds / binSize);
  const endBinExclusive = Math.ceil(toSeconds / binSize);
  const bins: number[] = [];
  for (let b = startBin; b < endBinExclusive; b += 1) {
    bins.push(b);
  }
  return bins;
}

export function buildRegulationPlanSimulationPayload({
  regulations,
  flights,
  perAccAttribMode = "dwelling_spread",
  tvKind = "as",
  includeExcessVector = false,
  weights = DEFAULT_LEGACY_WEIGHTS,
}: BuildRegulationPlanSimulationPayloadParams): RegulationPlanSimulationRequestPayload {
  const flightsById = new Map<string, Trajectory>();
  const flightsByCallsign = new Map<string, Trajectory>();

  for (const flight of flights) {
    flightsById.set(String(flight.flightId), flight);
    if (flight.callSign) {
      flightsByCallsign.set(String(flight.callSign), flight);
    }
  }

  const toFlightId = (token: string): string => {
    const tokenStr = String(token);
    const byId = flightsById.get(tokenStr);
    if (byId?.flightId) return String(byId.flightId);
    const byCs = flightsByCallsign.get(tokenStr);
    if (byCs?.flightId) return String(byCs.flightId);
    return tokenStr;
  };

  return {
    regulations: regulations.map((r) => ({
      location: r.trafficVolume,
      rate: r.rate,
      time_windows: computeRegulationTimeWindowBins(r.activeTimeWindowFrom, r.activeTimeWindowTo),
      target_flight_ids: Array.isArray(r.flightCallsigns) ? r.flightCallsigns.map(toFlightId) : [],
    })),
    weights: { ...weights },
    tv_kind: tvKind,
    include_excess_vector: Boolean(includeExcessVector),
    per_acc_attrib_mode: perAccAttribMode,
  };
}

export async function simulateRegulationPlan({
  regulations,
  flights,
  perAccAttribMode = "dwelling_spread",
  tvKind = "as",
  includeExcessVector = false,
  weights = DEFAULT_LEGACY_WEIGHTS,
}: SimulateRegulationPlanParams): Promise<RegulationPlanSimulationResponse> {
  const payload = buildRegulationPlanSimulationPayload({
    regulations,
    flights,
    perAccAttribMode,
    tvKind,
    includeExcessVector,
    weights,
  });

  const res = await authFetch("/api/regulation_plan_simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Simulation request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as RegulationPlanSimulationResponse;
}

