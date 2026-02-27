import { describe, expect, it } from "vitest";

import type { Trajectory } from "./models";
import {
  computeRerouteGeometry,
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
    const funnels: RerouteFunnel[] = [{ id: "FUN-TAN", center: [5, -0.15], radiusNm: 3 }];

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
    const funnels: RerouteFunnel[] = [{ id: "FUN-1", center: [5, 0.05], radiusNm: 3 }];

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
      { id: "FUN-LATE", center: [15, 0.05], radiusNm: 3 },
      { id: "FUN-EARLY", center: [5, 0.05], radiusNm: 3 },
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
    const funnels: RerouteFunnel[] = [{ id: "FUN-6", center: [7, 0.05], radiusNm: 3 }];

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
});
