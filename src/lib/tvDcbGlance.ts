export const TV_DCB_GLANCE_DEFAULT_HORIZON_MINUTES = 180;
export const TV_DCB_GLANCE_HORIZON_OPTIONS = [60, 120, 180, 240] as const;

export interface TvDcbGlanceCurrent {
  count: number;
  capacity: number;
  delta: number;
  time_window: string;
}

export interface TvDcbGlanceTrend {
  kind: "peak" | "trough";
  at_seconds: number;
  time_window: string;
  count: number;
  capacity: number;
  delta: number;
}

export interface TvDcbGlanceClosure {
  at_seconds: number;
  in_seconds: number;
  reason: string;
}

export interface TvDcbGlanceMetadata {
  time_bin_minutes: number;
  ref_time_str: string;
  glance_horizon_minutes: number;
}

export interface TvDcbGlanceSummary {
  current: TvDcbGlanceCurrent | null;
  trends: TvDcbGlanceTrend[];
  closure: TvDcbGlanceClosure | null;
  metadata: TvDcbGlanceMetadata | null;
}

export interface TvDcbGlanceResponse {
  results?: Record<string, TvDcbGlanceSummary | null>;
}

function toRoundedInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function formatSignedInteger(value: unknown): string | null {
  const rounded = toRoundedInteger(value);
  if (rounded === null) return null;
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

export function formatGlanceDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "0m";
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatCurrentLine(current: TvDcbGlanceCurrent | null | undefined): string | null {
  const count = toRoundedInteger(current?.count);
  const capacity = toRoundedInteger(current?.capacity);
  const delta = formatSignedInteger(current?.delta);
  if (count === null || capacity === null || delta === null) return null;
  return `${count}/${capacity} (${delta})`;
}

function formatTrendFragment(
  trend: TvDcbGlanceTrend,
  referenceSeconds: number,
): string | null {
  const count = toRoundedInteger(trend?.count);
  const capacity = toRoundedInteger(trend?.capacity);
  const delta = formatSignedInteger(trend?.delta);
  const atSeconds = Number(trend?.at_seconds);
  if (count === null || capacity === null || delta === null || !Number.isFinite(atSeconds)) {
    return null;
  }
  const direction = trend.kind === "trough" ? "↘" : "↗";
  const offsetSeconds = Math.max(0, atSeconds - referenceSeconds);
  return `${direction} ${count}/${capacity} (${delta}·${formatGlanceDuration(offsetSeconds)})`;
}

function formatClosureLine(
  closure: TvDcbGlanceClosure | null | undefined,
  referenceSeconds: number,
): string | null {
  if (!closure) return null;
  const inSeconds = Number(closure.in_seconds);
  const atSeconds = Number(closure.at_seconds);
  const offsetSeconds = Number.isFinite(inSeconds)
    ? inSeconds
    : Number.isFinite(atSeconds)
      ? Math.max(0, atSeconds - referenceSeconds)
      : Number.NaN;
  if (!Number.isFinite(offsetSeconds)) return null;
  return `✕ ${formatGlanceDuration(offsetSeconds)}`;
}

export function buildTvDcbGlanceLabel(
  tvId: string,
  summary: TvDcbGlanceSummary | null | undefined,
  referenceSeconds: number,
): string {
  const label = String(tvId ?? "").trim();
  if (!label) return "";

  const currentLine = formatCurrentLine(summary?.current);
  if (!currentLine) return label;

  const trendLine = (summary?.trends || [])
    .slice(0, 2)
    .map((trend) => formatTrendFragment(trend, referenceSeconds))
    .filter((fragment): fragment is string => Boolean(fragment))
    .join("  ");
  const closureLine = formatClosureLine(summary?.closure, referenceSeconds);

  return [label, currentLine, trendLine || null, closureLine].filter(Boolean).join("\n");
}

export function getSummaryTimeBinMinutes(
  summary: TvDcbGlanceSummary | null | undefined,
  fallback = 15,
): number {
  const raw = Number(summary?.metadata?.time_bin_minutes);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.round(raw);
}

