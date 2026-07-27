import { describe, expect, it } from "vitest";

import {
  applyTrafficVolumeFlowTrace,
  applyTrafficVolumeFlowTraceWithHotspots,
  applyTrafficVolumeHotspots,
  TRAFFIC_VOLUME_LAYER_IDS,
} from "./trafficVolumeLayers";

function makeMapStub() {
  const filters = new Map<string, unknown>();
  return {
    filters,
    map: {
      getLayer: () => true,
      setFilter: (layerId: string, filter: unknown) => {
        filters.set(layerId, filter);
      },
    },
  };
}

describe("applyTrafficVolumeFlowTrace", () => {
  it("applies deduplicated flow-trace filters to polygon and point layers", () => {
    const { map, filters } = makeMapStub();

    applyTrafficVolumeFlowTrace(map as any, ["TVA", "TVB", "TVA", ""]);

    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.flowTrace)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVA", "TVB"]]],
    ]);
    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.flowTraceOutline)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVA", "TVB"]]],
    ]);
    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.pointFlowTrace)).toEqual([
      "all",
      [
        "all",
        ["==", ["get", "source_geom_type"], "Point"],
        ["==", ["get", "tv_kind"], "nonas"],
      ],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVA", "TVB"]]],
    ]);
  });

  it("keeps overloaded traced volumes in the hotspot layers", () => {
    const { map, filters } = makeMapStub();

    applyTrafficVolumeFlowTraceWithHotspots(map as any, {
      activeHotspotIds: ["TVA", "TVC"],
      flowTraceVolumeIds: ["TVA", "TVB", "TVA"],
    });

    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.flowTrace)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVB"]]],
    ]);
    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.hotspot)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVA"]]],
    ]);
  });

  it("falls back to normal hotspot rendering when no trace is active", () => {
    const { map, filters } = makeMapStub();

    applyTrafficVolumeFlowTraceWithHotspots(map as any, {
      activeHotspotIds: ["TVA", "TVC"],
      flowTraceVolumeIds: [],
    });

    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.flowTrace)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["==", ["get", "traffic_volume_id"], ""],
    ]);
    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.hotspot)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TVA", "TVC"]]],
    ]);
  });
});

describe("applyTrafficVolumeHotspots", () => {
  it("uses the centralized color assigned to each traffic volume", () => {
    const filters = new Map<string, unknown>();
    const paints = new Map<string, unknown>();
    const map = {
      getLayer: () => true,
      setFilter: (layerId: string, filter: unknown) => filters.set(layerId, filter),
      setPaintProperty: (layerId: string, property: string, value: unknown) => {
        paints.set(`${layerId}:${property}`, value);
      },
    };

    applyTrafficVolumeHotspots(map as any, [
      { traffic_volume_id: "TV_ORANGE", hotspot_severity: "orange", hotspot_color: "#fb923c" },
      { traffic_volume_id: "TV_VIOLET", hotspot_severity: "violet", hotspot_color: "#8b5cf6" },
    ]);

    expect(paints.get(`${TRAFFIC_VOLUME_LAYER_IDS.hotspot}:fill-color`)).toEqual([
      "match",
      ["to-string", ["get", "traffic_volume_id"]],
      "TV_ORANGE",
      "#fb923c",
      "TV_VIOLET",
      "#8b5cf6",
      "#ef4444",
    ]);
    expect(filters.get(TRAFFIC_VOLUME_LAYER_IDS.hotspot)).toEqual([
      "all",
      ["!=", ["get", "source_geom_type"], "Point"],
      ["in", ["get", "traffic_volume_id"], ["literal", ["TV_ORANGE", "TV_VIOLET"]]],
    ]);
  });
});
