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

    const funnelId = useSimStore.getState().addRerouteFunnel([3, 3], 12);
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
});
