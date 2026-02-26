import type { Trajectory } from "@/lib/models";

export type RerouteCatcherTimeframe = "15m" | "30m" | "45m" | "1h" | "2h" | "3h" | "4h" | "all";

export interface RerouteCatcherMatch {
  flightId: string;
  crossingTimeSeconds: number;
  deltaForwardSeconds: number;
  catcherSegmentIndex: number;
  flightSegmentIndex: number;
}

export interface RerouteCatcherResult {
  flightIds: string[];
  matches: RerouteCatcherMatch[];
}

type Point2D = [number, number];

const DAY_SECONDS = 24 * 3600;
const EPS = 1e-9;

export function captureFlightsByRerouteCatcher(params: {
  trajectories: Trajectory[];
  catcherPolyline: Point2D[];
  timeframe: RerouteCatcherTimeframe;
  currentTimeSeconds: number;
}): RerouteCatcherResult {
  const { trajectories, catcherPolyline, timeframe, currentTimeSeconds } = params;
  const currentSec = normalizeSecondsOfDay(currentTimeSeconds);
  const windowSeconds = timeframeToSeconds(timeframe);

  if (!Array.isArray(trajectories) || trajectories.length === 0) {
    return { flightIds: [], matches: [] };
  }

  if (!Array.isArray(catcherPolyline) || catcherPolyline.length < 2) {
    return { flightIds: [], matches: [] };
  }

  const catcherSegments = buildSegments(catcherPolyline);
  if (catcherSegments.length === 0) {
    return { flightIds: [], matches: [] };
  }

  const matchesByFlight = new Map<string, RerouteCatcherMatch>();

  for (const trajectory of trajectories) {
    const flightId = String(trajectory?.flightId ?? "").trim();
    if (!flightId) continue;

    const coords = trajectory.coords || [];
    const times = trajectory.times || [];
    const segmentCount = Math.min(coords.length, times.length) - 1;
    if (segmentCount <= 0) continue;

    let best: RerouteCatcherMatch | null = null;

    for (let flightSegIdx = 0; flightSegIdx < segmentCount; flightSegIdx += 1) {
      const p0 = coords[flightSegIdx];
      const p1 = coords[flightSegIdx + 1];
      if (!isValidCoord(p0) || !isValidCoord(p1)) continue;

      const flightStart = Number(times[flightSegIdx]);
      const flightEndRaw = Number(times[flightSegIdx + 1]);
      if (!Number.isFinite(flightStart) || !Number.isFinite(flightEndRaw)) continue;

      let flightEnd = flightEndRaw;
      if (flightEnd < flightStart) {
        flightEnd += DAY_SECONDS;
      }

      for (let catcherSegIdx = 0; catcherSegIdx < catcherSegments.length; catcherSegIdx += 1) {
        const catcherSeg = catcherSegments[catcherSegIdx];

        if (!bboxIntersects(catcherSeg.a, catcherSeg.b, [p0[0], p0[1]], [p1[0], p1[1]])) {
          continue;
        }

        const intersection = intersectProperSegments(
          catcherSeg.a,
          catcherSeg.b,
          [p0[0], p0[1]],
          [p1[0], p1[1]]
        );

        if (!intersection) continue;

        const crossingTimeRaw = flightStart + intersection.flightParam * (flightEnd - flightStart);
        const crossingTimeSeconds = normalizeSecondsOfDay(crossingTimeRaw);
        const deltaForwardSeconds = forwardDeltaSeconds(currentSec, crossingTimeSeconds);

        if (windowSeconds !== null && deltaForwardSeconds > windowSeconds + EPS) {
          continue;
        }

        const candidate: RerouteCatcherMatch = {
          flightId,
          crossingTimeSeconds,
          deltaForwardSeconds,
          catcherSegmentIndex: catcherSegIdx,
          flightSegmentIndex: flightSegIdx,
        };

        if (
          !best ||
          candidate.deltaForwardSeconds < best.deltaForwardSeconds - EPS ||
          (Math.abs(candidate.deltaForwardSeconds - best.deltaForwardSeconds) <= EPS &&
            candidate.crossingTimeSeconds < best.crossingTimeSeconds - EPS) ||
          (Math.abs(candidate.deltaForwardSeconds - best.deltaForwardSeconds) <= EPS &&
            Math.abs(candidate.crossingTimeSeconds - best.crossingTimeSeconds) <= EPS &&
            candidate.catcherSegmentIndex < best.catcherSegmentIndex)
        ) {
          best = candidate;
        }
      }
    }

    if (best) {
      matchesByFlight.set(flightId, best);
    }
  }

  const matches = Array.from(matchesByFlight.values()).sort((a, b) => {
    if (Math.abs(a.deltaForwardSeconds - b.deltaForwardSeconds) > EPS) {
      return a.deltaForwardSeconds - b.deltaForwardSeconds;
    }
    if (Math.abs(a.crossingTimeSeconds - b.crossingTimeSeconds) > EPS) {
      return a.crossingTimeSeconds - b.crossingTimeSeconds;
    }
    return a.flightId.localeCompare(b.flightId);
  });

  return {
    flightIds: matches.map((m) => m.flightId),
    matches,
  };
}

