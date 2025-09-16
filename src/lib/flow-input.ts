export type FlowInputPayload = {
  flows: Record<string | number, string[]>;
  targets: Record<string, { from: string; to: string }>;
  ripples?: Record<string, { from: string; to: string }>;
  auto_ripple_time_bins?: number;
  indexer_path?: string;
  flights_path?: string;
  capacities_path?: string;
  weights?: Record<string, number>;
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
  if (payload.colorsByFlow) cloned.colorsByFlow = { ...payload.colorsByFlow };
  return cloned;
}
