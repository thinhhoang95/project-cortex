import * as turf from "@turf/turf";

import { formatSecondsToHHMMSS } from "@/lib/time";

export const SECONDS_PER_DAY = 24 * 60 * 60;
export const COMPLEXITY_METRIC_IDS = [
  "td",
  "hc",
  "sc_groundspeed_proxy",
  "ac_segment",
  "md5_raw",
  "md10_raw",
  "cp25_proxy",
  "cp40_proxy",
  "cp70_proxy",
] as const;
export const COMPLEXITY_INTEREST_WINDOWS = ["2m", "15m", "30m", "45m", "1h", "2h", "4h", "6h"] as const;
export const COMPLEXITY_CONTEXT_BIN_MINUTES = 30;
export const COMPLEXITY_CONTEXT_BIN_SECONDS = COMPLEXITY_CONTEXT_BIN_MINUTES * 60;

export type ComplexityMetricId = (typeof COMPLEXITY_METRIC_IDS)[number];
export type ComplexityInterestWindow = (typeof COMPLEXITY_INTEREST_WINDOWS)[number];

export const COMPLEXITY_METRIC_META: Record<
  ComplexityMetricId,
  { label: string; selectionLabel?: string; color: string }
> = {
  td: { label: "Traffic Density", color: "#38bdf8" },
  hc: { label: "Heading Change", color: "#f59e0b" },
  sc_groundspeed_proxy: { label: "Speed Change", color: "#22c55e" },
  ac_segment: { label: "Altitude Change", color: "#f97316" },
  md5_raw: { label: "Minimum Distance 5", selectionLabel: "MD5", color: "#a78bfa" },
  md10_raw: { label: "Minimum Distance 10", selectionLabel: "MD10", color: "#8b5cf6" },
  cp25_proxy: { label: "CPA 25", color: "#ef4444" },
  cp40_proxy: { label: "CPA 40", color: "#ec4899" },
  cp70_proxy: { label: "CPA 70", color: "#f43f5e" },
};

export type ComplexitySnapshotCounts = {
  sector_id: string;
  sample_end_s: number;
  td: number;
  hc: number;
  sc_groundspeed_proxy: number;
  ac_segment: number;
  md5_raw: number;
  md10_raw: number;
  cp25_proxy: number;
  cp40_proxy: number;
  cp70_proxy: number;
  segment_overlap_count?: number;
};

export type ComplexitySuiteSnapshot = ComplexitySnapshotCounts & {
  sample_end_time: string;
  window_start_s: number;
  window_start_time: string;
  sample_seconds: number;
};

export interface ComplexityTimeRange {
  start: string;
  end: string;
  start_s: number;
  end_s: number;
}

export interface ComplexitySuiteResponse {
  collapsed_sector_id: string;
  date: string;
  time_range: ComplexityTimeRange;
  sample_seconds: number;
  snapshots: ComplexitySuiteSnapshot[];
  metadata?: Record<string, unknown>;
}

export interface ComplexityHotspot {
  collapsed_sector_id: string;
  metric_id: ComplexityMetricId;
  start_bin: number;
  end_bin: number;
  start_label: string;
  end_label: string;
  time_bin: string;
  bin_count: number;
  min_upper_tail_probability?: number | null;
  peak_observed_value?: number | null;
  worst_bin_start_time?: string | null;
  worst_bin_observed_value?: number | null;
  worst_bin_expected_mean?: number | null;
}

export interface ComplexityHotspotsResponse {
  metric_id: ComplexityMetricId;
  threshold: number;
  time_range: ComplexityTimeRange;
  context_bin_minutes?: number | null;
  hotspots: ComplexityHotspot[];
  count: number;
  metadata?: Record<string, unknown>;
}

export interface ComplexityTraceStatePoint {
  time_s?: number | null;
  lon?: number | null;
  lat?: number | null;
  alt_ft?: number | null;
}

export interface ComplexityTdRecord {
  flight_id: string;
  sector_interval_start_s?: number | null;
  sector_interval_end_s?: number | null;
  state_at_sample_end?: ComplexityTraceStatePoint | null;
}

export interface ComplexityHeadingChangeRecord {
  flight_id: string;
  event_time_s?: number | null;
  event_state?: ComplexityTraceStatePoint | null;
  heading_before_deg?: number | null;
  heading_after_deg?: number | null;
  heading_delta_deg?: number | null;
}

export interface ComplexitySpeedChangeRecord {
  flight_id: string;
  event_time_s?: number | null;
  event_state?: ComplexityTraceStatePoint | null;
  speed_before_kts?: number | null;
  speed_after_kts?: number | null;
  speed_delta_kts?: number | null;
}

export interface ComplexityAltitudeChangeRecord {
  flight_id: string;
  segment_start_s?: number | null;
  segment_end_s?: number | null;
  overlap_start_s?: number | null;
  overlap_end_s?: number | null;
  start_state?: ComplexityTraceStatePoint | null;
  end_state?: ComplexityTraceStatePoint | null;
  midpoint_state?: ComplexityTraceStatePoint | null;
  alt_delta_ft?: number | null;
}

export interface ComplexityDistancePairRecord {
  flight_id_a: string;
  flight_id_b: string;
  state_a?: ComplexityTraceStatePoint | null;
  state_b?: ComplexityTraceStatePoint | null;
  lateral_nm?: number | null;
  vertical_ft?: number | null;
  distance_3d_nm?: number | null;
  contributes_flight_ids?: string[] | null;
}

export interface ComplexityCpaPairRecord {
  flight_id_a: string;
  flight_id_b: string;
  state_a?: ComplexityTraceStatePoint | null;
  state_b?: ComplexityTraceStatePoint | null;
  current_lateral_nm?: number | null;
  current_vertical_ft?: number | null;
  t_cpa_s?: number | null;
  cpa_state_a?: ComplexityTraceStatePoint | null;
  cpa_state_b?: ComplexityTraceStatePoint | null;
  cpa_midpoint_state?: ComplexityTraceStatePoint | null;
  cpa_lateral_nm?: number | null;
  cpa_vertical_ft?: number | null;
  contributes_flight_ids?: string[] | null;
}

