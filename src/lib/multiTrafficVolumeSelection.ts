export type ToggleTrafficVolumeSelectionResult = {
  selectedTrafficVolumes: string[];
  changed: boolean;
  reason?: "max_limit";
};

export type TrafficVolumeSelectionMode = "and" | "or";

export type TrafficVolumeSelectionClause = string[];

export type ToggleTrafficVolumeClauseSelectionResult =
  ToggleTrafficVolumeSelectionResult & {
    selectedTrafficVolumeClauses: TrafficVolumeSelectionClause[];
    primaryTrafficVolumeId: string | null;
  };

function normalizeTrafficVolumeId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function buildSingletonTrafficVolumeClauses(
  selection: readonly string[],
): TrafficVolumeSelectionClause[] {
  return normalizeTrafficVolumeClauses(selection.map((trafficVolumeId) => [trafficVolumeId]));
}

export function normalizeTrafficVolumeClauses(
  clauses: readonly (readonly string[])[],
): TrafficVolumeSelectionClause[] {
  const out: TrafficVolumeSelectionClause[] = [];
  const seen = new Set<string>();

  for (const clause of clauses || []) {
    const nextClause: string[] = [];
    for (const rawId of clause || []) {
      const tvId = normalizeTrafficVolumeId(rawId);
      if (!tvId || seen.has(tvId)) continue;
      seen.add(tvId);
      nextClause.push(tvId);
    }
    if (nextClause.length > 0) {
      out.push(nextClause);
    }
  }

  return out;
}

export function flattenTrafficVolumeClauses(
  clauses: readonly (readonly string[])[],
): string[] {
  return normalizeTrafficVolumeClauses(clauses).flatMap((clause) => clause);
}

export function getPrimaryTrafficVolumeId(
  clauses: readonly (readonly string[])[],
): string | null {
  return normalizeTrafficVolumeClauses(clauses)[0]?.[0] ?? null;
}

export function getEffectiveTrafficVolumeSelectionClauses(params: {
  selectedTrafficVolumeClauses?: readonly (readonly string[])[] | null;
  selectedTrafficVolumes?: readonly string[] | null;
  selectedTrafficVolume?: string | null;
}): TrafficVolumeSelectionClause[] {
  const { selectedTrafficVolumeClauses, selectedTrafficVolumes, selectedTrafficVolume } = params;
  const normalizedClauses = normalizeTrafficVolumeClauses(selectedTrafficVolumeClauses || []);
  if (normalizedClauses.length > 0) {
    return normalizedClauses;
  }

  const flatSelection =
    Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
      ? selectedTrafficVolumes
      : selectedTrafficVolume
        ? [selectedTrafficVolume]
        : [];

  return buildSingletonTrafficVolumeClauses(flatSelection);
}

export function getEffectiveTrafficVolumeSelectionIds(params: {
  selectedTrafficVolumeClauses?: readonly (readonly string[])[] | null;
  selectedTrafficVolumes?: readonly string[] | null;
  selectedTrafficVolume?: string | null;
}): string[] {
  return flattenTrafficVolumeClauses(getEffectiveTrafficVolumeSelectionClauses(params));
}

export function formatTrafficVolumeSelectionExpression(
  clauses: readonly (readonly string[])[],
): string {
  return normalizeTrafficVolumeClauses(clauses)
    .map((clause) => {
      if (clause.length === 1) return clause[0];
      return `(${clause.join(" OR ")})`;
    })
    .join(" AND ");
}

