import { beforeEach, describe, expect, it } from "vitest";

import { useSimStore } from "./useSimStore";

describe("useSimStore VPF flow extractor state", () => {
  beforeEach(() => {
    useSimStore.getState().resetAll();
  });

  it("defaults VPF controls and clamps them to positive integers", () => {
    expect(useSimStore.getState().flowMinFlights).toBe(4);
    expect(useSimStore.getState().flowMaxFlows).toBeNull();

    useSimStore.getState().setFlowMinFlights(0);
    useSimStore.getState().setFlowMaxFlows(2.8);

    expect(useSimStore.getState().flowMinFlights).toBe(1);
    expect(useSimStore.getState().flowMaxFlows).toBe(2);

    useSimStore.getState().setFlowMinFlights(6.9);
    useSimStore.getState().setFlowMaxFlows(null);

    expect(useSimStore.getState().flowMinFlights).toBe(6);
    expect(useSimStore.getState().flowMaxFlows).toBeNull();
  });

  it("stores VPF memberships while preserving a primary community fallback", () => {
    useSimStore.getState().setFlowCommunities(
      null,
      { "0": ["F1", "F2"], "1": ["F1", "F3"] },
      undefined,
      { F1: [0, 1], F2: [0], F3: [1] },
      {
        "0": {
          definitionSize: 2,
          definingVolumes: [
            {
              key: "0:TVA",
              sequenceIndex: 0,
              role: "primary",
              trafficVolumeId: "TVA",
              label: "TVA",
              windowLabel: "07:30-08:15",
              isPrimary: true,
              segmentType: "primary",
              sumExcess: null,
              peakExcess: null,
              raw: { traffic_volume_id: "TVA" },
            },
            {
              key: "1:TVB",
              sequenceIndex: 1,
              role: "secondary",
              trafficVolumeId: "TVB",
              label: "TVB",
              windowLabel: "09:00-10:00",
              isPrimary: false,
              segmentType: "overload",
              sumExcess: null,
              peakExcess: null,
              raw: { traffic_volume_id: "TVB" },
            },
          ],
          proxyScore: 5.25,
        },
        "1": { definitionSize: 2, definingVolumes: [], proxyScore: 4.5 },
      },
      { primary_tv: "TVA", primary_time_window: { label: "07:30-08:15" } },
    );

    expect(useSimStore.getState().flowMemberships).toEqual({ F1: [0, 1], F2: [0], F3: [1] });
    expect(useSimStore.getState().flowCommunities).toEqual({ F1: 0, F2: 0, F3: 1 });
    expect(useSimStore.getState().flowGroupMetadata?.["0"]?.definingVolumes?.map((volume) => volume.trafficVolumeId)).toEqual(["TVA", "TVB"]);
    expect(useSimStore.getState().flowExtractorMetadata?.primary_tv).toBe("TVA");
  });
});