export type ComplexityTraceRecordMap = {
  td: ComplexityTdRecord;
  hc: ComplexityHeadingChangeRecord;
  sc_groundspeed_proxy: ComplexitySpeedChangeRecord;
  ac_segment: ComplexityAltitudeChangeRecord;
  md5_raw: ComplexityDistancePairRecord;
  md10_raw: ComplexityDistancePairRecord;
  cp25_proxy: ComplexityCpaPairRecord;
  cp40_proxy: ComplexityCpaPairRecord;
  cp70_proxy: ComplexityCpaPairRecord;
};

export interface ComplexityTraceEnvelope<TRecord = unknown> {
  metric_id: ComplexityMetricId;
  count: number;
  count_unit?: string;
  contributing_flight_ids?: string[];
  total_record_count?: number;
  returned_record_count?: number;
  truncated?: boolean;
  records: TRecord[];
}

export type ComplexityTraceEnvelopes = Partial<{
  [K in ComplexityMetricId]: ComplexityTraceEnvelope<ComplexityTraceRecordMap[K]>;
}>;

export interface ComplexityTraceSnapshot {
  sector_id: string;
  sample_end_s: number;
  sample_end_time: string;
  window_start_s: number;
  window_start_time: string;
  sample_seconds: number;
  counts: ComplexitySnapshotCounts;
  traces_by_metric: ComplexityTraceEnvelopes;
  metadata?: Record<string, unknown>;
}

export interface ComplexityTraceResponse {
  collapsed_sector_id: string;
  date: string;
  time_range: ComplexityTimeRange;
  sample_seconds: number;
  requested_metrics?: ComplexityMetricId[];
  max_records_per_metric?: number;
  snapshots: ComplexityTraceSnapshot[];
  metadata?: Record<string, unknown>;
}

export interface ComplexityContextDistribution {
  mode_count?: number | null;
  weights?: number[] | null;
  means?: number[] | null;
  variances?: number[] | null;
  source_date_count?: number | null;
  source_sample_count?: number | null;
  approximation?: string | null;
}

export interface ComplexityContextSpatialDistribution {
  weights?: number[] | null;
  mean_lon?: number[] | null;
  mean_lat?: number[] | null;
  cov_xx?: number[] | null;
  cov_xy?: number[] | null;
  cov_yy?: number[] | null;
  mode_count?: number | null;
  event_count?: number | null;
}

export interface ComplexityContextMetric {
  observed_value?: number | null;
  distribution_available?: boolean | null;
  expected_mean?: number | null;
  upper_tail_probability?: number | null;
  distribution?: ComplexityContextDistribution | null;
  spatial_distribution?: ComplexityContextSpatialDistribution | null;
  spatial_weights?: number[] | null;
  spatial_mean_lon?: number[] | null;
  spatial_mean_lat?: number[] | null;
  spatial_cov_xx?: number[] | null;
  spatial_cov_xy?: number[] | null;
  spatial_cov_yy?: number[] | null;
  spatial_mode_count?: number | null;
  spatial_event_count?: number | null;
}

export interface ComplexityContextSpatialMetric {
  distribution_available?: boolean | null;
  point_count?: number | null;
  event_count?: number | null;
  distribution?: ComplexityContextSpatialDistribution | null;
}

export interface ComplexityContextEntryExitSpatial {
  entry?: ComplexityContextSpatialMetric | null;
  exit?: ComplexityContextSpatialMetric | null;
}

export interface ComplexityContextSlot {
  slot_index: number;
  slot_start_s: number;
  slot_start_time: string;
  slot_end_s: number;
  slot_end_time: string;
  time_bin?: string | null;
  observed_sample_count?: number | null;
  metrics: Partial<Record<ComplexityMetricId, ComplexityContextMetric>>;
  entry_exit_spatial?: ComplexityContextEntryExitSpatial | null;
  event_spatial?: Partial<Record<ComplexityMetricId, ComplexityContextSpatialMetric>> | null;
}

export interface ComplexityContextResponse {
  collapsed_sector_id: string;
  date: string;
  time_range: ComplexityTimeRange;
  requested_metrics?: ComplexityMetricId[];
  context_bin_minutes?: number | null;
  slots: ComplexityContextSlot[];
  metadata?: Record<string, unknown>;
}

export type ComplexityChartRow = {
  sampleEndSeconds: number;
  sampleEndTime: string;
} & Record<ComplexityMetricId, number>;

