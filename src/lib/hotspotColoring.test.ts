import { describe, expect, it } from "vitest";
import {
  applyHotspotColoring,
  DEFAULT_HOTSPOT_COLORING_SETTINGS,
  resolveHotspotSeverity,
  type HotspotColoringSettings,
} from "./hotspotColoring";

describe("hotspot coloring", () => {
  it("keeps the default threshold order and assigns all three colors", () => {
    const base = { traffic_volume_id: "TV1", hourly_capacity: 100 };
    expect(resolveHotspotSeverity({ ...base, hourly_occupancy: 110 })).toBe("orange");
    expect(resolveHotspotSeverity({ ...base, hourly_occupancy: 125 })).toBe("red");
    expect(resolveHotspotSeverity({ ...base, hourly_occupancy: 145 })).toBe("violet");
  });

  it("filters values below the selected global absolute threshold", () => {
    const settings: HotspotColoringSettings = {
      global: { unit: "absolute", orange: 40, red: 55, violet: 70 },
      overrides: [],
    };
    const result = applyHotspotColoring([
      { traffic_volume_id: "LOW", hourly_occupancy: 39, hourly_capacity: 10 },
      { traffic_volume_id: "HIGH", hourly_occupancy: 70, hourly_capacity: 100 },
    ], settings);
    expect(result.map((item) => item.traffic_volume_id)).toEqual(["HIGH"]);
    expect(result[0].hotspot_severity).toBe("violet");
  });

  it("uses a traffic-volume override before the global thresholds", () => {
    const settings: HotspotColoringSettings = {
      ...DEFAULT_HOTSPOT_COLORING_SETTINGS,
      overrides: [{
        trafficVolumeId: "SPECIAL",
        unit: "absolute",
        orange: 10,
        red: 20,
        violet: 30,
      }],
    };
    expect(resolveHotspotSeverity({
      traffic_volume_id: "special",
      hourly_occupancy: 20,
      hourly_capacity: 100,
    }, settings)).toBe("red");
  });
});