function timeframeToSeconds(timeframe: RerouteCatcherTimeframe): number | null {
  switch (timeframe) {
    case "15m":
      return 15 * 60;
    case "30m":
      return 30 * 60;
    case "45m":
      return 45 * 60;
    case "1h":
      return 60 * 60;
    case "2h":
      return 2 * 60 * 60;
    case "3h":
      return 3 * 60 * 60;
    case "4h":
      return 4 * 60 * 60;
    case "all":
      return null;
    default:
      return null;
  }
}

function buildSegments(polyline: Point2D[]): Array<{ a: Point2D; b: Point2D }> {
  const out: Array<{ a: Point2D; b: Point2D }> = [];
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (!isValidPoint(a) || !isValidPoint(b)) continue;
    if (distanceSquared(a, b) <= EPS) continue;
    out.push({ a, b });
  }
  return out;
}

function intersectProperSegments(
  catcherA: Point2D,
  catcherB: Point2D,
  flightA: Point2D,
  flightB: Point2D
): { catcherParam: number; flightParam: number } | null {
  const r: Point2D = [catcherB[0] - catcherA[0], catcherB[1] - catcherA[1]];
  const s: Point2D = [flightB[0] - flightA[0], flightB[1] - flightA[1]];

  const denom = cross2D(r, s);
  if (Math.abs(denom) <= EPS) {
    return null;
  }

  // Directional constraint: draw order defines positive capture direction.
  if (denom <= EPS) {
    return null;
  }

  const qMinusP: Point2D = [flightA[0] - catcherA[0], flightA[1] - catcherA[1]];
  const t = cross2D(qMinusP, s) / denom;
  const u = cross2D(qMinusP, r) / denom;

  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) {
    return null;
  }

  return { catcherParam: t, flightParam: u };
}

function normalizeSecondsOfDay(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const whole = Math.floor(value);
  return ((whole % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

function forwardDeltaSeconds(fromSec: number, toSec: number): number {
  return (toSec - fromSec + DAY_SECONDS) % DAY_SECONDS;
}

function bboxIntersects(a0: Point2D, a1: Point2D, b0: Point2D, b1: Point2D): boolean {
  const minAx = Math.min(a0[0], a1[0]);
  const maxAx = Math.max(a0[0], a1[0]);
  const minAy = Math.min(a0[1], a1[1]);
  const maxAy = Math.max(a0[1], a1[1]);

  const minBx = Math.min(b0[0], b1[0]);
  const maxBx = Math.max(b0[0], b1[0]);
  const minBy = Math.min(b0[1], b1[1]);
  const maxBy = Math.max(b0[1], b1[1]);

  return !(
    maxAx < minBx - EPS ||
    maxBx < minAx - EPS ||
    maxAy < minBy - EPS ||
    maxBy < minAy - EPS
  );
}

function cross2D(a: Point2D, b: Point2D): number {
  return a[0] * b[1] - a[1] * b[0];
}

function isValidCoord(coord: [number, number, number?] | undefined): coord is [number, number, number?] {
  return Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]);
}

function isValidPoint(point: Point2D | undefined): point is Point2D {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function distanceSquared(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}
