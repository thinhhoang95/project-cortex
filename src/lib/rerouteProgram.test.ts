import { describe, expect, it } from "vitest";

import type { Trajectory } from "./models";
import { computeRerouteProgramAsync, type RerouteMoveDefinition } from "./rerouteProgram";

function makeTrajectory(flightId: string, points: Array<[number, number]>): Trajectory {
  return {
    flightId,
    coords: points.map(([lon, lat]) => [lon, lat]),
    times: points.map((_, idx) => idx * 60),
    t0: 0,
    t1: Math.max(0, (points.length - 1) * 60),
  };
}

function makeMove(
  id: string,
  flightIds: string[],
  affinityPoint: [number, number],
  selectionPolyline: Array<[number, number]>,
): RerouteMoveDefinition {
  return {
    id,
    flightIds,
    obstacles: [],
    funnels: [
      {
        id: `${id}-FUNNEL`,
        affinityPoint,
        selectionPolyline,
      },
    ],
  };
}

function makeObstacleMove(
  id: string,
  flightIds: string[],
  vertices: Array<[number, number]>,
): RerouteMoveDefinition {
  return {
    id,
    flightIds,
    obstacles: [
      {
        id: `${id}-OBSTACLE`,
        vertices,
      },
    ],
    funnels: [],
  };
}

function makeDenseRectangleVertices(pointsPerEdge: number, centerX: number): Array<[number, number]> {
  const vertices: Array<[number, number]> = [];
  const steps = Math.max(2, pointsPerEdge);
  for (let idx = 0; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([centerX - 1 + t * 2, -1]);
  }
  for (let idx = 1; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([centerX + 1, -1 + t * 2]);
  }
  for (let idx = 1; idx < steps; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([centerX + 1 - t * 2, 1]);
  }
  for (let idx = 1; idx < steps - 1; idx += 1) {
    const t = idx / (steps - 1);
    vertices.push([centerX - 1, 1 - t * 2]);
  }
  return vertices;
}

describe("rerouteProgram", () => {
  it("replays committed moves sequentially against the current rerouted path", async () => {
    const trajectories = [makeTrajectory("F1", [[0, 0], [10, 0], [20, 0]])];
    const firstMove = makeMove("MOVE-1", ["F1"], [5, 2], [
      [4, -1],
      [6, -1],
      [6, 1],
      [4, 1],
    ]);
    const secondMove = makeMove("MOVE-2", ["F1"], [15, 2], [
      [14, -1],
      [16, -1],
      [16, 1],
      [14, 1],
    ]);

    const result = await computeRerouteProgramAsync({
      trajectories,
      moves: [firstMove, secondMove],
    });

    expect(result.moveResultsById["MOVE-1"]?.changedFlightCount).toBe(1);
    expect(result.moveResultsById["MOVE-2"]?.changedFlightCount).toBe(1);
    expect(result.programResult?.changedFlightCount).toBe(1);
    expect(result.programResult?.diagnostics).toEqual([]);
    expect(result.programResult?.flights[0].reroutedPath).toEqual([
      [0, 0],
      [5, 2],
      [10, 0],
      [15, 2],
      [20, 0],
    ]);
  });

  it("recomputes downstream moves from base trajectories when an earlier move is removed", async () => {
    const trajectories = [makeTrajectory("F1", [[0, 0], [10, 0], [20, 0]])];
    const firstMove = makeMove("MOVE-1", ["F1"], [5, 2], [
      [4, -1],
      [6, -1],
      [6, 1],
      [4, 1],
    ]);
    const secondMove = makeMove("MOVE-2", ["F1"], [15, 2], [
      [14, -1],
      [16, -1],
      [16, 1],
      [14, 1],
    ]);

    const withBothMoves = await computeRerouteProgramAsync({
      trajectories,
      moves: [firstMove, secondMove],
    });
    const withoutFirstMove = await computeRerouteProgramAsync({
      trajectories,
      moves: [secondMove],
    });

    expect(withBothMoves.programResult?.flights[0].reroutedPath).toEqual([
      [0, 0],
      [5, 2],
      [10, 0],
      [15, 2],
      [20, 0],
    ]);
    expect(withoutFirstMove.programResult?.flights[0].reroutedPath).toEqual([
      [0, 0],
      [10, 0],
      [15, 2],
      [20, 0],
    ]);
    expect(withBothMoves.moveResultsById["MOVE-2"]?.flights[0].oldSegments[0]).toEqual({
      start: [10, 0],
      end: [20, 0],
    });
    expect(withoutFirstMove.moveResultsById["MOVE-2"]?.flights[0].oldSegments[0]).toEqual({
      start: [10, 0],
      end: [20, 0],
    });
    expect(withBothMoves.programResult?.diagnostics).toEqual([]);
    expect(withoutFirstMove.programResult?.diagnostics).toEqual([]);
  });

  it("preserves draft diagnostics when a draft move changes zero flights", async () => {
    const trajectories = [makeTrajectory("F2", [[0, 0], [10, 0]])];
    const oversizedObstacleMove = makeObstacleMove(
      "MOVE-DIAG",
      ["F2"],
      makeDenseRectangleVertices(18, 5),
    );

    const result = await computeRerouteProgramAsync({
      trajectories,
      moves: [],
      draftMove: oversizedObstacleMove,
    });

    expect(result.draftResult?.changedFlightCount).toBe(0);
    expect(result.draftResult?.diagnostics).toEqual([
      {
        flightId: "F2",
        changed: false,
        warnings: [
          "Obstacle MOVE-DIAG-OBSTACLE: multicorner fallback skipped for blocked span 0-1; polygon exceeds 64 vertices.",
        ],
      },
    ]);
    expect(result.programResult?.changedFlightCount).toBe(0);
    expect(result.programResult?.diagnostics).toEqual(result.draftResult?.diagnostics);
  });

  it("aggregates diagnostics across committed and draft stages", async () => {
    const trajectories = [makeTrajectory("F3", [[0, 0], [10, 0], [20, 0]])];
    const committedMove = makeMove("MOVE-OK", ["F3"], [5, 2], [
      [4, -1],
      [6, -1],
      [6, 1],
      [4, 1],
    ]);
    const failingDraftMove = makeObstacleMove(
      "MOVE-WARN",
      ["F3"],
      makeDenseRectangleVertices(18, 15),
    );

    const result = await computeRerouteProgramAsync({
      trajectories,
      moves: [committedMove],
      draftMove: failingDraftMove,
    });

    expect(result.programResult?.changedFlightCount).toBe(1);
    expect(result.programResult?.flights[0].reroutedPath).toEqual([
      [0, 0],
      [5, 2],
      [10, 0],
      [20, 0],
    ]);
    expect(result.programResult?.diagnostics).toEqual([
      {
        flightId: "F3",
        changed: false,
        warnings: [
          "Obstacle MOVE-WARN-OBSTACLE: multicorner fallback skipped for blocked span 2-3; polygon exceeds 64 vertices.",
        ],
      },
    ]);
  });
});