export function toggleTrafficVolumeSelectionClauses(
  currentClauses: readonly (readonly string[])[],
  trafficVolumeId: string,
  mode: TrafficVolumeSelectionMode,
  maxSelected = 5,
): ToggleTrafficVolumeClauseSelectionResult {
  const tvId = normalizeTrafficVolumeId(trafficVolumeId);
  const normalizedClauses = normalizeTrafficVolumeClauses(currentClauses);
  if (!tvId) {
    return {
      selectedTrafficVolumeClauses: normalizedClauses,
      selectedTrafficVolumes: flattenTrafficVolumeClauses(normalizedClauses),
      primaryTrafficVolumeId: getPrimaryTrafficVolumeId(normalizedClauses),
      changed: false,
    };
  }

  const nextClauses = normalizedClauses.map((clause) => [...clause]);
  for (let clauseIndex = 0; clauseIndex < nextClauses.length; clauseIndex += 1) {
    const memberIndex = nextClauses[clauseIndex].indexOf(tvId);
    if (memberIndex < 0) continue;

    nextClauses[clauseIndex] = nextClauses[clauseIndex].filter((id) => id !== tvId);
    const collapsedClauses = nextClauses.filter((clause) => clause.length > 0);
    return {
      selectedTrafficVolumeClauses: collapsedClauses,
      selectedTrafficVolumes: flattenTrafficVolumeClauses(collapsedClauses),
      primaryTrafficVolumeId: getPrimaryTrafficVolumeId(collapsedClauses),
      changed: true,
    };
  }

  const selectedCount = flattenTrafficVolumeClauses(normalizedClauses).length;
  if (selectedCount >= Math.max(1, maxSelected)) {
    return {
      selectedTrafficVolumeClauses: normalizedClauses,
      selectedTrafficVolumes: flattenTrafficVolumeClauses(normalizedClauses),
      primaryTrafficVolumeId: getPrimaryTrafficVolumeId(normalizedClauses),
      changed: false,
      reason: "max_limit",
    };
  }

  // Keep the first clause anchored to the primary/reference TV. OR groups begin
  // after an AND boundary so downstream primary-TV flows keep stable semantics.
  if (mode === "or" && nextClauses.length > 1) {
    nextClauses[nextClauses.length - 1] = [...nextClauses[nextClauses.length - 1], tvId];
  } else {
    nextClauses.push([tvId]);
  }

  return {
    selectedTrafficVolumeClauses: nextClauses,
    selectedTrafficVolumes: flattenTrafficVolumeClauses(nextClauses),
    primaryTrafficVolumeId: getPrimaryTrafficVolumeId(nextClauses),
    changed: true,
  };
}

export function appendTrafficVolumeSelectionClauses(
  currentClauses: readonly (readonly string[])[],
  trafficVolumeId: string,
  mode: TrafficVolumeSelectionMode,
  maxSelected = 5,
): ToggleTrafficVolumeClauseSelectionResult {
  const tvId = normalizeTrafficVolumeId(trafficVolumeId);
  const normalizedClauses = normalizeTrafficVolumeClauses(currentClauses);
  if (!tvId) {
    return {
      selectedTrafficVolumeClauses: normalizedClauses,
      selectedTrafficVolumes: flattenTrafficVolumeClauses(normalizedClauses),
      primaryTrafficVolumeId: getPrimaryTrafficVolumeId(normalizedClauses),
      changed: false,
    };
  }

  if (flattenTrafficVolumeClauses(normalizedClauses).includes(tvId)) {
    return {
      selectedTrafficVolumeClauses: normalizedClauses,
      selectedTrafficVolumes: flattenTrafficVolumeClauses(normalizedClauses),
      primaryTrafficVolumeId: getPrimaryTrafficVolumeId(normalizedClauses),
      changed: false,
    };
  }

  return toggleTrafficVolumeSelectionClauses(normalizedClauses, tvId, mode, maxSelected);
}

export function appendOrderedTrafficVolumes(
  currentSelection: readonly string[],
  trafficVolumeId: string,
  maxSelected = 5,
): ToggleTrafficVolumeSelectionResult {
  const result = appendTrafficVolumeSelectionClauses(
    buildSingletonTrafficVolumeClauses(currentSelection),
    trafficVolumeId,
    "and",
    maxSelected,
  );
  return {
    selectedTrafficVolumes: result.selectedTrafficVolumes,
    changed: result.changed,
    reason: result.reason,
  };
}

export function toggleOrderedTrafficVolumes(
  currentSelection: readonly string[],
  trafficVolumeId: string,
  maxSelected = 5,
): ToggleTrafficVolumeSelectionResult {
  const result = toggleTrafficVolumeSelectionClauses(
    buildSingletonTrafficVolumeClauses(currentSelection),
    trafficVolumeId,
    "and",
    maxSelected,
  );
  return {
    selectedTrafficVolumes: result.selectedTrafficVolumes,
    changed: result.changed,
    reason: result.reason,
  };
}

