import type { Trajectory } from "./models";

export interface FlightLineVisibilitySnapshot {
  activeInsideRangeIds: Set<string>;
  listDrivenEligibleIds: Set<string>;
}

const altitudeEnvelopeCache = new WeakMap<Trajectory, { minFeet: number; maxFeet: number }>();

// Binary search for current segment index such that times[i] <= t <= times[i+1]
function segmentIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 2; // compare against i+1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tMid = times[mid];
    const tNext = times[mid + 1];
    if (t < tMid) hi = mid - 1;
    else if (t > tNext) lo = mid + 1;
    else return mid;
  }
  if (times.length <= 1) return 0;
  return Math.max(0, Math.min(times.length - 2, lo));
}

export function getCurrentActiveFlightIdsInFlRange(
  tracks: Trajectory[] | undefined,
  t: number,
  flLowerBound: number,
  flUpperBound: number
): Set<string> {
  return getFlightLineVisibilitySnapshot(tracks, t, flLowerBound, flUpperBound).activeInsideRangeIds;
}

export function getFlightLineVisibilitySnapshot(
  tracks: Trajectory[] | undefined,
  t: number,
  flLowerBound: number,
  flUpperBound: number
): FlightLineVisibilitySnapshot {
  const activeInsideRangeIds = new Set<string>();
  const listDrivenEligibleIds = new Set<string>();
  if (!tracks) {
    return { activeInsideRangeIds, listDrivenEligibleIds };
  }

  const minFeet = flLowerBound * 100;
  const maxFeet = flUpperBound * 100;

  for (const tr of tracks) {
    const flightId = String(tr.flightId ?? "").trim();
    if (!flightId) continue;

    const isActive = t >= tr.t0 && t <= tr.t1;
    if (!isActive) {
      const envelope = getTrajectoryAltitudeEnvelope(tr);
      if (envelope.maxFeet >= minFeet && envelope.minFeet <= maxFeet) {
        listDrivenEligibleIds.add(flightId);
      }
      continue;
    }

    if (!Array.isArray(tr.times) || tr.times.length < 2) continue;
    if (!Array.isArray(tr.coords) || tr.coords.length < 2) continue;

    const idx = segmentIndex(tr.times, t);
    const t0 = tr.times[idx];
    const t1 = tr.times[idx + 1];
    const p0 = tr.coords[idx];
    const p1 = tr.coords[idx + 1];
    if (!p0 || !p1) continue;

    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const alt = p0[2] !== undefined && p1[2] !== undefined ? p0[2] + (p1[2] - p0[2]) * u : 0;
    const flightLevel = Math.round(alt / 100);

    if (flightLevel >= flLowerBound && flightLevel <= flUpperBound) {
      activeInsideRangeIds.add(flightId);
      listDrivenEligibleIds.add(flightId);
    }
  }

  return { activeInsideRangeIds, listDrivenEligibleIds };
}

function getTrajectoryAltitudeEnvelope(trajectory: Trajectory): { minFeet: number; maxFeet: number } {
  const cached = altitudeEnvelopeCache.get(trajectory);
  if (cached) return cached;

  let minFeet = Number.POSITIVE_INFINITY;
  let maxFeet = Number.NEGATIVE_INFINITY;

  for (const coord of trajectory.coords || []) {
    const altitude = Array.isArray(coord) && Number.isFinite(coord[2]) ? Number(coord[2]) : 0;
    if (altitude < minFeet) minFeet = altitude;
    if (altitude > maxFeet) maxFeet = altitude;
  }

  if (!Number.isFinite(minFeet) || !Number.isFinite(maxFeet)) {
    minFeet = 0;
    maxFeet = 0;
  }

  const envelope = { minFeet, maxFeet };
  altitudeEnvelopeCache.set(trajectory, envelope);
  return envelope;
}
