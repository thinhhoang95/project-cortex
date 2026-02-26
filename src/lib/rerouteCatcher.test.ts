import { describe, expect, it } from "vitest";
import type { Trajectory } from "./models";
import { captureFlightsByRerouteCatcher } from "./rerouteCatcher";

function buildTrajectory(input: {
  id: string;
  coords: Array<[number, number]>;
  times: number[];
}): Trajectory {
  return {
    flightId: input.id,
    callSign: input.id,
    coords: input.coords.map(([lng, lat]) => [lng, lat, 30000]),
    times: input.times,
    t0: input.times[0] ?? 0,
    t1: input.times[input.times.length - 1] ?? 0,
    origin: "AAA",
    destination: "BBB",
  };
}

describe("captureFlightsByRerouteCatcher", () => {
  it("captures a proper crossing when direction matches draw order", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-1, -1],
          [1, 1],
        ],
        times: [1000, 2000],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "all",
      currentTimeSeconds: 0,
    });

    expect(result.flightIds).toEqual(["F1"]);
    expect(result.matches[0]?.crossingTimeSeconds).toBe(1500);
  });

  it("does not capture when there is no intersection", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-2, 2],
          [-1, 2],
        ],
        times: [1000, 2000],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "all",
      currentTimeSeconds: 0,
    });

    expect(result.flightIds).toEqual([]);
  });

  it("rejects crossing when draw direction is reversed", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-1, -1],
          [1, 1],
        ],
        times: [1000, 2000],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, -1],
        [0, 1],
      ],
      timeframe: "all",
      currentTimeSeconds: 0,
    });

    expect(result.flightIds).toEqual([]);
  });

  it("applies forward timeframe from current simulation time", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-1, 0],
          [1, 0],
        ],
        times: [1000, 2000],
      }),
    ];

    const pass = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "15m",
      currentTimeSeconds: 1400,
    });
    expect(pass.flightIds).toEqual(["F1"]);

    const fail = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "15m",
      currentTimeSeconds: 1600,
    });
    expect(fail.flightIds).toEqual([]);
  });

  it("ALL timeframe bypasses time filtering", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-1, 0],
          [1, 0],
        ],
        times: [1000, 2000],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "all",
      currentTimeSeconds: 1600,
    });

    expect(result.flightIds).toEqual(["F1"]);
  });

  it("handles forward-window checks across midnight", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-1, 0],
          [1, 0],
        ],
        times: [86340, 60],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 1],
        [0, -1],
      ],
      timeframe: "15m",
      currentTimeSeconds: 86370,
    });

    expect(result.flightIds).toEqual(["F1"]);
    expect(result.matches[0]?.deltaForwardSeconds).toBeLessThanOrEqual(900);
  });

  it("deduplicates flights with multiple qualifying crossings and keeps earliest", () => {
    const trajectories = [
      buildTrajectory({
        id: "F1",
        coords: [
          [-2, -1],
          [2, -1],
          [-2, 1],
          [2, 1],
        ],
        times: [0, 1000, 2000, 3000],
      }),
    ];

    const result = captureFlightsByRerouteCatcher({
      trajectories,
      catcherPolyline: [
        [0, 2],
        [0, -2],
      ],
      timeframe: "all",
      currentTimeSeconds: 0,
    });

    expect(result.flightIds).toEqual(["F1"]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.crossingTimeSeconds).toBe(500);
  });
});
