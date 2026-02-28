import { describe, expect, it } from "vitest";

import type { Trajectory } from "./models";
import {
  computeRerouteGeometry,
  computeRerouteGeometryAsync,
  type RerouteFunnel,
  type RerouteObstacle,
} from "./rerouteGeometry";

function makeTrajectory(flightId: string, points: Array<[number, number]>): Trajectory {
  return {
    flightId,
    coords: points.map(([lon, lat]) => [lon, lat]),
    times: points.map((_, idx) => idx * 60),
    t0: 0,
    t1: Math.max(0, (points.length - 1) * 60),
  };
}

function makeFunnel(
  id: string,
  affinityPoint: [number, number],
  selectionPolyline: Array<[number, number]>,
): RerouteFunnel {
  return {
    id,
    affinityPoint,
    selectionPolyline,
  };
}

describe("rerouteGeometry", () => {
  it("chooses a valid obstacle detour and stores modified patch segments", () => {
    const trajectories = [makeTrajectory("F1", [[0, 0], [10, 0]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-1",
        vertices: [
          [4, -0.2],
          [5, 0.3],
          [6, -0.2],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F1"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].flightId).toBe("F1");
    expect(result.flights[0].oldSegments.length).toBeGreaterThan(0);
    expect(result.flights[0].newSegments.length).toBeGreaterThan(result.flights[0].oldSegments.length);
    expect(result.flights[0].extraNm).toBeGreaterThan(0);
  });

  it("keeps segment unchanged and emits warning when no obstacle detour vertex is valid", () => {
    const trajectories = [makeTrajectory("F2", [[4.5, 0], [5.5, 0]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-2",
        vertices: [
          [4, -1],
          [6, -1],
          [6, 1],
          [4, 1],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F2"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(0);
  });

  it("treats boundary/tangent contacts as intersections for obstacle/funnel processing", () => {
    const trajectories = [makeTrajectory("F3", [[0, -0.2], [10, -0.2]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-3",
        vertices: [
          [4, -0.2],
          [5, 0.3],
          [6, -0.2],
        ],
      },
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-TAN", [5, 0.15], [
        [4, -0.2],
        [6, -0.2],
        [6, 0.1],
        [4, 0.1],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F3"],
      obstacles,
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].oldSegments.length).toBeGreaterThan(0);
    expect(result.flights[0].newSegments.length).toBeGreaterThan(0);
  });

  it("applies each funnel at most once using earliest eligible segment", () => {
    const trajectories = [makeTrajectory("F4", [[0, 0], [10, 0], [20, 0]])];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-1", [5, 0.2], [
        [4, -0.15],
        [6, -0.15],
        [6, 0.15],
        [4, 0.15],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F4"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    const flight = result.flights[0];
    expect(flight.oldSegments.length).toBe(1);
    expect(flight.newSegments.length).toBe(2);
  });

  it("processes multiple funnels in along-path order per flight", () => {
    const trajectories = [makeTrajectory("F5", [[0, 0], [10, 0], [20, 0]])];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-LATE", [15, 0.2], [
        [14, -0.15],
        [16, -0.15],
        [16, 0.15],
        [14, 0.15],
      ]),
      makeFunnel("FUN-EARLY", [5, 0.2], [
        [4, -0.15],
        [6, -0.15],
        [6, 0.15],
        [4, 0.15],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F5"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    const flight = result.flights[0];
    expect(flight.oldSegments.length).toBe(2);
    expect(flight.oldSegments[0].start[0]).toBe(0);
    expect(flight.oldSegments[1].start[0]).toBe(10);
  });

  it("dissolves all waypoints inside a funnel polygon and reconnects through the affinity point", () => {
    const trajectories = [
      makeTrajectory("F5B", [
        [0, 0],
        [4.5, 0],
        [5, 0.2],
        [5.5, 0],
        [10, 0],
      ]),
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-DISSOLVE", [5, 2], [
        [4, -1],
        [6, -1],
        [6, 1],
        [4, 1],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F5B"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].reroutedPath).toEqual([
      [0, 0],
      [5, 2],
      [10, 0],
    ]);
    expect(result.flights[0].oldSegments).toHaveLength(4);
    expect(result.flights[0].newSegments).toEqual([
      { start: [0, 0], end: [5, 2] },
      { start: [5, 2], end: [10, 0] },
    ]);
  });

  it("returns changed flights only and extraNm reflects obstacle + funnel delta", () => {
    const trajectories = [
      makeTrajectory("F6", [[0, 0], [10, 0]]),
      makeTrajectory("F7", [[0, 10], [10, 10]]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-6",
        vertices: [
          [4, -0.2],
          [5, 0.3],
          [6, -0.2],
        ],
      },
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-6", [7, 0.2], [
        [6.2, -0.15],
        [8.2, -0.15],
        [8.2, 0.15],
        [6.2, 0.15],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F6", "F7"],
      obstacles,
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights.map((flight) => flight.flightId)).toEqual(["F6"]);
    expect(result.flights[0].extraNm).toBeGreaterThan(0);
    expect(result.totalExtraNm).toBeGreaterThan(0);
  });

  it("bypasses contiguous inside-waypoint runs by connecting nearest outside waypoints", () => {
    const trajectories = [
      makeTrajectory("F8", [
        [0, 0],
        [4.5, 0],
        [5, 0.2],
        [5.5, 0],
        [10, 0],
      ]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-8",
        vertices: [
          [4, -0.2],
          [5, 0.3],
          [6, -0.2],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F8"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].flightId).toBe("F8");
    expect(result.flights[0].oldSegments.length).toBeGreaterThanOrEqual(2);
    expect(result.flights[0].newSegments.length).toBeGreaterThanOrEqual(2);
    expect(result.flights[0].warnings).toEqual([]);
  });

  it("leaves boundary-adjacent blocked waypoint runs unchanged when no single-vertex detour exists", () => {
    const trajectories = [
      makeTrajectory("F9", [
        [0, 0],
        [4, 0],
        [4.5, 0],
        [5.5, 0],
        [6, 0],
        [10, 0],
      ]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-9",
        vertices: [
          [4, -1],
          [6, -1],
          [6, 1],
          [4, 1],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F9"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(0);
  });

  it("does not invent a two-vertex bypass when a blocked waypoint run has no valid single-vertex detour", () => {
    const trajectories = [
      makeTrajectory("F9B", [
        [-1, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [5, 1],
      ]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-9B",
        vertices: [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F9B"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(0);
  });

  it("skips funnel dissolution when the contact span does not have outside endpoints", () => {
    const trajectories = [
      makeTrajectory("F9C", [
        [4.5, 0],
        [5, 0.2],
        [10, 0],
      ]),
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-INVALID-SPAN", [5, 2], [
        [4, -1],
        [6, -1],
        [6, 1],
        [4, 1],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F9C"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(0);
    expect(result.flights).toEqual([]);
  });

  it("matches synchronous results when computed in async batches", async () => {
    const trajectories = [
      makeTrajectory("F10", [[0, 0], [10, 0], [20, 0]]),
      makeTrajectory("F11", [[0, 5], [10, 5], [20, 5]]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-10",
        vertices: [
          [4, -0.2],
          [5, 0.3],
          [6, -0.2],
        ],
      },
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-10", [15, 0.2], [
        [14, -0.15],
        [16, -0.15],
        [16, 0.15],
        [14, 0.15],
      ]),
    ];

    const syncResult = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F10", "F11"],
      obstacles,
      funnels,
    });
    const asyncResult = await computeRerouteGeometryAsync(
      {
        trajectories,
        selectedFlightIds: ["F10", "F11"],
        obstacles,
        funnels,
      },
      { batchSize: 1, maxBlockingMs: 1 },
    );

    expect({ ...asyncResult, generatedAtEpochMs: 0 }).toEqual({
      ...syncResult,
      generatedAtEpochMs: 0,
    });
  });

  it("reroutes only segments intersecting the funnel polygon", () => {
    const trajectories = [makeTrajectory("F12", [[0, 0], [10, 0], [10, 10]])];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-DIR", [5, 0.2], [
        [4, -0.15],
        [6, -0.15],
        [6, 0.15],
        [4, 0.15],
      ]),
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F12"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].oldSegments).toEqual([
      {
        start: [0, 0],
        end: [10, 0],
      },
    ]);
    expect(result.flights[0].reroutedPath).toEqual([
      [0, 0],
      [5, 0.2],
      [10, 0],
      [10, 10],
    ]);
  });
});
