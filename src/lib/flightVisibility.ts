import type { Trajectory } from "./models";

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
  const insideRangeActiveSet = new Set<string>();
  if (!tracks) return insideRangeActiveSet;

  for (const tr of tracks) {
    if (t < tr.t0 || t > tr.t1) continue;
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
      insideRangeActiveSet.add(String(tr.flightId));
    }
  }

  return insideRangeActiveSet;
}