export interface ComplexityOverlayCollections {
  lines: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  points: GeoJSON.FeatureCollection<GeoJSON.Point>;
  labels: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

export type ComplexityDensityBand = "transparent" | "yellow" | "orange" | "red";

export interface ComplexityDensitySample {
  x: number;
  density: number;
  normalizedDensity: number;
  band: ComplexityDensityBand;
}

export interface ComplexityDensityRulerModel {
  domainMin: number;
  domainMax: number;
  samples: ComplexityDensitySample[];
  distributionAvailable: boolean;
  observedValue: number | null;
  expectedMean: number | null;
  observedRatio: number | null;
  expectedMeanRatio: number | null;
  upperTailProbability: number | null;
}

export type ComplexityContextSpatialSource = ComplexityContextMetric | ComplexityContextSpatialMetric;

function clampSecondsToDay(totalSeconds: number): number {
  const value = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return Math.min(SECONDS_PER_DAY - 1, value);
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeDegrees(value: number | null | undefined): number {
  if (!isFiniteNumber(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function stateCoordinates(state: ComplexityTraceStatePoint | null | undefined): [number, number] | null {
  if (!state) return null;
  const lon = Number(state.lon);
  const lat = Number(state.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function extractAltitudes(points: Array<ComplexityTraceStatePoint | null | undefined>): number[] {
  const altitudes: number[] = [];
  for (const point of points) {
    const altitude = Number(point?.alt_ft);
    if (Number.isFinite(altitude)) {
      altitudes.push(altitude);
    }
  }
  return altitudes;
}

function toFlightLevelLabel(altitudeFeet: number | null | undefined): string | null {
  const altitude = Number(altitudeFeet);
  if (!Number.isFinite(altitude)) return null;
  const flightLevel = Math.max(0, Math.round(altitude / 100));
  return `FL${String(flightLevel).padStart(3, "0")}`;
}

function pointAlongHeading(
  origin: [number, number],
  bearingDegrees: number,
  distanceNm: number,
): [number, number] {
  const destination = turf.destination(
    turf.point(origin),
    Math.max(0, distanceNm) * 1.852,
    normalizeDegrees(bearingDegrees),
    { units: "kilometers" },
  );
  return destination.geometry.coordinates as [number, number];
}

function buildEmptyLineCollection(): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return { type: "FeatureCollection", features: [] };
}

function buildEmptyPointCollection(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: [] };
}

export function createEmptyComplexityOverlayCollections(): ComplexityOverlayCollections {
  return {
    lines: buildEmptyLineCollection(),
    points: buildEmptyPointCollection(),
    labels: buildEmptyPointCollection(),
  };
}

function buildPointFeature(
  coordinates: [number, number],
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
  };
}

function buildLineFeature(
  coordinates: [number, number][],
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties,
  };
}

function getAltitudeSpanForRecord(
  metricId: ComplexityMetricId,
  record: ComplexityTraceRecordMap[ComplexityMetricId],
): [number, number] | null {
  switch (metricId) {
    case "td": {
      const altitudes = extractAltitudes([(record as ComplexityTdRecord).state_at_sample_end]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
    case "hc": {
      const altitudes = extractAltitudes([(record as ComplexityHeadingChangeRecord).event_state]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
    case "sc_groundspeed_proxy": {
      const altitudes = extractAltitudes([(record as ComplexitySpeedChangeRecord).event_state]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
    case "ac_segment": {
      const acRecord = record as ComplexityAltitudeChangeRecord;
      const altitudes = extractAltitudes([acRecord.start_state, acRecord.end_state, acRecord.midpoint_state]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
    case "md5_raw":
    case "md10_raw": {
      const pairRecord = record as ComplexityDistancePairRecord;
      const altitudes = extractAltitudes([pairRecord.state_a, pairRecord.state_b]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
    case "cp25_proxy":
    case "cp40_proxy":
    case "cp70_proxy": {
      const pairRecord = record as ComplexityCpaPairRecord;
      const altitudes = extractAltitudes([
        pairRecord.state_a,
        pairRecord.state_b,
        pairRecord.cpa_state_a,
        pairRecord.cpa_state_b,
        pairRecord.cpa_midpoint_state,
      ]);
      if (altitudes.length === 0) return null;
      return [Math.min(...altitudes), Math.max(...altitudes)];
    }
  }
}

function doesAltitudeSpanIntersectFlightLevelRange(
  span: [number, number] | null,
  flLowerBound: number,
  flUpperBound: number,
): boolean {
  if (!span) return true;
  const lowerFeet = Math.min(flLowerBound, flUpperBound) * 100;
  const upperFeet = Math.max(flLowerBound, flUpperBound) * 100;
  return span[1] >= lowerFeet && span[0] <= upperFeet;
}

function midpointCoordinates(left: [number, number], right: [number, number]): [number, number] {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function pointOrMidpoint(
  left: ComplexityTraceStatePoint | null | undefined,
  right: ComplexityTraceStatePoint | null | undefined,
): [number, number] | null {
  const leftCoordinates = stateCoordinates(left);
  const rightCoordinates = stateCoordinates(right);
  if (leftCoordinates && rightCoordinates) {
    return midpointCoordinates(leftCoordinates, rightCoordinates);
  }
  return leftCoordinates ?? rightCoordinates;
}

function formatDirectionalArrow(nextValue: number | null | undefined, previousValue: number | null | undefined): string {
  const next = Number(nextValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(next) || !Number.isFinite(previous)) {
    return "→";
  }
  if (next > previous) return "↗";
  if (next < previous) return "↘";
  return "→";
}

function formatRoundedTransition(
  previousValue: number | null | undefined,
  nextValue: number | null | undefined,
  suffix = "",
): string | null {
  const previous = Number(previousValue);
  const next = Number(nextValue);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    return null;
  }
  const roundedPrevious = Math.round(previous);
  const roundedNext = Math.round(next);
  return `${roundedPrevious}→${roundedNext}${suffix}`;
}

function formatFlightLevelTransition(
  startState: ComplexityTraceStatePoint | null | undefined,
  endState: ComplexityTraceStatePoint | null | undefined,
): string | null {
  const from = toFlightLevelLabel(Number(startState?.alt_ft));
  const to = toFlightLevelLabel(Number(endState?.alt_ft));
  if (!from || !to) return null;
  return `${from}→${to}`;
}

function getRepresentativeAltitudeLabelForPair(
  left: ComplexityTraceStatePoint | null | undefined,
  right: ComplexityTraceStatePoint | null | undefined,
): string | null {
  const altitudes = extractAltitudes([left, right]);
  if (altitudes.length === 0) return null;
  const averageAltitude = altitudes.reduce((sum, value) => sum + value, 0) / altitudes.length;
  return toFlightLevelLabel(averageAltitude);
}

function pushHeadingChangeFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexityHeadingChangeRecord,
): void {
  const anchor = stateCoordinates(record.event_state);
  if (!anchor) return;
  const inboundHeading = normalizeDegrees((Number(record.heading_before_deg) || 0) + 180);
  const outboundHeading = normalizeDegrees(Number(record.heading_after_deg) || 0);
  const inboundStart = pointAlongHeading(anchor, inboundHeading, 0.85);
  const outboundEnd = pointAlongHeading(anchor, outboundHeading, 0.85);

  collections.lines.features.push(
    buildLineFeature([inboundStart, anchor], { color, lineWidth: 2 }),
    buildLineFeature([anchor, outboundEnd], { color, lineWidth: 2.25 }),
  );
  collections.points.features.push(buildPointFeature(anchor, { color, pointRadius: 4.5 }));
  collections.labels.features.push(
    buildPointFeature(outboundEnd, {
      color,
      labelText: "➜",
      labelRotate: outboundHeading,
      labelSize: 15,
    }),
  );
  const deltaDegrees = Math.round(Number(record.heading_delta_deg) || 0);
  collections.labels.features.push(
    buildPointFeature(anchor, {
      color,
      labelText: deltaDegrees > 0 ? `Δ${deltaDegrees}°` : "Δ0°",
      labelOffsetY: -1.4,
    }),
  );
}

function pushSpeedChangeFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexitySpeedChangeRecord,
): void {
  const point = stateCoordinates(record.event_state);
  if (!point) return;
  collections.points.features.push(buildPointFeature(point, { color, pointRadius: 4.5 }));
  const transition = formatRoundedTransition(record.speed_before_kts, record.speed_after_kts, "");
  if (!transition) return;
  collections.labels.features.push(
    buildPointFeature(point, {
      color,
      labelText: `${formatDirectionalArrow(record.speed_after_kts, record.speed_before_kts)} ${transition}`,
      labelOffsetY: -1.2,
    }),
  );
}

function pushAltitudeChangeFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexityAltitudeChangeRecord,
): void {
  const point =
    stateCoordinates(record.midpoint_state) ??
    stateCoordinates(record.start_state) ??
    stateCoordinates(record.end_state);
  if (!point) return;
  collections.points.features.push(buildPointFeature(point, { color, pointRadius: 4.5 }));
  const transition = formatFlightLevelTransition(record.start_state, record.end_state);
  if (!transition) return;
  collections.labels.features.push(
    buildPointFeature(point, {
      color,
      labelText: `${formatDirectionalArrow(record.end_state?.alt_ft, record.start_state?.alt_ft)} ${transition}`,
      labelOffsetY: -1.2,
    }),
  );
}

function pushDistancePairFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexityDistancePairRecord,
): void {
  const point = pointOrMidpoint(record.state_a, record.state_b);
  if (!point) return;
  collections.points.features.push(buildPointFeature(point, { color, pointRadius: 4.5 }));
  const altitudeLabel = getRepresentativeAltitudeLabelForPair(record.state_a, record.state_b);
  if (!altitudeLabel) return;
  collections.labels.features.push(
    buildPointFeature(point, {
      color,
      labelText: altitudeLabel,
      labelOffsetY: -1.2,
    }),
  );
}

function pushCpaPairFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexityCpaPairRecord,
): void {
  const point =
    stateCoordinates(record.cpa_midpoint_state) ??
    pointOrMidpoint(record.cpa_state_a, record.cpa_state_b) ??
    pointOrMidpoint(record.state_a, record.state_b);
  if (!point) return;
  collections.points.features.push(buildPointFeature(point, { color, pointRadius: 4.5 }));
  const altitudeLabel =
    toFlightLevelLabel(Number(record.cpa_midpoint_state?.alt_ft)) ??
    getRepresentativeAltitudeLabelForPair(record.cpa_state_a, record.cpa_state_b) ??
    getRepresentativeAltitudeLabelForPair(record.state_a, record.state_b);
  if (!altitudeLabel) return;
  collections.labels.features.push(
    buildPointFeature(point, {
      color,
      labelText: altitudeLabel,
      labelOffsetY: -1.2,
    }),
  );
}

function pushTdFeatures(
  collections: ComplexityOverlayCollections,
  color: string,
  record: ComplexityTdRecord,
): void {
  const point = stateCoordinates(record.state_at_sample_end);
  if (!point) return;
  collections.points.features.push(buildPointFeature(point, { color, pointRadius: 3.8 }));
  const altitudeLabel = toFlightLevelLabel(Number(record.state_at_sample_end?.alt_ft));
  if (!altitudeLabel) return;
  collections.labels.features.push(
    buildPointFeature(point, {
      color,
      labelText: altitudeLabel,
      labelOffsetY: -1.1,
    }),
  );
}

export function getInterestWindowSeconds(windowLength: string): number {
  const value = String(windowLength ?? "").trim().toLowerCase();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3600;
  }
  return value.includes("h") ? parsed * 3600 : parsed * 60;
}

export function buildForwardTimeRange(startSeconds: number, windowLength: string): string {
  const safeStart = clampSecondsToDay(startSeconds);
  const safeEnd = clampSecondsToDay(safeStart + getInterestWindowSeconds(windowLength));
  return `${formatSecondsToHHMMSS(safeStart)}-${formatSecondsToHHMMSS(safeEnd)}`;
}

export function getComplexityContextSlotStartSeconds(referenceSeconds: number): number {
  const safeReference = clampSecondsToDay(referenceSeconds);
  return Math.floor(safeReference / COMPLEXITY_CONTEXT_BIN_SECONDS) * COMPLEXITY_CONTEXT_BIN_SECONDS;
}

export function buildCollapsedSectorDdContextTimeRange(referenceSeconds: number): string {
  const slotStart = getComplexityContextSlotStartSeconds(referenceSeconds);
  const slotEnd = clampSecondsToDay(slotStart + COMPLEXITY_CONTEXT_BIN_SECONDS);
  return `${formatSecondsToHHMMSS(slotStart)}-${formatSecondsToHHMMSS(slotEnd)}`;
}

export function buildCollapsedSectorDdSuitePath(params: {
  collapsedSectorId: string;
  timeRange: string;
  sampleSeconds?: number | null;
}): string {
  const query = new URLSearchParams({
    collapsed_sector_id: String(params.collapsedSectorId ?? "").trim(),
    time_range: String(params.timeRange ?? "").trim(),
  });
  const sampleSeconds = normalizePositiveInteger(params.sampleSeconds);
  if (sampleSeconds !== null) {
    query.set("sample_seconds", String(sampleSeconds));
  }
  return `/api/collapsed_sector_dd_suite?${query.toString()}`;
}

export function buildCollapsedSectorDdHotspotsPath(params: {
  metricId: ComplexityMetricId;
  timeRange?: string | null;
  threshold?: number | null;
}): string {
  const query = new URLSearchParams({
    metric_id: String(params.metricId ?? "").trim(),
  });
  const timeRange = String(params.timeRange ?? "").trim();
  if (timeRange) {
    query.set("time_range", timeRange);
  }
  const threshold = Number(params.threshold);
  if (Number.isFinite(threshold)) {
    query.set("threshold", String(threshold));
  }
  return `/api/collapsed_sector_dd_hotspots?${query.toString()}`;
}

export function buildCollapsedSectorDdContextPath(params: {
  collapsedSectorId: string;
  timeRange: string;
  metrics?: ComplexityMetricId[];
}): string {
  const query = new URLSearchParams({
    collapsed_sector_id: String(params.collapsedSectorId ?? "").trim(),
    time_range: String(params.timeRange ?? "").trim(),
  });
  const metrics = Array.from(
    new Set((params.metrics ?? []).map((metric) => String(metric).trim()).filter(Boolean)),
  );
  if (metrics.length > 0) {
    query.set("metrics", metrics.join(","));
  }
  return `/api/collapsed_sector_dd_context?${query.toString()}`;
}

export function buildCollapsedSectorDdTracePath(params: {
  collapsedSectorId: string;
  timeRange: string;
  metrics?: ComplexityMetricId[];
  sampleSeconds?: number | null;
  maxRecordsPerMetric?: number | null;
}): string {
  const query = new URLSearchParams({
    collapsed_sector_id: String(params.collapsedSectorId ?? "").trim(),
    time_range: String(params.timeRange ?? "").trim(),
  });
  const metrics = Array.from(
    new Set((params.metrics ?? []).map((metric) => String(metric).trim()).filter(Boolean)),
  );
  if (metrics.length > 0) {
    query.set("metrics", metrics.join(","));
  }
  const sampleSeconds = normalizePositiveInteger(params.sampleSeconds);
  if (sampleSeconds !== null) {
    query.set("sample_seconds", String(sampleSeconds));
  }
  const maxRecordsPerMetric = normalizeNonNegativeInteger(params.maxRecordsPerMetric);
  if (maxRecordsPerMetric !== null) {
    query.set("max_records_per_metric", String(maxRecordsPerMetric));
  }
  return `/api/collapsed_sector_dd_trace?${query.toString()}`;
}

export function getMetricCount(
  snapshot: ComplexitySnapshotCounts | ComplexitySuiteSnapshot | null | undefined,
  metricId: ComplexityMetricId,
): number {
  if (!snapshot) return 0;
  return Number(snapshot[metricId] ?? 0);
}

export function sumMetricCounts(
  snapshots: Array<ComplexitySnapshotCounts | ComplexitySuiteSnapshot> | null | undefined,
  metricId: ComplexityMetricId,
): number {
  let total = 0;
  for (const snapshot of snapshots ?? []) {
    total += getMetricCount(snapshot, metricId);
  }
  return total;
}

export function getClosestSnapshot<T extends { sample_end_s: number }>(
  snapshots: T[] | null | undefined,
  referenceSeconds: number,
): T | null {
  if (!snapshots || snapshots.length === 0) return null;
  let closest = snapshots[0];
  let smallestDistance = Math.abs(Number(closest.sample_end_s) - referenceSeconds);
  for (let index = 1; index < snapshots.length; index += 1) {
    const candidate = snapshots[index];
    const candidateDistance = Math.abs(Number(candidate.sample_end_s) - referenceSeconds);
    if (candidateDistance < smallestDistance) {
      closest = candidate;
      smallestDistance = candidateDistance;
    }
  }
  return closest;
}

export function getTraceEnvelope<K extends ComplexityMetricId>(
  snapshot: ComplexityTraceSnapshot | null | undefined,
  metricId: K,
): ComplexityTraceEnvelope<ComplexityTraceRecordMap[K]> | null {
  if (!snapshot) return null;
  return (snapshot.traces_by_metric?.[metricId] as ComplexityTraceEnvelope<ComplexityTraceRecordMap[K]> | null) ?? null;
}

export function mergeTraceEnvelopes<K extends ComplexityMetricId>(
  snapshots: ComplexityTraceSnapshot[] | null | undefined,
  metricId: K,
): ComplexityTraceEnvelope<ComplexityTraceRecordMap[K]> | null {
  if (!snapshots || snapshots.length === 0) return null;

  const records: ComplexityTraceRecordMap[K][] = [];
  const contributingFlightIds = new Set<string>();
  let sawEnvelope = false;
  let count = 0;
  let countUnit: string | undefined;
  let totalRecordCount = 0;
  let sawTotalRecordCount = false;
  let truncated = false;

  for (const snapshot of snapshots) {
    const envelope = getTraceEnvelope(snapshot, metricId);
    if (!envelope) continue;

    sawEnvelope = true;
    count += Number.isFinite(Number(envelope.count)) ? Number(envelope.count) : 0;
    if (!countUnit && typeof envelope.count_unit === "string" && envelope.count_unit.trim()) {
      countUnit = envelope.count_unit;
    }
    if (Array.isArray(envelope.records) && envelope.records.length > 0) {
      records.push(...(envelope.records as ComplexityTraceRecordMap[K][]));
    }
    if (Array.isArray(envelope.contributing_flight_ids)) {
      for (const flightId of envelope.contributing_flight_ids) {
        if (typeof flightId === "string" && flightId.trim()) {
          contributingFlightIds.add(flightId);
        }
      }
    }
    if (Number.isFinite(Number(envelope.total_record_count))) {
      totalRecordCount += Number(envelope.total_record_count);
      sawTotalRecordCount = true;
    }
    truncated = truncated || Boolean(envelope.truncated);
  }

  if (!sawEnvelope) return null;

  return {
    metric_id: metricId,
    count,
    count_unit: countUnit,
    contributing_flight_ids: contributingFlightIds.size > 0 ? Array.from(contributingFlightIds) : undefined,
    total_record_count: sawTotalRecordCount ? totalRecordCount : undefined,
    returned_record_count: records.length,
    truncated,
    records,
  };
}

export function getComplexityMetricSelectionLabel(metricId: ComplexityMetricId): string {
  return COMPLEXITY_METRIC_META[metricId].selectionLabel ?? COMPLEXITY_METRIC_META[metricId].label;
}

export function buildComplexityChartRows(
  snapshots: ComplexitySuiteSnapshot[] | null | undefined,
): ComplexityChartRow[] {
  return (snapshots ?? []).map((snapshot) => ({
    sampleEndSeconds: Number(snapshot.sample_end_s) || 0,
    sampleEndTime: String(snapshot.sample_end_time ?? formatSecondsToHHMMSS(snapshot.sample_end_s)),
    td: getMetricCount(snapshot, "td"),
    hc: getMetricCount(snapshot, "hc"),
    sc_groundspeed_proxy: getMetricCount(snapshot, "sc_groundspeed_proxy"),
    ac_segment: getMetricCount(snapshot, "ac_segment"),
    md5_raw: getMetricCount(snapshot, "md5_raw"),
    md10_raw: getMetricCount(snapshot, "md10_raw"),
    cp25_proxy: getMetricCount(snapshot, "cp25_proxy"),
    cp40_proxy: getMetricCount(snapshot, "cp40_proxy"),
    cp70_proxy: getMetricCount(snapshot, "cp70_proxy"),
  }));
}

export function buildComplexityOverlayCollections(params: {
  metricId: ComplexityMetricId;
  envelope: ComplexityTraceEnvelope<ComplexityTraceRecordMap[ComplexityMetricId]> | null | undefined;
  flLowerBound: number;
  flUpperBound: number;
}): ComplexityOverlayCollections {
  const { metricId, envelope, flLowerBound, flUpperBound } = params;
  if (!envelope || !Array.isArray(envelope.records) || envelope.records.length === 0) {
    return createEmptyComplexityOverlayCollections();
  }

  const collections = createEmptyComplexityOverlayCollections();
  const color = COMPLEXITY_METRIC_META[metricId].color;
  for (const rawRecord of envelope.records) {
    const record = rawRecord as ComplexityTraceRecordMap[ComplexityMetricId];
    const altitudeSpan = getAltitudeSpanForRecord(metricId, record);
    if (!doesAltitudeSpanIntersectFlightLevelRange(altitudeSpan, flLowerBound, flUpperBound)) {
      continue;
    }

    switch (metricId) {
      case "td":
        pushTdFeatures(collections, color, record as ComplexityTdRecord);
        break;
      case "hc":
        pushHeadingChangeFeatures(collections, color, record as ComplexityHeadingChangeRecord);
        break;
      case "sc_groundspeed_proxy":
        pushSpeedChangeFeatures(collections, color, record as ComplexitySpeedChangeRecord);
        break;
      case "ac_segment":
        pushAltitudeChangeFeatures(collections, color, record as ComplexityAltitudeChangeRecord);
        break;
      case "md5_raw":
      case "md10_raw":
        pushDistancePairFeatures(collections, color, record as ComplexityDistancePairRecord);
        break;
      case "cp25_proxy":
      case "cp40_proxy":
      case "cp70_proxy":
        pushCpaPairFeatures(collections, color, record as ComplexityCpaPairRecord);
        break;
    }
  }

  return collections;
}

export function getComplexityContextSlot(
  slots: ComplexityContextSlot[] | null | undefined,
  referenceSeconds: number,
): ComplexityContextSlot | null {
  if (!slots || slots.length === 0) return null;
  const safeReference = clampSecondsToDay(referenceSeconds);
  const containingSlot =
    slots.find(
      (slot) =>
        Number(slot?.slot_start_s) <= safeReference && safeReference < Number(slot?.slot_end_s),
    ) ?? null;
  if (containingSlot) return containingSlot;

  const targetStart = getComplexityContextSlotStartSeconds(referenceSeconds);
  let closest = slots[0];
  let smallestDistance = Math.abs(Number(closest?.slot_start_s) - targetStart);
  for (let index = 1; index < slots.length; index += 1) {
    const candidate = slots[index];
    const candidateDistance = Math.abs(Number(candidate?.slot_start_s) - targetStart);
    if (candidateDistance < smallestDistance) {
      closest = candidate;
      smallestDistance = candidateDistance;
    }
  }
  return closest;
}

export function getComplexityMetricSpatialContext(
  slot: ComplexityContextSlot | null | undefined,
  metricId: ComplexityMetricId,
): ComplexityContextSpatialSource | null {
  if (!slot || metricId === "td") return null;
  return slot.event_spatial?.[metricId] ?? slot.metrics?.[metricId] ?? null;
}

function mapDensityBand(normalizedDensity: number): ComplexityDensityBand {
  if (!Number.isFinite(normalizedDensity) || normalizedDensity < 0.25) return "transparent";
  if (normalizedDensity < 0.5) return "yellow";
  if (normalizedDensity < 0.8) return "orange";
  return "red";
}

function gaussianDensity(value: number, mean: number, variance: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(variance) || variance <= 0) {
    return 0;
  }
  const sigma = Math.sqrt(variance);
  const coefficient = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const exponent = -((value - mean) ** 2) / (2 * variance);
  return coefficient * Math.exp(exponent);
}

function safeDistributionModeCount(distribution: ComplexityContextDistribution | null | undefined): number {
  if (!distribution) return 0;
  const lengths = [
    normalizeNumberArray(distribution.weights).length,
    normalizeNumberArray(distribution.means).length,
    normalizeNumberArray(distribution.variances).length,
  ];
  return Math.max(0, ...lengths);
}

function getDistributionArrays(
  distribution: ComplexityContextDistribution | null | undefined,
): { weights: number[]; means: number[]; variances: number[]; modeCount: number } {
  const weights = normalizeNumberArray(distribution?.weights);
  const means = normalizeNumberArray(distribution?.means);
  const variances = normalizeNumberArray(distribution?.variances).map((value) => Math.max(value, 1e-6));
  const declaredModeCount =
    normalizePositiveInteger(Number(distribution?.mode_count ?? 0)) ?? safeDistributionModeCount(distribution);
  const modeCount = Math.min(declaredModeCount, weights.length, means.length, variances.length);

  if (!Number.isFinite(modeCount) || modeCount <= 0) {
    return { weights: [], means: [], variances: [], modeCount: 0 };
  }

  return {
    weights: weights.slice(0, modeCount),
    means: means.slice(0, modeCount),
    variances: variances.slice(0, modeCount),
    modeCount,
  };
}

export function buildComplexityContextDensityRulerModel(
  metricContext: ComplexityContextMetric | null | undefined,
  sampleCount = 120,
): ComplexityDensityRulerModel | null {
  const observedValue = normalizeNumber(metricContext?.observed_value);
  const expectedMean = normalizeNumber(metricContext?.expected_mean);
  const upperTailProbability = normalizeNumber(metricContext?.upper_tail_probability);
  const distributionAvailable = Boolean(metricContext?.distribution_available);
  const distribution = metricContext?.distribution ?? null;
  const { weights, means, variances, modeCount } = getDistributionArrays(distribution);

  if (modeCount <= 0) {
    const fallbackValues = [observedValue, expectedMean].filter((value): value is number => value !== null);
    if (fallbackValues.length === 0) return null;
    const fallbackMin = Math.min(...fallbackValues);
    const fallbackMax = Math.max(...fallbackValues);
    const padding = Math.max(1, (fallbackMax - fallbackMin || 1) * 0.12);
    const domainMin = fallbackMin - padding;
    const domainMax = fallbackMax + padding;
    const span = Math.max(1e-6, domainMax - domainMin);
    return {
      domainMin,
      domainMax,
      samples: [],
      distributionAvailable: false,
      observedValue,
      expectedMean,
      observedRatio: observedValue === null ? null : clampRatio((observedValue - domainMin) / span),
      expectedMeanRatio: expectedMean === null ? null : clampRatio((expectedMean - domainMin) / span),
      upperTailProbability,
    };
  }

  const domainCandidates: number[] = [];
  for (let index = 0; index < modeCount; index += 1) {
    const sigma = Math.sqrt(Math.max(variances[index], 1e-6));
    domainCandidates.push(means[index] - sigma * 3, means[index] + sigma * 3);
  }
  if (observedValue !== null) domainCandidates.push(observedValue);
  if (expectedMean !== null) domainCandidates.push(expectedMean);
  const rawMin = Math.min(...domainCandidates);
  const rawMax = Math.max(...domainCandidates);
  const padding = Math.max(1, (rawMax - rawMin || 1) * 0.06);
  const domainMin = rawMin - padding;
  const domainMax = rawMax + padding;
  const span = Math.max(1e-6, domainMax - domainMin);
  const safeSampleCount = Math.max(32, Math.floor(Number.isFinite(sampleCount) ? sampleCount : 120));

  const densities: number[] = [];
  for (let index = 0; index < safeSampleCount; index += 1) {
    const ratio = safeSampleCount <= 1 ? 0 : index / (safeSampleCount - 1);
    const x = domainMin + span * ratio;
    let density = 0;
    for (let modeIndex = 0; modeIndex < modeCount; modeIndex += 1) {
      density += weights[modeIndex] * gaussianDensity(x, means[modeIndex], variances[modeIndex]);
    }
    densities.push(density);
  }

  const maxDensity = Math.max(...densities, 0);
  const samples: ComplexityDensitySample[] = densities.map((density, index) => {
    const ratio = safeSampleCount <= 1 ? 0 : index / (safeSampleCount - 1);
    const x = domainMin + span * ratio;
    const normalizedDensity = maxDensity > 0 ? density / maxDensity : 0;
    return {
      x,
      density,
      normalizedDensity,
      band: mapDensityBand(normalizedDensity),
    };
  });

  return {
    domainMin,
    domainMax,
    samples,
    distributionAvailable,
    observedValue,
    expectedMean,
    observedRatio: observedValue === null ? null : clampRatio((observedValue - domainMin) / span),
    expectedMeanRatio: expectedMean === null ? null : clampRatio((expectedMean - domainMin) / span),
    upperTailProbability,
  };
}

type ComplexitySpatialMode = {
  weight: number;
  meanLon: number;
  meanLat: number;
  covXx: number;
  covXy: number;
  covYy: number;
};

function isLegacyMetricSpatialContext(
  spatialContext: ComplexityContextSpatialSource | null | undefined,
): spatialContext is ComplexityContextMetric {
  if (!spatialContext || typeof spatialContext !== "object") return false;
  return (
    "spatial_distribution" in spatialContext ||
    "spatial_weights" in spatialContext ||
    "spatial_mean_lon" in spatialContext ||
    "spatial_mean_lat" in spatialContext ||
    "spatial_cov_xx" in spatialContext ||
    "spatial_cov_xy" in spatialContext ||
    "spatial_cov_yy" in spatialContext
  );
}

function getComplexitySpatialModes(
  spatialContext: ComplexityContextSpatialSource | null | undefined,
): ComplexitySpatialMode[] {
  if (!spatialContext) return [];
  if (
    !isLegacyMetricSpatialContext(spatialContext) &&
    spatialContext.distribution_available === false
  ) {
    return [];
  }

  const spatialDistribution = isLegacyMetricSpatialContext(spatialContext)
    ? spatialContext.spatial_distribution ?? null
    : spatialContext.distribution ?? null;
  const weights = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_weights ?? spatialDistribution?.weights
      : spatialDistribution?.weights,
  );
  const meanLon = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_mean_lon ?? spatialDistribution?.mean_lon
      : spatialDistribution?.mean_lon,
  );
  const meanLat = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_mean_lat ?? spatialDistribution?.mean_lat
      : spatialDistribution?.mean_lat,
  );
  const covXx = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_cov_xx ?? spatialDistribution?.cov_xx
      : spatialDistribution?.cov_xx,
  );
  const covXy = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_cov_xy ?? spatialDistribution?.cov_xy
      : spatialDistribution?.cov_xy,
  );
  const covYy = normalizeNumberArray(
    isLegacyMetricSpatialContext(spatialContext)
      ? spatialContext.spatial_cov_yy ?? spatialDistribution?.cov_yy
      : spatialDistribution?.cov_yy,
  );
  const declaredModeCount =
    normalizePositiveInteger(
      Number(
        isLegacyMetricSpatialContext(spatialContext)
          ? spatialContext.spatial_mode_count ?? spatialDistribution?.mode_count ?? 0
          : spatialDistribution?.mode_count ?? 0,
      ),
    ) ??
    Math.max(weights.length, meanLon.length, meanLat.length, covXx.length, covXy.length, covYy.length);
  const modeCount = Math.min(
    declaredModeCount,
    weights.length,
    meanLon.length,
    meanLat.length,
    covXx.length,
    covXy.length,
    covYy.length,
  );

  if (!Number.isFinite(modeCount) || modeCount <= 0) return [];

  const modes: ComplexitySpatialMode[] = [];
  for (let index = 0; index < modeCount; index += 1) {
    const weight = weights[index];
    const nextMode = {
      weight,
      meanLon: meanLon[index],
      meanLat: meanLat[index],
      covXx: covXx[index],
      covXy: covXy[index],
      covYy: covYy[index],
    };
    if (
      !Number.isFinite(nextMode.weight) ||
      !Number.isFinite(nextMode.meanLon) ||
      !Number.isFinite(nextMode.meanLat) ||
      !Number.isFinite(nextMode.covXx) ||
      !Number.isFinite(nextMode.covXy) ||
      !Number.isFinite(nextMode.covYy)
    ) {
      continue;
    }
    modes.push(nextMode);
  }

  return modes;
}

export function hasComplexityContextSpatialData(
  metricId: ComplexityMetricId,
  spatialContext: ComplexityContextSpatialSource | null | undefined,
): boolean {
  if (metricId === "td") return false;
  return getComplexitySpatialModes(spatialContext).length > 0;
}

function getEllipseAxesFromCovariance(
  covXx: number,
  covXy: number,
  covYy: number,
): { majorAxis: number; minorAxis: number; angleRad: number } | null {
  const trace = covXx + covYy;
  const determinant = covXx * covYy - covXy * covXy;
  const discriminant = Math.sqrt(Math.max(0, trace * trace * 0.25 - determinant));
  const lambda1 = Math.max(0, trace * 0.5 + discriminant);
  const lambda2 = Math.max(0, trace * 0.5 - discriminant);
  if (lambda1 <= 0 && lambda2 <= 0) return null;
  return {
    majorAxis: Math.sqrt(Math.max(lambda1, 1e-10)),
    minorAxis: Math.sqrt(Math.max(lambda2, 1e-10)),
    angleRad: 0.5 * Math.atan2(2 * covXy, covXx - covYy),
  };
}

function buildGaussianEllipseRing(
  mode: ComplexitySpatialMode,
  relativeDensityLevel: number,
  vertexCount = 72,
): [number, number][] | null {
  const axes = getEllipseAxesFromCovariance(mode.covXx, mode.covXy, mode.covYy);
  if (!axes) return null;

  const safeLevel = Math.max(1e-6, Math.min(0.999999, relativeDensityLevel));
  const contourRadius = Math.sqrt(-2 * Math.log(safeLevel));
  const major = axes.majorAxis * contourRadius;
  const minor = axes.minorAxis * contourRadius;
  const ring: [number, number][] = [];

  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (Math.PI * 2 * index) / vertexCount;
    const localX = major * Math.cos(theta);
    const localY = minor * Math.sin(theta);
    const rotatedX = localX * Math.cos(axes.angleRad) - localY * Math.sin(axes.angleRad);
    const rotatedY = localX * Math.sin(axes.angleRad) + localY * Math.cos(axes.angleRad);
    ring.push([mode.meanLon + rotatedX, mode.meanLat + rotatedY]);
  }

