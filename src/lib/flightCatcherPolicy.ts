import type { RegulationCatcherMode, RerouteCatcherMode } from "@/components/useSimStore";

export type FlightCatcherContextMode = "tv_baseline" | "visible_only";

export interface FlightCatcherGateSnapshot {
  createdAtSimTime: number;
  contextMode: FlightCatcherContextMode;
  eligibleFlightIds: Set<string>;
}

type CatcherMutationMode = "include" | "exclude";

type IdIterable = Iterable<string> | null | undefined;

export function normalizeFlightIds(ids: IdIterable): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids || []) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function freezeGateSnapshot(params: {
  createdAtSimTime: number;
  contextMode: FlightCatcherContextMode;
  visibleFlightIds: IdIterable;
  baselineFlightIds?: IdIterable;
}): FlightCatcherGateSnapshot {
  const { createdAtSimTime, contextMode, visibleFlightIds, baselineFlightIds } = params;
  const visible = normalizeFlightIds(visibleFlightIds);
  const eligible = new Set<string>();

  if (contextMode === "tv_baseline") {
    const baseline = new Set(normalizeFlightIds(baselineFlightIds));
    for (const id of visible) {
      if (baseline.has(id)) eligible.add(id);
    }
  } else {
    for (const id of visible) eligible.add(id);
  }

  return {
    createdAtSimTime,
    contextMode,
    eligibleFlightIds: eligible,
  };
}

export function filterCapturedToGate(
  capturedFlightIds: IdIterable,
  gateSnapshot: FlightCatcherGateSnapshot | null | undefined
): string[] {
  const captured = normalizeFlightIds(capturedFlightIds);
  if (!gateSnapshot) return captured;
  return captured.filter((id) => gateSnapshot.eligibleFlightIds.has(id));
}

export function applyCatcherToRegulationTargets(params: {
  currentTargetFlightIds: IdIterable;
  capturedFlightIds: IdIterable;
  catcherMode: CatcherMutationMode | Exclude<RegulationCatcherMode, "off">;
}): Set<string> {
  const { currentTargetFlightIds, capturedFlightIds, catcherMode } = params;
  const next = new Set(normalizeFlightIds(currentTargetFlightIds));
  const captured = normalizeFlightIds(capturedFlightIds);

  if (catcherMode === "include") {
    for (const id of captured) next.add(id);
  } else {
    for (const id of captured) next.delete(id);
  }

  return next;
}

export function applyCatcherToRerouteState(params: {
  contextMode: FlightCatcherContextMode;
  currentBaseFlightIds: IdIterable;
  currentSelectedFlightIds: IdIterable;
  capturedFlightIds: IdIterable;
  catcherMode: CatcherMutationMode | Exclude<RerouteCatcherMode, "off">;
}): { nextBaseFlightIds: string[]; nextSelectedFlightIds: Set<string> } {
  const {
    contextMode,
    currentBaseFlightIds,
    currentSelectedFlightIds,
    capturedFlightIds,
    catcherMode,
  } = params;
  const base = normalizeFlightIds(currentBaseFlightIds);
  const baseSet = new Set(base);
  const selected = new Set(normalizeFlightIds(currentSelectedFlightIds).filter((id) => baseSet.has(id)));
  const captured = normalizeFlightIds(capturedFlightIds);

  if (contextMode === "tv_baseline") {
    for (const id of captured) {
      if (!baseSet.has(id)) continue;
      if (catcherMode === "include") selected.add(id);
      else selected.delete(id);
    }
    return {
      nextBaseFlightIds: base,
      nextSelectedFlightIds: selected,
    };
  }

  const nextBase = base.slice();
  const nextBaseSet = new Set(base);
  if (catcherMode === "include") {
    for (const id of captured) {
      if (!nextBaseSet.has(id)) {
        nextBaseSet.add(id);
        nextBase.push(id);
      }
      selected.add(id);
    }
  } else {
    const removeSet = new Set(captured);
    const filteredBase = nextBase.filter((id) => !removeSet.has(id));
    const allowed = new Set(filteredBase);
    for (const id of Array.from(selected)) {
      if (!allowed.has(id)) selected.delete(id);
    }
    return {
      nextBaseFlightIds: filteredBase,
      nextSelectedFlightIds: selected,
    };
  }

  return {
    nextBaseFlightIds: nextBase,
    nextSelectedFlightIds: selected,
  };
}

export function deriveVisibleFlightLineIds(params: {
  insideRangeActiveFlightIds: IdIterable;
  focusMode: boolean;
  focusFlightIds: IdIterable;
  flowPreviewFlightId?: string | null;
  flowPreviewGroupId?: string | null;
  flowCommunities?: Record<string, number> | null;
  flowGroups?: Record<string, string[]> | null;
  flowViewEnabled?: boolean;
  showAllFlowCommunitiesWhenEnabled?: boolean;
  proposalPreviewActive?: boolean;
  proposalPreviewFlightIds?: IdIterable;
  regulationPreviewActive?: boolean;
  regulationTargetFlightIds?: IdIterable;
  clampToActiveSet?: boolean;
}): string[] {
  const inside = normalizeFlightIds(params.insideRangeActiveFlightIds);
  const insideSet = new Set(inside);
  let visible: string[] = [];

  if (params.proposalPreviewActive) {
    visible = normalizeFlightIds(params.proposalPreviewFlightIds);
  } else if (params.regulationPreviewActive) {
    visible = normalizeFlightIds(params.regulationTargetFlightIds);
  } else if (params.flowPreviewFlightId) {
    visible = normalizeFlightIds([params.flowPreviewFlightId]);
  } else if (params.flowPreviewGroupId) {
    const groupId = String(params.flowPreviewGroupId);
    if (params.flowGroups && params.flowGroups[groupId]) {
      visible = normalizeFlightIds(params.flowGroups[groupId]);
    } else if (params.flowCommunities) {
      visible = normalizeFlightIds(
        Object.entries(params.flowCommunities)
          .filter(([, cid]) => String(cid) === groupId)
          .map(([fid]) => String(fid))
      );
    }
  } else if (
    params.showAllFlowCommunitiesWhenEnabled &&
    params.flowViewEnabled &&
    params.flowCommunities &&
    Object.keys(params.flowCommunities).length > 0
  ) {
    visible = normalizeFlightIds(Object.keys(params.flowCommunities));
  } else if (params.focusMode) {
    visible = normalizeFlightIds(params.focusFlightIds);
  } else {
    visible = inside;
  }

  if (!params.clampToActiveSet) {
    return visible;
  }
  return visible.filter((id) => insideSet.has(id));
}
