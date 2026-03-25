export type ToggleTrafficVolumeSelectionResult = {
  selectedTrafficVolumes: string[];
  changed: boolean;
  reason?: "max_limit";
};

export function appendOrderedTrafficVolumes(
  currentSelection: readonly string[],
  trafficVolumeId: string,
  maxSelected = 5,
): ToggleTrafficVolumeSelectionResult {
  const tvId = String(trafficVolumeId ?? "").trim();
  if (!tvId) {
    return { selectedTrafficVolumes: Array.from(currentSelection), changed: false };
  }

  const current = Array.from(currentSelection).map(String);
  if (current.includes(tvId)) {
    return {
      selectedTrafficVolumes: current,
      changed: false,
    };
  }

  if (current.length >= Math.max(1, maxSelected)) {
    return {
      selectedTrafficVolumes: current,
      changed: false,
      reason: "max_limit",
    };
  }

  return {
    selectedTrafficVolumes: [...current, tvId],
    changed: true,
  };
}

export function toggleOrderedTrafficVolumes(
  currentSelection: readonly string[],
  trafficVolumeId: string,
  maxSelected = 5,
): ToggleTrafficVolumeSelectionResult {
  const tvId = String(trafficVolumeId ?? "").trim();
  if (!tvId) {
    return { selectedTrafficVolumes: Array.from(currentSelection), changed: false };
  }

  const current = Array.from(currentSelection).map(String);
  const existingIndex = current.indexOf(tvId);
  if (existingIndex >= 0) {
    const next = current.filter((id) => id !== tvId);
    return { selectedTrafficVolumes: next, changed: true };
  }

  if (current.length >= Math.max(1, maxSelected)) {
    return {
      selectedTrafficVolumes: current,
      changed: false,
      reason: "max_limit",
    };
  }

  return {
    selectedTrafficVolumes: [...current, tvId],
    changed: true,
  };
}

