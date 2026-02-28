import { afterEach, describe, expect, it, vi } from "vitest";

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

function makeDenseRectangleObstacle(pointsPerEdge: number): RerouteObstacle {
  const vertices: Array<[number, number]> = [];
  const steps = Math.max(2, pointsPerEdge);
  for (let idx = 0; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([4 + t * 2, -1]);
  }
  for (let idx = 1; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([6, -1 + t * 2]);
  }
  for (let idx = 1; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([6 - t * 2, 1]);
  }
  for (let idx = 1; idx < steps - 1; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([4, 1 - t * 2]);
  }
  return {
    id: `OBS-DENSE-RECT-${steps}`,
    vertices,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rerouteGeometry", () => {
  it("single-corner bypass still wins when available", () => {
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
    expect(result.flights[0].reroutedPath).toHaveLength(3);
    expect(result.flights[0].oldSegments.length).toBeGreaterThan(0);
    expect(result.flights[0].newSegments.length).toBe(2);
    expect(result.totalExtraNm).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves diagnostics when a blocked span cannot be bypassed because endpoints stay inside", () => {
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
    expect(result.flights).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        flightId: "F2",
        changed: false,
        warnings: ["Obstacle OBS-2: cannot bypass blocked span 0-1."],
      },
    ]);
  });

  it("treats boundary and tangent contacts as intersections for obstacle and funnel processing", () => {
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
    expect(result.diagnostics).toEqual([]);
  });

  it("applies each funnel at most once using the earliest eligible segment", () => {
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
    expect(result.flights[0].oldSegments.length).toBe(1);
    expect(result.flights[0].newSegments.length).toBe(2);
    expect(result.diagnostics).toEqual([]);
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
    expect(result.flights[0].oldSegments).toHaveLength(2);
    expect(result.flights[0].oldSegments[0].start[0]).toBe(0);
    expect(result.flights[0].oldSegments[1].start[0]).toBe(10);
    expect(result.diagnostics).toEqual([]);
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
    expect(result.diagnostics).toEqual([]);
  });

  it("returns changed flights only and extraNm reflects obstacle and funnel delta", () => {
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
    expect(result.diagnostics).toEqual([]);
  });

  it("produces a bounded two-corner detour around a rectangle", () => {
    const trajectories = [makeTrajectory("F8", [[0, 0], [10, 0]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-8",
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
      selectedFlightIds: ["F8"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].reroutedPath).toEqual([
      [0, 0],
      [4, 0],
      [4, -1],
      [6, -1],
      [6, 0],
      [10, 0],
    ]);
    expect(result.flights[0].newSegments).toHaveLength(5);
    expect(result.diagnostics).toEqual([]);
  });

  it("collapses multiple inside waypoints to the same boundary detour", () => {
    const trajectories = [
      makeTrajectory("F9", [
        [0, 0],
        [4.5, 0],
        [5, 0.2],
        [5.5, 0],
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

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].reroutedPath).toEqual([
      [0, 0],
      [4, 0],
      [4, -1],
      [6, -1],
      [6, 0],
      [10, 0],
    ]);
    expect(result.flights[0].oldSegments).toHaveLength(4);
    expect(result.diagnostics).toEqual([]);
  });

  it("handles same-edge entry and exit contacts without wrapping the polygon", () => {
    const trajectories = [
      makeTrajectory("F10", [
        [-1, 4],
        [1, 4],
        [3, 4],
        [5, 4],
      ]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-10",
        vertices: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F10"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].reroutedPath).toEqual([
      [-1, 4],
      [0, 4],
      [4, 4],
      [5, 4],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("chooses the shorter valid side on a concave polygon", () => {
    const trajectories = [makeTrajectory("F11", [[0, 0], [10, 0]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-11",
        vertices: [
          [4, -1],
          [8, -1],
          [8, 1],
          [6, 1],
          [6, 3],
          [4, 3],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F11"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(1);
    expect(result.flights[0].reroutedPath).toEqual([
      [0, 0],
      [4, 0],
      [4, -1],
      [8, -1],
      [8, 0],
      [10, 0],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("skips a self-intersecting obstacle and emits diagnostics", () => {
    const trajectories = [makeTrajectory("F12", [[0, 0], [10, 0]])];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-12",
        vertices: [
          [4, -1],
          [6, 1],
          [4, 1],
          [6, -1],
        ],
      },
    ];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F12"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(0);
    expect(result.flights).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        flightId: "F12",
        changed: false,
        warnings: [
          "Obstacle OBS-12: multicorner fallback skipped for blocked span 0-1; polygon self-intersects.",
        ],
      },
    ]);
  });

  it("skips an over-vertex-limit obstacle and emits diagnostics", () => {
    const trajectories = [makeTrajectory("F13", [[0, 0], [10, 0]])];
    const obstacles: RerouteObstacle[] = [makeDenseRectangleObstacle(18)];

    const result = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F13"],
      obstacles,
      funnels: [],
    });

    expect(result.changedFlightCount).toBe(0);
    expect(result.flights).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        flightId: "F13",
        changed: false,
        warnings: [
          "Obstacle OBS-DENSE-RECT-18: multicorner fallback skipped for blocked span 0-1; polygon exceeds 64 vertices.",
        ],
      },
    ]);
  });

  it("skips funnel dissolution when the contact span does not have outside endpoints", () => {
    const trajectories = [
      makeTrajectory("F14", [
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
      selectedFlightIds: ["F14"],
      obstacles: [],
      funnels,
    });

    expect(result.changedFlightCount).toBe(0);
    expect(result.flights).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        flightId: "F14",
        changed: false,
        warnings: [
          "Funnel FUN-INVALID-SPAN: cannot dissolve span 0-2; endpoints not outside polygon.",
        ],
      },
    ]);
  });

  it("matches synchronous results when computed in async batches", async () => {
    const trajectories = [
      makeTrajectory("F15", [[0, 0], [10, 0], [20, 0]]),
      makeTrajectory("F16", [[0, 5], [10, 5], [20, 5]]),
    ];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-15",
        vertices: [
          [4, -1],
          [6, -1],
          [6, 1],
          [4, 1],
        ],
      },
    ];
    const funnels: RerouteFunnel[] = [
      makeFunnel("FUN-15", [15, 0.2], [
        [14, -0.15],
        [16, -0.15],
        [16, 0.15],
        [14, 0.15],
      ]),
    ];

    const syncResult = computeRerouteGeometry({
      trajectories,
      selectedFlightIds: ["F15", "F16"],
      obstacles,
      funnels,
    });
    const asyncResult = await computeRerouteGeometryAsync(
      {
        trajectories,
        selectedFlightIds: ["F15", "F16"],
        obstacles,
        funnels,
      },
      { batchSize: 1, maxBlockingMs: 4 },
    );

    expect({ ...asyncResult, generatedAtEpochMs: 0 }).toEqual({
      ...syncResult,
      generatedAtEpochMs: 0,
    });
  });

  it("honors abort signals during bounded multicorner traversal", async () => {
    let ticks = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      ticks += 1;
      return ticks;
    });

    const densePath = Array.from({ length: 120 }, (_, idx) => [idx / 12, 0] as [number, number]);
    const trajectories = [makeTrajectory("F17", densePath)];
    const obstacles: RerouteObstacle[] = [
      {
        id: "OBS-17",
        vertices: [
          [2, -1],
          [8, -1],
          [8, 1],
          [2, 1],
        ],
      },
    ];
    const controller = new AbortController();

    const promise = computeRerouteGeometryAsync(
      {
        trajectories,
        selectedFlightIds: ["F17"],
        obstacles,
        funnels: [],
      },
      {
        signal: controller.signal,
        batchSize: 8,
        maxBlockingMs: 4,
      },
    );

    setTimeout(() => controller.abort(), 0);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
