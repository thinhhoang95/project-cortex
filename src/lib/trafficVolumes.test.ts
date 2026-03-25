import { beforeEach, describe, expect, it, vi } from "vitest";

describe("trafficVolumes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not repopulate cache when a cleared in-flight load resolves later", async () => {
    let resolveLoad:
      | ((value: GeoJSON.FeatureCollection<GeoJSON.Geometry, { traffic_volume_id: string }>) => void)
      | null = null;

    vi.doMock("./airspace", () => ({
      loadSectors: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    }));
    vi.doMock("./dataPaths", () => ({
      getAirspacePathCandidates: vi.fn().mockReturnValue(["/tv.geojson", "/tv.json"]),
      listLocalResourceDates: vi.fn().mockReturnValue(["2023-07-17"]),
    }));
    vi.doMock("@/components/useSimStore", () => ({
      useSimStore: {
        getState: () => ({ resourceDate: "2023-07-17" }),
      },
    }));

    const mod = await import("./trafficVolumes");
    const pending = mod.fetchTrafficVolumeFeature("TV_A");

    mod.clearTrafficVolumeCache();
    resolveLoad?.({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { traffic_volume_id: "TV_A" },
        },
      ],
    });

    const feature = await pending;

    expect(feature?.properties.traffic_volume_id).toBe("TV_A");
    expect(mod.getCachedTrafficVolumeFeature("TV_A")).toBeNull();
  });
});
