import { describe, expect, it } from "vitest";

import {
  applyTrafficVolumeFlowTrace,
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
});
