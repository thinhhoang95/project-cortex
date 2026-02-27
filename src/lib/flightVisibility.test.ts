import { describe, expect, it } from "vitest";

import type { Trajectory } from "./models";
import { getCurrentActiveFlightIdsInFlRange } from "./flightVisibility";

function makeTrajectory(
  flightId: string,
  times: number[],
  coords: [number, number, number?][]
): Trajectory {
  return {
    flightId,
    callSign: flightId,
    coords,
    t0: times[0] ?? 0,
    t1: times.length > 0 ? times[times.length - 1] : 0,
    times,
  };
}

describe("getCurrentActiveFlightIdsInFlRange", () => {
  it("includes only active flights inside the interpolated FL range", () => {
    const tracks: Trajectory[] = [
      makeTrajectory("IN", [0, 100], [[0, 0, 20000], [1, 1, 20000]]), // FL200
      makeTrajectory("OUT", [0, 100], [[0, 0, 35000], [1, 1, 35000]]), // FL350
      makeTrajectory("INACTIVE", [200, 300], [[0, 0, 20000], [1, 1, 20000]]),
    ];

    const result = getCurrentActiveFlightIdsInFlRange(tracks, 50, 150, 250);

    expect(Array.from(result)).toEqual(["IN"]);
  });

  it("uses linear interpolation for current altitude", () => {
    const tracks: Trajectory[] = [
      makeTrajectory("CLIMB", [0, 100], [[0, 0, 10000], [1, 1, 30000]]), // FL100 -> FL300
    ];

    expect(getCurrentActiveFlightIdsInFlRange(tracks, 25, 140, 160).has("CLIMB")).toBe(true); // FL150
    expect(getCurrentActiveFlightIdsInFlRange(tracks, 25, 160, 200).has("CLIMB")).toBe(false);
  });

  it("includes boundary flight levels and falls back to FL000 when altitude is missing", () => {
    const tracks: Trajectory[] = [
      makeTrajectory("LOWER", [0, 100], [[0, 0, 10000], [1, 1, 10000]]), // FL100
      makeTrajectory("UPPER", [0, 100], [[0, 0, 20000], [1, 1, 20000]]), // FL200
      makeTrajectory("MISSING_ALT", [0, 100], [[0, 0], [1, 1]]), // FL000 fallback
    ];

    const bounded = getCurrentActiveFlightIdsInFlRange(tracks, 50, 100, 200);
    expect(bounded.has("LOWER")).toBe(true);
    expect(bounded.has("UPPER")).toBe(true);

    const flZero = getCurrentActiveFlightIdsInFlRange(tracks, 50, 0, 0);
    expect(flZero.has("MISSING_ALT")).toBe(true);
  });
});
