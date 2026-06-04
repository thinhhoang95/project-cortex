import type {
  AutomaticRateAdjustmentSearchParams,
  RegulationPlanPerAccAttribMode,
} from "@/lib/models";

export type FlowInputPayload = {
  flows: Record<string | number, string[]>;
  targets: Record<string, { from: string; to: string }>;
  ripples?: Record<string, { from: string; to: string }>;
  auto_ripple_time_bins?: number;
  indexer_path?: string;
  flights_path?: string;
  capacities_path?: string;
  weights?: Record<string, number>;
  search_params?: AutomaticRateAdjustmentSearchParams;
  per_acc_attrib_mode?: RegulationPlanPerAccAttribMode;
  spill_mode?: string;
  release_rate_for_spills?: number | Record<string, number>;
  spill_bin_time_separation_minutes?: number;
  // optional metadata for UI only
  colorsByFlow?: Record<string, string>;
};

export function sanitizeFlowInputPayload(payload: FlowInputPayload | null | undefined): FlowInputPayload | null {
  if (!payload) return null;
  const cloned: FlowInputPayload = {
    flows: { ...payload.flows },
    targets: { ...payload.targets },
  };
  if (payload.ripples) cloned.ripples = { ...payload.ripples };
  if (payload.auto_ripple_time_bins != null) cloned.auto_ripple_time_bins = payload.auto_ripple_time_bins;
  if (payload.indexer_path) cloned.indexer_path = payload.indexer_path;
  if (payload.flights_path) cloned.flights_path = payload.flights_path;
  if (payload.capacities_path) cloned.capacities_path = payload.capacities_path;
  if (payload.weights) cloned.weights = { ...payload.weights };
  if (payload.search_params) {
    cloned.search_params = {
      ...payload.search_params,
      initial_rate_by_flow: payload.search_params.initial_rate_by_flow
        ? { ...payload.search_params.initial_rate_by_flow }
        : undefined,
    };
  }
  if (payload.per_acc_attrib_mode) cloned.per_acc_attrib_mode = payload.per_acc_attrib_mode;
  if (payload.spill_mode) cloned.spill_mode = payload.spill_mode;
  if (typeof payload.release_rate_for_spills === "number") {
    cloned.release_rate_for_spills = payload.release_rate_for_spills;
  } else if (payload.release_rate_for_spills) {
    cloned.release_rate_for_spills = { ...payload.release_rate_for_spills };
  }
  if (payload.spill_bin_time_separation_minutes != null) {
    cloned.spill_bin_time_separation_minutes = payload.spill_bin_time_separation_minutes;
  }
  if (payload.colorsByFlow) cloned.colorsByFlow = { ...payload.colorsByFlow };
  return cloned;
}
