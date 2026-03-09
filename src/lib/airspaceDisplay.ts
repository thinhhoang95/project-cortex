import type { FilterSpecification } from "maplibre-gl";

const MINUTES_PER_DAY = 24 * 60;
const HOURS_PER_DAY = 24;

type OpenTimeRange = {
  startMinute: number;
  endMinute: number;
};

type CapacitySlotRange = OpenTimeRange & {
  durationMinutes: number;
  value: unknown;
};

export type NormalizedCollapsedSectors = {
  collection: GeoJSON.FeatureCollection;
  maxOpenRangeCount: number;
};

export type AirspaceDisplayFilterParams = {
  mode: "tv" | "es";
  flLowerBound: number;
  flUpperBound: number;
  currentTrafficVolumeBin: string;
  currentMinuteOfDay: number;
  csOpenRangeCount: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseHhMmToMinute(value: string | undefined, options: { allow24Hour?: boolean } = {}): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes === 0 && options.allow24Hour) {
    return MINUTES_PER_DAY;
  }
  if (hours < 0 || hours > 23) return null;
  return hours * 60 + minutes;
}

function parseTimeRange(value: string | undefined): OpenTimeRange | null {
  if (!value) return null;
  const [startRaw, endRaw] = value.trim().split("-");
  const startMinute = parseHhMmToMinute(startRaw);
  const endMinute = parseHhMmToMinute(endRaw, { allow24Hour: true });
  if (startMinute == null || endMinute == null) return null;
  return { startMinute, endMinute };
}

function getRangeDurationMinutes(startMinute: number, endMinute: number): number {
  if (endMinute >= startMinute) return endMinute - startMinute;
  return MINUTES_PER_DAY - startMinute + endMinute;
}

function parseCapacitySlotRange(slot: string, value: unknown): CapacitySlotRange | null {
  const range = parseTimeRange(slot);
  if (!range) return null;
  const durationMinutes = getRangeDurationMinutes(range.startMinute, range.endMinute);
  return {
    ...range,
    durationMinutes: durationMinutes > 0 ? durationMinutes : MINUTES_PER_DAY,
    value,
  };
}

function getHourBinLabel(hourIndex: number): string {
  const startHour = ((hourIndex % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  const endHour = startHour + 1;
  return `${pad2(startHour)}:00-${pad2(endHour)}:00`;
}

export function getCapacityKeyForHourBin(bin: string): string {
  if (bin.startsWith("capacity_")) return bin;
  const [start, end] = bin.split("-");
  return `capacity_${start.replace(":", "")}_${end.replace(":", "")}`;
}

function getOverlappingHourBins(startMinute: number, endMinute: number): string[] {
  const ranges: OpenTimeRange[] = endMinute >= startMinute
    ? [{ startMinute, endMinute }]
    : [
        { startMinute, endMinute: MINUTES_PER_DAY },
        { startMinute: 0, endMinute },
      ];
  const labels = new Set<string>();
  for (let hourIndex = 0; hourIndex < HOURS_PER_DAY; hourIndex += 1) {
    const binStart = hourIndex * 60;
    const binEnd = binStart + 60;
    const overlaps = ranges.some(
      (range) => range.startMinute < binEnd && range.endMinute > binStart,
    );
    if (overlaps) {
      labels.add(getHourBinLabel(hourIndex));
    }
  }
  return Array.from(labels);
}

export function expandCapacityToHourlyProperties(
  capacity: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!capacity || typeof capacity !== "object") return {};

  const parsedSlots = Object.entries(capacity)
    .map(([slot, value]) => parseCapacitySlotRange(slot, value))
    .filter((entry): entry is CapacitySlotRange => entry !== null)
    .sort((a, b) => b.durationMinutes - a.durationMinutes);

  const expanded: Record<string, unknown> = {};
  for (const entry of parsedSlots) {
    const hourBins = getOverlappingHourBins(entry.startMinute, entry.endMinute);
    for (const hourBin of hourBins) {
      expanded[getCapacityKeyForHourBin(hourBin)] = entry.value;
    }
  }
  return expanded;
}

export function normalizeTrafficVolumeFeatureProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const capacity =
    props.capacity && typeof props.capacity === "object"
      ? (props.capacity as Record<string, unknown>)
      : null;

  return {
    ...expandCapacityToHourlyProperties(capacity),
    ...props,
  };
}

/**
 * Helper to get "HH:00-HH+1:00" bin from seconds t
 */
export function getHourBin(t: number): string {
  const h = Math.floor(t / 3600) % HOURS_PER_DAY;
  const nextH = h + 1;
  return `${pad2(h)}:00-${pad2(nextH)}:00`;
}

export function getMinuteOfDay(seconds: number): number {
  const secondsInDay = 24 * 3600;
  const wholeSeconds = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  const normalized = ((wholeSeconds % secondsInDay) + secondsInDay) % secondsInDay;
  return Math.floor(normalized / 60);
}