  if (ring.length === 0) return null;
  ring.push(ring[0]);
  return ring;
}

function toPolygonOrMultiPolygonFeature(
  feature: GeoJSON.Feature | null | undefined,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  const geometry = feature?.geometry;
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
    return null;
  }
  return {
    type: "Feature",
    geometry: geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    properties: { ...(feature?.properties ?? {}) },
  };
}

function emptyComplexitySpatialOverlayCollection(): GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon
> {
  return { type: "FeatureCollection", features: [] };
}

const COMPLEXITY_SPATIAL_BANDS: Array<{
  relativeDensityLevel: number;
  color: string;
  opacityBase: number;
  rank: number;
}> = [
  { relativeDensityLevel: 0.25, color: "#facc15", opacityBase: 0.12, rank: 1 },
  { relativeDensityLevel: 0.5, color: "#f97316", opacityBase: 0.18, rank: 2 },
  { relativeDensityLevel: 0.8, color: "#ef4444", opacityBase: 0.24, rank: 3 },
];

export function buildComplexityContextSpatialOverlayFeatures(params: {
  metricId: ComplexityMetricId;
  spatialContext: ComplexityContextSpatialSource | null | undefined;
  sectorFeature: GeoJSON.Feature | null | undefined;
}): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  const { metricId, spatialContext, sectorFeature } = params;
  const sectorPolygon = toPolygonOrMultiPolygonFeature(sectorFeature);
  if (metricId === "td" || !sectorPolygon) {
    return emptyComplexitySpatialOverlayCollection();
  }

  const modes = getComplexitySpatialModes(spatialContext);
  if (modes.length === 0) {
    return emptyComplexitySpatialOverlayCollection();
  }

  const maxWeight = Math.max(...modes.map((mode) => Math.max(0, mode.weight)), 0);
  const features: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];

  for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
    const mode = modes[modeIndex];
    const normalizedWeight = maxWeight > 0 ? clampRatio(mode.weight / maxWeight) : 0.5;
    for (const band of COMPLEXITY_SPATIAL_BANDS) {
      const ring = buildGaussianEllipseRing(mode, band.relativeDensityLevel);
      if (!ring) continue;

      const ellipseFeature = turf.polygon([ring]);
      const clipped = turf.intersect(
        turf.featureCollection([sectorPolygon, ellipseFeature]),
        {
          properties: {
            fillColor: band.color,
            fillOpacity: Number((band.opacityBase + normalizedWeight * 0.22).toFixed(4)),
            lineColor: band.color,
            lineOpacity: Number((0.14 + normalizedWeight * 0.2).toFixed(4)),
            bandRank: band.rank,
            relativeDensityLevel: band.relativeDensityLevel,
            modeIndex,
            modeWeight: mode.weight,
            metricId,
          },
        },
      ) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;

      if (!clipped) continue;
      features.push(clipped);
    }
  }

  features.sort((left, right) => {
    const leftRank = Number(left.properties?.bandRank ?? 0);
    const rightRank = Number(right.properties?.bandRank ?? 0);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Number(left.properties?.modeIndex ?? 0) - Number(right.properties?.modeIndex ?? 0);
  });

  return { type: "FeatureCollection", features };
}
