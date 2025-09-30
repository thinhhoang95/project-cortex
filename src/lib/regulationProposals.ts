import { authFetch } from "@/lib/auth";

export type ProposeRegulationsRequest = {
  traffic_volume_id: string;
  time_window: string;
  top_k_regulations?: number;
  threshold?: number;
  resolution?: number;
};

export type ProposalFlowFeatures = {
  gH?: number;
  v_tilde?: number;
  rho?: number;
  slack15?: number;
  slack30?: number;
  slack45?: number;
  coverage?: number;
  r0_i?: number;
  xGH?: number;
  DH?: number;
  tGl?: number;
  tGu?: number;
  bins_count?: number;
  num_flights?: number;
};

export type ProposalFlow = {
  flow_id: number;
  flight_ids: string[];
  control_volume_id: string | null;
  baseline_rate_per_hour: number;
  allowed_rate_per_hour: number;
  assigned_cut_per_hour: number;
  time_window_label: string;
  time_window_bins: number[];
  features: ProposalFlowFeatures;
  final_score: number;
};

export type ProposalObjectiveComponents = {
  before: Record<string, number>;
  after: Record<string, number>;
  delta: Record<string, number>;
};

export type RegulationProposal = {
  id: string;
  hotspot: {
    traffic_volume_id: string;
    input_time_window: string;
    timebins: number[];
  };
  control_window: {
    bins: number[];
    label: string;
  };
  objective_improvement: {
    delta_deficit_per_hour: number;
    delta_objective_score: number;
  };
  objective_components: ProposalObjectiveComponents;
  flows: ProposalFlow[];
  diagnostics?: Record<string, number>;
};

export type ProposeRegulationsResponse = {
  traffic_volume_id: string;
  time_window: string;
  time_bin_minutes: number;
  top_k: number;
  weights: Record<string, number>;
  num_proposals: number;
  proposals: RegulationProposal[];
};

export function toTimeWindow(fromHHMM: string, toHHMM: string): string {
  return `${fromHHMM}-${toHHMM}`;
}

export async function proposeRegulations(
  body: ProposeRegulationsRequest
): Promise<ProposeRegulationsResponse> {
  const res = await authFetch("/api/propose_regulations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => "Failed to propose regulations");
    throw new Error(message || "Failed to propose regulations");
  }
  const data = await res.json();
  const enriched = {
    ...data,
    proposals: (data?.proposals || []).map((p: any, i: number) => ({
      ...p,
      id: `RP-${String(i + 1).padStart(2, "0")} ${data?.traffic_volume_id ?? "TV"} ${String(data?.time_window ?? "").replaceAll(":", "")}`,
    })),
  };
  return enriched as ProposeRegulationsResponse;
}

export function collectProposalFlights(proposal: RegulationProposal | null | undefined): Set<string> {
  const flights = new Set<string>();
  if (!proposal) return flights;
  for (const flow of proposal.flows || []) {
    for (const flight of flow.flight_ids || []) {
      flights.add(String(flight));
    }
  }
  return flights;
}

export function collectAllProposalFlights(
  response: ProposeRegulationsResponse | null | undefined
): Set<string> {
  const flights = new Set<string>();
  if (!response) return flights;
  for (const proposal of response.proposals || []) {
    const ids = collectProposalFlights(proposal);
    ids.forEach((id) => flights.add(id));
  }
  return flights;
}
