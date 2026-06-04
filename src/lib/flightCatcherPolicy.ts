import type { RegulationCatcherMode, RerouteCatcherMode } from "@/components/useSimStore";

export type FlightCatcherContextMode = "tv_baseline" | "visible_only";

export interface FlightCatcherGateSnapshot {
  createdAtSimTime: number;
  contextMode: FlightCatcherContextMode;
  eligibleFlightIds: Set<string>;
}

type CatcherMutationMode = "include" | "exclude";

type IdIterable = Iterable<string> | null | undefined;

export const BASE_FLIGHT_LINE_COLOR_EXPRESSION = ["get", "lineColor"] as const;
export const FLOW_LINE_DEFAULT_COLOR = "#9ca3af";

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
  activeInsideRangeFlightIds: IdIterable;
  listDrivenEligibleFlightIds?: IdIterable;
  focusMode: boolean;
  focusFlightIds: IdIterable;
  flightLinePreviewFlightIds?: IdIterable;
  flowPreviewFlightId?: string | null;
  flowPreviewGroupId?: string | null;
  flowGroups?: Record<string, string[]> | null;
  flowViewEnabled?: boolean;
  showAllFlowGroupsWhenEnabled?: boolean;
  proposalPreviewActive?: boolean;
  proposalPreviewFlightIds?: IdIterable;
  regulationPreviewActive?: boolean;
  regulationTargetFlightIds?: IdIterable;
}): string[] {
  const activeInside = normalizeFlightIds(params.activeInsideRangeFlightIds);
  const listDrivenEligible = new Set(
    normalizeFlightIds(params.listDrivenEligibleFlightIds ?? params.activeInsideRangeFlightIds)
  );
  const flightLinePreviewIds = normalizeFlightIds(params.flightLinePreviewFlightIds);
  let visible: string[] = [];
  let useListDrivenVisibility = false;

  if (flightLinePreviewIds.length > 0) {
    visible = flightLinePreviewIds;
    useListDrivenVisibility = true;
  } else if (params.proposalPreviewActive) {
    visible = normalizeFlightIds(params.proposalPreviewFlightIds);
    useListDrivenVisibility = true;
  } else if (params.regulationPreviewActive) {
    visible = normalizeFlightIds(params.regulationTargetFlightIds);
    useListDrivenVisibility = true;
  } else if (params.flowPreviewFlightId) {
    visible = normalizeFlightIds([params.flowPreviewFlightId]);
    useListDrivenVisibility = true;
  } else if (params.flowPreviewGroupId) {
    const groupId = String(params.flowPreviewGroupId);
    visible = normalizeFlightIds(params.flowGroups?.[groupId]);
    useListDrivenVisibility = true;
  } else if (
    params.showAllFlowGroupsWhenEnabled &&
    params.flowViewEnabled &&
    params.flowGroups &&
    Object.keys(params.flowGroups).length > 0
  ) {
    visible = normalizeFlightIds(Object.values(params.flowGroups).flat());
    useListDrivenVisibility = true;
  } else if (params.focusMode) {
    visible = normalizeFlightIds(params.focusFlightIds);
    useListDrivenVisibility = true;
  } else {
    visible = activeInside;
  }

  if (!useListDrivenVisibility) {
    return visible;
  }
  return visible.filter((id) => listDrivenEligible.has(id));
}

export function buildFlowLineColorExpression(params: {
  flowViewEnabled?: boolean;
  flowPreviewGroupId?: string | null;
  flowGroups?: Record<string, string[]> | null;
  flowColorByCommunity?: Record<string, string> | null;
  proposalPreviewActive?: boolean;
  regulationPreviewActive?: boolean;
}): readonly unknown[] {
  if (params.proposalPreviewActive || params.regulationPreviewActive) {
    return BASE_FLIGHT_LINE_COLOR_EXPRESSION;
  }

  const colorByGroup = params.flowColorByCommunity ?? {};
  const groups = params.flowGroups ?? {};
  const previewGroupId = String(params.flowPreviewGroupId ?? "").trim();

  if (previewGroupId) {
    const previewIds = normalizeFlightIds(groups[previewGroupId]);
    if (previewIds.length === 0) return BASE_FLIGHT_LINE_COLOR_EXPRESSION;
    return buildFlightIdColorCase([[colorByGroup[previewGroupId] ?? FLOW_LINE_DEFAULT_COLOR, previewIds]]);
  }

  if (!params.flowViewEnabled || Object.keys(groups).length === 0) {
    return BASE_FLIGHT_LINE_COLOR_EXPRESSION;
  }

  const groupIds = [
    ...Object.keys(colorByGroup).filter((groupId) => groups[groupId]),
    ...Object.keys(groups)
      .filter((groupId) => !Object.prototype.hasOwnProperty.call(colorByGroup, groupId))
      .sort((a, b) => a.localeCompare(b)),
  ];
  const assignedFlightIds = new Set<string>();
  const colorEntries: Array<[string, string[]]> = [];

  for (const groupId of groupIds) {
    const ids = normalizeFlightIds(groups[groupId]).filter((flightId) => !assignedFlightIds.has(flightId));
    if (ids.length === 0) continue;
    for (const flightId of ids) assignedFlightIds.add(flightId);
    colorEntries.push([colorByGroup[groupId] ?? FLOW_LINE_DEFAULT_COLOR, ids]);
  }

  return colorEntries.length > 0
    ? buildFlightIdColorCase(colorEntries)
    : BASE_FLIGHT_LINE_COLOR_EXPRESSION;
}

function buildFlightIdColorCase(colorEntries: Array<[string, string[]]>): readonly unknown[] {
  const caseExpr: unknown[] = ["case"];
  for (const [color, ids] of colorEntries) {
    caseExpr.push(
      ["in", ["to-string", ["get", "flightId"]], ["literal", ids]],
      color,
    );
  }
  caseExpr.push(FLOW_LINE_DEFAULT_COLOR);
  return caseExpr;
}