export function getTrafficVolumeFlIntersectionFilter(
  flLowerBound: number,
  flUpperBound: number,
): FilterSpecification {
  const minFl = ["to-number", ["coalesce", ["get", "min_fl"], 0], 0];
  const maxFl = ["to-number", ["coalesce", ["get", "max_fl"], 9999], 9999];
  return [
    "all",
    [">=", maxFl, flLowerBound],
    ["<=", minFl, flUpperBound],
  ] as unknown as FilterSpecification;
}

/**
 * Returns a MapLibre filter expression for traffic volumes based on:
 * 1. Flight Level (FL) range intersection
 * 2. Capacity availability for the current time bin (capacity not equal to 999/9999)
 */
export function getTrafficVolumeFilter(
  flLowerBound: number,
  flUpperBound: number,
  tOrHourBin: number | string,
): FilterSpecification {
  const hourBin = typeof tOrHourBin === "string" ? tOrHourBin : getHourBin(tOrHourBin);
  const capRaw = [
    "coalesce",
    ["get", getCapacityKeyForHourBin(hourBin)],
    ["get", hourBin, ["get", "capacity"]],
  ];

  const cap = [
    "case",
    ["==", capRaw, null],
    9999,
    ["to-number", capRaw, 9999],
  ];

  const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
  return ["all", flFilter, ["<", cap, 999]] as unknown as FilterSpecification;
}

export function normalizeCollapsedSectors(
  collection: GeoJSON.FeatureCollection,
): NormalizedCollapsedSectors {
  const rawFeatures = (collection.features || []).filter((feature) => feature?.geometry != null);
  const parsedRangesByFeature = rawFeatures.map((feature) => {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    return parseOpenTimeRanges(properties.open_times);
  });
  const maxOpenRangeCount = parsedRangesByFeature.reduce((max, ranges) => Math.max(max, ranges.length), 0);

  const features = rawFeatures.map((feature, index) => {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const collapsedSectorId = String(properties.collapsed_sector ?? "").trim();
    const id = collapsedSectorId || `CS_${String(index + 1).padStart(4, "0")}`;
    const openRanges = parsedRangesByFeature[index] || [];
    const openRangeProps: Record<string, number> = {
      open_range_count: openRanges.length,
    };
    for (let i = 0; i < maxOpenRangeCount; i += 1) {
      const range = openRanges[i];
      openRangeProps[`open_start_min_${i}`] = range ? range.startMinute : -1;
      openRangeProps[`open_end_min_${i}`] = range ? range.endMinute : -1;
    }
    return {
      ...feature,
      properties: {
        ...properties,
        traffic_volume_id: id,
        label: properties.label != null ? String(properties.label) : id,
        ...openRangeProps,
      },
    };
  });

  return {
    collection: { ...collection, features },
    maxOpenRangeCount,
  };
}

export function parseOpenTimeRanges(value: unknown): OpenTimeRange[] {
  if (!Array.isArray(value)) return [];
  const ranges: OpenTimeRange[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const range = parseTimeRange(raw);
    if (!range) continue;
    ranges.push(range);
  }
  return ranges;
}

export function buildCollapsedSectorOpenNowFilter(
  currentMinuteOfDay: number,
  maxOpenRangeCount: number,
): FilterSpecification {
  if (maxOpenRangeCount <= 0) {
    return ["==", 1, 1] as FilterSpecification;
  }
  const current = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(currentMinuteOfDay)));
  const conditions: FilterSpecification[] = [];
  for (let i = 0; i < maxOpenRangeCount; i += 1) {
    const startExpr = ["to-number", ["get", `open_start_min_${i}`], -1];
    const endExpr = ["to-number", ["get", `open_end_min_${i}`], -1];
    const inNonWrapRange: FilterSpecification = [
      "all",
      ["<=", startExpr, endExpr],
      [">=", current, startExpr],
      ["<=", current, endExpr],
    ] as unknown as FilterSpecification;
    const inWrapRange: FilterSpecification = [
      "all",
      [">", startExpr, endExpr],
      ["any", [">=", current, startExpr], ["<=", current, endExpr]],
    ] as unknown as FilterSpecification;
    conditions.push([
      "all",
      [">=", startExpr, 0],
      [">=", endExpr, 0],
      ["any", inNonWrapRange, inWrapRange],
    ] as unknown as FilterSpecification);
  }
  return ["any", ...conditions] as FilterSpecification;
}

export function getAirspaceDisplayFilter({
  mode,
  flLowerBound,
  flUpperBound,
  currentTrafficVolumeBin,
  currentMinuteOfDay,
  csOpenRangeCount,
}: AirspaceDisplayFilterParams): FilterSpecification {
  if (mode === "tv") {
    return getTrafficVolumeFilter(flLowerBound, flUpperBound, currentTrafficVolumeBin);
  }

  const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
  const openNowFilter = buildCollapsedSectorOpenNowFilter(currentMinuteOfDay, csOpenRangeCount);
  return ["all", flFilter, openNowFilter] as FilterSpecification;
}
