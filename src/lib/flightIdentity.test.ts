import { describe, expect, it } from "vitest";

import type { Trajectory } from "@/lib/models";
import { normalizeFlowBasketItemsStrict, resolveFlightTokenToIdStrict } from "@/lib/flightIdentity";

function buildTrajectory(flightId: string, callSign?: string): Trajectory {
  return {
    flightId,
    callSign: callSign ?? flightId,
    origin: "LFPG",
    destination: "EHAM",
    coords: [
      [0, 0, 30000],
      [1, 1, 30000],
    ],
    t0: 100,
    t1: 200,
    times: [100, 200],
  };
}

describe("flightIdentity", () => {
  it("normalizes flow basket items to canonical flight IDs", () => {
    const flights = [
      buildTrajectory("FLIGHT_001", "CS100"),
      buildTrajectory("FLIGHT_002", "CS200"),
    ];

    expect(
      normalizeFlowBasketItemsStrict(
        [
          "CS100",
          { key: "FLIGHT_002", requestedBin: 12 },
        ],
        flights,
      ),
    ).toEqual([
      { key: "FLIGHT_001" },
      { key: "FLIGHT_002", requestedBin: 12 },
    ]);
  });

  it("rejects ambiguous callsigns", () => {
    const flights = [
      buildTrajectory("FLIGHT_001", "DUP"),
      buildTrajectory("FLIGHT_002", "DUP"),
    ];

    expect(() => resolveFlightTokenToIdStrict("DUP", flights)).toThrow(/ambiguous/);
  });
});
