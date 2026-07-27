import { normalizeTraceFlightIds } from "@/lib/flowTrace";

export type FlowTracePreviewState = {
  flightLinePreviewFlightIds?: Iterable<string> | null;
  flowGroups?: Record<string, Iterable<string> | null | undefined> | null;
  flowPreviewFlightId?: string | null;
  flowPreviewGroupId?: string | null;
  proposalPreviewActive?: boolean;
  proposalPreviewFlightIds?: Iterable<string> | null;
  regulationPreviewActive?: boolean;
  regulationTargetFlightIds?: Iterable<string> | null;
};

export function getFlowTracePreviewKey(flightIds: Iterable<string> | null | undefined): string {
  return normalizeTraceFlightIds(flightIds).slice().sort().join("\u0000");
}

export function deriveFlowTracePreviewFlightIds(state: FlowTracePreviewState): string[] {
  const singleFlightPreviewId = String(state.flowPreviewFlightId ?? "").trim();
  if (singleFlightPreviewId) return [];

  const linePreviewIds = normalizeTraceFlightIds(state.flightLinePreviewFlightIds);
  if (linePreviewIds.length === 1) return [];

  const groupId = String(state.flowPreviewGroupId ?? "").trim();
  if (groupId) {
    const groupIds = normalizeTraceFlightIds(state.flowGroups?.[groupId]);
    return groupIds.length > 1 ? groupIds : [];
  }

  if (linePreviewIds.length > 1) return linePreviewIds;

  if (state.proposalPreviewActive) {
    const proposalIds = normalizeTraceFlightIds(state.proposalPreviewFlightIds);
    return proposalIds.length > 1 ? proposalIds : [];
  }

  if (state.regulationPreviewActive) {
    const regulationIds = normalizeTraceFlightIds(state.regulationTargetFlightIds);
    return regulationIds.length > 1 ? regulationIds : [];
  }

  return [];
}
