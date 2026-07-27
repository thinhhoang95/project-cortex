export type HotspotThresholdUnit = "percentage" | "absolute";
export type HotspotSeverity = "orange" | "red" | "violet";

export type HotspotThresholdSet = {
  unit: HotspotThresholdUnit;
  orange: number;
  red: number;
  violet: number;
};

export type TrafficVolumeHotspotThreshold = HotspotThresholdSet & {
  trafficVolumeId: string;
};

export type HotspotColoringSettings = {
  global: HotspotThresholdSet;
  overrides: TrafficVolumeHotspotThreshold[];
};

export type HotspotMeasurement = {
  traffic_volume_id?: string | number | null;
  hourly_occupancy?: number | null;
  hourly_capacity?: number | null;
  hotspot_color?: string | null;
  hotspot_severity?: HotspotSeverity | null;
};

export const HOTSPOT_COLORS: Record<HotspotSeverity, string> = {
  orange: "#fb923c",
  red: "#ef4444",
  violet: "#8b5cf6",
};

export const DEFAULT_HOTSPOT_COLORING_SETTINGS: HotspotColoringSettings = {
  global: {
    unit: "percentage",
    orange: 100,
    red: 120,
    violet: 140,
  },
  overrides: [],
};

export function isValidThresholdOrder(
  thresholds: Pick<HotspotThresholdSet, "orange" | "red" | "violet">,
): boolean {
  return (
    Number.isFinite(thresholds.orange) &&
    Number.isFinite(thresholds.red) &&
    Number.isFinite(thresholds.violet) &&
    thresholds.orange >= 0 &&
    thresholds.red > thresholds.orange &&
    thresholds.violet > thresholds.red
  );
}

export function normalizeThresholdSet(
  value: Partial<HotspotThresholdSet> | null | undefined,
  fallback: HotspotThresholdSet = DEFAULT_HOTSPOT_COLORING_SETTINGS.global,
): HotspotThresholdSet {
  const unit: HotspotThresholdUnit =
    value?.unit === "absolute" || value?.unit === "percentage"
      ? value.unit
      : fallback.unit;
  const candidate = {
    unit,
    orange: Number(value?.orange),
    red: Number(value?.red),
    violet: Number(value?.violet),
  };
  return isValidThresholdOrder(candidate) ? candidate : { ...fallback, unit };
}

export function normalizeHotspotColoringSettings(
  value: Partial<HotspotColoringSettings> | null | undefined,
): HotspotColoringSettings {
  const global = normalizeThresholdSet(value?.global);
  const overrides = Array.isArray(value?.overrides)
    ? value.overrides
        .map((override) => {
          const trafficVolumeId = String(override?.trafficVolumeId ?? "").trim();
          if (!trafficVolumeId || !isValidThresholdOrder(override)) return null;
          return {
            trafficVolumeId,
            ...normalizeThresholdSet(override, global),
          };
        })
        .filter((override): override is TrafficVolumeHotspotThreshold => override !== null)
    : [];

  return {
    global,
    overrides: Array.from(
      new Map(overrides.map((override) => [override.trafficVolumeId.toLowerCase(), override])).values(),
    ),
  };
}

export function getThresholdsForTrafficVolume(
  trafficVolumeId: string | number | null | undefined,
  settings: HotspotColoringSettings,
): HotspotThresholdSet {
  const normalizedId = String(trafficVolumeId ?? "").trim().toLowerCase();
  const override = settings.overrides.find(
    (item) => item.trafficVolumeId.toLowerCase() === normalizedId,
  );
  return override ?? settings.global;
}

export function getHotspotThresholdValue(
  hotspot: HotspotMeasurement,
  thresholds: HotspotThresholdSet,
): number | null {
  const occupancy = Number(hotspot.hourly_occupancy);
  if (!Number.isFinite(occupancy)) return null;
  if (thresholds.unit === "absolute") return occupancy;

  const capacity = Number(hotspot.hourly_capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  return (occupancy / capacity) * 100;
}

export function resolveHotspotSeverity(
  hotspot: HotspotMeasurement,
  settings: HotspotColoringSettings = DEFAULT_HOTSPOT_COLORING_SETTINGS,
): HotspotSeverity | null {
  const thresholds = getThresholdsForTrafficVolume(hotspot.traffic_volume_id, settings);
  const value = getHotspotThresholdValue(hotspot, thresholds);
  if (value === null || value < thresholds.orange) return null;
  if (value >= thresholds.violet) return "violet";
  if (value >= thresholds.red) return "red";
  return "orange";
}

export function resolveHotspotColor(
  hotspot: HotspotMeasurement,
  settings: HotspotColoringSettings = DEFAULT_HOTSPOT_COLORING_SETTINGS,
): string | null {
  if (hotspot.hotspot_color && hotspot.hotspot_severity) {
    return hotspot.hotspot_color;
  }
  const severity = resolveHotspotSeverity(hotspot, settings);
  return severity ? HOTSPOT_COLORS[severity] : null;
}

export function applyHotspotColoring<T extends HotspotMeasurement>(
  hotspots: T[] | null | undefined,
  settings: HotspotColoringSettings,
): Array<T & { hotspot_color: string; hotspot_severity: HotspotSeverity }> {
  if (!Array.isArray(hotspots)) return [];
  return hotspots.flatMap((hotspot) => {
    const severity = resolveHotspotSeverity(hotspot, settings);
    if (!severity) return [];
    return [{
      ...hotspot,
      hotspot_severity: severity,
      hotspot_color: HOTSPOT_COLORS[severity],
    }];
  });
}
