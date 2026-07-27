import { TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import { resolveHotspotColor } from "@/lib/hotspotColoring";

const MINUTES_PER_DAY = 24 * 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = MINUTES_PER_DAY * SECONDS_PER_MINUTE;

export type HotspotLike = {
  traffic_volume_id: string | number | null | undefined;
  time_bin: string | null | undefined;
  hourly_occupancy?: number | null;
  hourly_capacity?: number | null;
  is_overloaded?: boolean | null;
  z_max?: number | null;
  z_sum?: number | null;
};

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([0-9]{1,2}):([0-9]{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (hours < 0 || hours > 24) return null;
  if (hours === 24 && minutes !== 0) return null;
  const total = hours * 60 + minutes;
  return Math.max(0, Math.min(MINUTES_PER_DAY, total));
}

function expandTimeBin(timeBin: string | null | undefined): Array<{ start: number; end: number }> {
  const raw = String(timeBin || "");
  const dash = raw.indexOf("-");
  if (dash <= 0) return [];
  const start = parseHHMM(raw.slice(0, dash));
  const end = parseHHMM(raw.slice(dash + 1));
  if (start === null || end === null) return [];
  if (end === start) return [];
  if (end > start) {
    return [{ start, end }];
  }
  // Wraps past midnight; split into two segments
  return [
    { start, end: MINUTES_PER_DAY },
    { start: 0, end },
  ];
}

function normalizeSecondOfDay(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const total = Math.floor(value);
  if (total >= 0 && total < SECONDS_PER_DAY) {
    return total;
  }
  const mod = total % SECONDS_PER_DAY;
  return (mod + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

function isSegmentActive(seconds: number, segment: { start: number; end: number }): boolean {
  const startSeconds = segment.start * SECONDS_PER_MINUTE;
  const endSeconds = segment.end * SECONDS_PER_MINUTE;
  return seconds >= startSeconds && seconds < endSeconds;
}

function isHotspotActiveAt(
  timeBin: string | null | undefined,
  currentSeconds: number | null,
): boolean {
  if (currentSeconds === null) return false;
  const segments = expandTimeBin(timeBin);
  if (segments.length === 0) return false;
  return segments.some((segment) => isSegmentActive(currentSeconds, segment));
}

function clampSegment(segment: { start: number; end: number }, rangeStart: number, rangeEnd: number): { start: number; end: number } | null {
  const start = Math.max(rangeStart, segment.start);
  const end = Math.min(rangeEnd, segment.end);
  if (end <= start) return null;
  return { start, end };
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return "00:00";
  if (minutes >= MINUTES_PER_DAY) return "24:00";
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(minutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatMinutesEnd(minutes: number): string {
  if (!Number.isFinite(minutes)) return "00:00";
  if (minutes >= MINUTES_PER_DAY) return "24:00";
  return formatMinutes(minutes);
}

function resolveRange(viewFromMin: number, viewToMin: number): { start: number; end: number } {
  const start = Number.isFinite(viewFromMin)
    ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(viewFromMin)))
    : 0;
  const rawEnd = Number.isFinite(viewToMin)
    ? Math.floor(viewToMin) + 1
    : MINUTES_PER_DAY;
  const end = Math.max(start + 1, Math.min(MINUTES_PER_DAY, rawEnd));
  return { start, end };
}

export function computeHotspotSegments(
  hotspots: HotspotLike[] | null | undefined,
  viewFromMin: number,
  viewToMin: number,
): Map<string, TrafficOverloadDatum[]> {
  const map = new Map<string, TrafficOverloadDatum[]>();
  if (!Array.isArray(hotspots) || hotspots.length === 0) {
    return map;
  }

  const { start: rangeStart, end: rangeEnd } = resolveRange(viewFromMin, viewToMin);

  hotspots.forEach((hotspot) => {
    const tvId = String(hotspot?.traffic_volume_id ?? "").trim();
    if (!tvId) return;

    const segments = expandTimeBin(hotspot?.time_bin);
    if (segments.length === 0) return;

    const occupancy = Number(hotspot?.hourly_occupancy ?? Number.NaN);
    const capacity = Number(hotspot?.hourly_capacity ?? Number.NaN);
    const hasOccupancy = Number.isFinite(occupancy);
    const hasCapacity = Number.isFinite(capacity);
    const color = resolveHotspotColor(hotspot) ?? "#34d399";

    const baseMetadata: string[] = [];
    if (hasOccupancy) {
      baseMetadata.push(`Occupancy: ${occupancy.toFixed(0)}`);
    }
    if (hasCapacity) {
      baseMetadata.push(`Capacity: ${capacity.toFixed(0)}`);
      if (hasOccupancy) {
        baseMetadata.push(`Excess: ${(occupancy - capacity).toFixed(0)}`);
      }
    }
    if (Number.isFinite(hotspot?.z_max)) {
      baseMetadata.push(`Peak load: ${Number(hotspot?.z_max).toFixed(2)}`);
    }
    if (Number.isFinite(hotspot?.z_sum)) {
      baseMetadata.push(`Load sum: ${Number(hotspot?.z_sum).toFixed(2)}`);
    }

    segments.forEach((segment) => {
      const clamped = clampSegment(segment, rangeStart, rangeEnd);
      if (!clamped) return;
      const datum: TrafficOverloadDatum = {
        period: `${formatMinutes(clamped.start)}-${formatMinutesEnd(clamped.end)}`,
        color,
        metadata: baseMetadata,
        label: `${tvId} hotspot`,
      };
      if (map.has(tvId)) {
        map.get(tvId)!.push(datum);
      } else {
        map.set(tvId, [datum]);
      }
    });
  });

  return map;
}

export function selectActiveHotspots(
  hotspots: HotspotLike[] | null | undefined,
  showHotspots: boolean | null | undefined,
  currentSeconds: number | null | undefined,
): HotspotLike[] {
  if (!showHotspots) return [];
  if (!Array.isArray(hotspots) || hotspots.length === 0) return [];
  const normalizedSeconds = normalizeSecondOfDay(Number(currentSeconds));
  if (normalizedSeconds === null) return [];
  return hotspots.filter((hotspot) => isHotspotActiveAt(hotspot?.time_bin, normalizedSeconds));
}
