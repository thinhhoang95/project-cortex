import { beforeEach, describe, expect, it } from "vitest";

import { useSimStore } from "./useSimStore";

describe("useSimStore reroute tools", () => {
  beforeEach(() => {
    useSimStore.getState().resetAll();
  });

  it("enforces exclusive modes between reroute catcher and shape tools", () => {
    const store = useSimStore.getState();

    store.setRerouteCatcherMode("include");
    expect(useSimStore.getState().rerouteCatcherMode).toBe("include");
    expect(useSimStore.getState().rerouteShapeToolMode).toBe("off");

    useSimStore.getState().setRerouteShapeToolMode("obstacle");
    expect(useSimStore.getState().rerouteShapeToolMode).toBe("obstacle");
    expect(useSimStore.getState().rerouteCatcherMode).toBe("off");
    expect(useSimStore.getState().rerouteCatcherActive).toBe(false);
  });

  it("adds/selects/removes obstacle and funnel shapes and clears selected shape on delete", () => {
    const store = useSimStore.getState();

    const obstacleId = store.addRerouteObstacle([
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    expect(obstacleId.length).toBeGreaterThan(0);
    expect(useSimStore.getState().rerouteObstacles).toHaveLength(1);
    expect(useSimStore.getState().rerouteSelectedShape).toEqual({ kind: "obstacle", id: obstacleId });

    const funnelId = useSimStore.getState().addRerouteFunnel([3, 3], [
      [4, 2],
      [5, 2],
      [5, 4],
    ]);
    expect(funnelId.length).toBeGreaterThan(0);
    expect(useSimStore.getState().rerouteFunnels).toHaveLength(1);
    expect(useSimStore.getState().rerouteSelectedShape).toEqual({ kind: "funnel", id: funnelId });

    useSimStore.getState().removeRerouteSelectedShape();
    expect(useSimStore.getState().rerouteFunnels).toHaveLength(0);
    expect(useSimStore.getState().rerouteSelectedShape).toBeNull();

    useSimStore.getState().setRerouteSelectedShape({ kind: "obstacle", id: obstacleId });
    useSimStore.getState().removeRerouteSelectedShape();
    expect(useSimStore.getState().rerouteObstacles).toHaveLength(0);
    expect(useSimStore.getState().rerouteSelectedShape).toBeNull();
  });

  it("toggles reroute preview mode between rerouted and current paths", () => {
    const store = useSimStore.getState();

    expect(store.reroutePreviewMode).toBe("rerouted");

    store.toggleReroutePreviewMode();
    expect(useSimStore.getState().reroutePreviewMode).toBe("current");

    useSimStore.getState().toggleReroutePreviewMode();
    expect(useSimStore.getState().reroutePreviewMode).toBe("rerouted");
  });

  it("commits a draft move only when the draft result contains changed flights", () => {
    const store = useSimStore.getState();

    const rejectedCommitId = store.commitRerouteDraftMove();
    expect(rejectedCommitId).toBe("");

    store.addRerouteObstacle([
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    store.setRerouteDraftMoveGeometryResult({
      generatedAtEpochMs: 1,
      selectedFlightIds: ["F1"],
      obstacleCount: 1,
      funnelCount: 0,
      changedFlightCount: 1,
      totalExtraNm: 10,
      flights: [
        {
          flightId: "F1",
          originalPath: [[0, 0], [10, 0]],
          reroutedPath: [[0, 0], [5, 2], [10, 0]],
          oldSegments: [{ start: [0, 0], end: [10, 0] }],
          newSegments: [
            { start: [0, 0], end: [5, 2] },
            { start: [5, 2], end: [10, 0] },
          ],
          extraNm: 10,
          warnings: [],
        },
      ],
      diagnostics: [],
    });

    const commitId = store.commitRerouteDraftMove();
    const nextState = useSimStore.getState();

    expect(commitId.length).toBeGreaterThan(0);
    expect(nextState.rerouteCommittedMoves).toHaveLength(1);
    expect(nextState.rerouteCommittedMoves[0].affectedFlightIds).toEqual(["F1"]);
    expect(nextState.rerouteObstacles).toHaveLength(0);
    expect(nextState.rerouteFunnels).toHaveLength(0);
    expect(nextState.rerouteShapeToolMode).toBe("off");
  });

  it("deletes only the requested committed reroute move", () => {
    const store = useSimStore.getState();

    store.addRerouteObstacle([
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    store.setRerouteDraftMoveGeometryResult({
      generatedAtEpochMs: 1,
      selectedFlightIds: ["F1"],
      obstacleCount: 1,
      funnelCount: 0,
      changedFlightCount: 1,
      totalExtraNm: 10,
      flights: [
        {
          flightId: "F1",
          originalPath: [[0, 0], [10, 0]],
          reroutedPath: [[0, 0], [5, 2], [10, 0]],
          oldSegments: [{ start: [0, 0], end: [10, 0] }],
          newSegments: [
            { start: [0, 0], end: [5, 2] },
            { start: [5, 2], end: [10, 0] },
          ],
          extraNm: 10,
          warnings: [],
        },
      ],
      diagnostics: [],
    });
    const firstMoveId = store.commitRerouteDraftMove();

    store.addRerouteFunnel([3, 3], [
      [4, 2],
      [5, 2],
      [5, 4],
    ]);
    store.setRerouteDraftMoveGeometryResult({
      generatedAtEpochMs: 2,
      selectedFlightIds: ["F2"],
      obstacleCount: 0,
      funnelCount: 1,
      changedFlightCount: 1,
      totalExtraNm: 4,
      flights: [
        {
          flightId: "F2",
          originalPath: [[0, 0], [6, 0]],
          reroutedPath: [[0, 0], [3, 3], [6, 0]],
          oldSegments: [{ start: [0, 0], end: [6, 0] }],
          newSegments: [
            { start: [0, 0], end: [3, 3] },
            { start: [3, 3], end: [6, 0] },
          ],
          extraNm: 4,
          warnings: [],
        },
      ],
      diagnostics: [],
    });
    const secondMoveId = useSimStore.getState().commitRerouteDraftMove();

    useSimStore.getState().deleteRerouteMove(firstMoveId);
    const nextState = useSimStore.getState();

    expect(nextState.rerouteCommittedMoves).toHaveLength(1);
    expect(nextState.rerouteCommittedMoves[0].id).toBe(secondMoveId);
  });
});
