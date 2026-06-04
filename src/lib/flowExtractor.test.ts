import { describe, expect, it } from "vitest";

import { buildFlowGroupMetadata } from "./flowExtractor";

describe("buildFlowGroupMetadata", () => {
  it("uses route-ordered VPF defining volumes for VPF-3 groups", () => {
    const metadata = buildFlowGroupMetadata({
      definition_size: 3,
      proxy_score: 7.25,
      secondary_tv: "OLD_ALIAS",
      flow_defining_volumes: [
        {
          sequence_index: 2,
          role: "tertiary",
          traffic_volume_id: "TVC",
          segment_type: "overload",
          is_primary: false,
          volume: { display_name: "TVC Meter" },
          time_window: { label: "10:00-10:30" },
        },
        {
          sequence_index: 0,
          role: "primary",
          traffic_volume_id: "TVA",
          segment_type: "primary",
          is_primary: true,
          volume: { display_name: "TVA Primary" },
          time_window: { label: "08:00-08:45" },
        },
        {
          sequence_index: 1,
          role: "secondary",
          traffic_volume_id: "TVB",
          segment_type: "overload",
          is_primary: false,
          volume: { display_name: "TVB Meter" },
          time_window: { label: "09:00-09:30" },
        },
      ],
    });

    expect(metadata.definitionSize).toBe(3);
    expect(metadata.proxyScore).toBe(7.25);
    expect(metadata.definingVolumes?.map((volume) => volume.trafficVolumeId)).toEqual(["TVA", "TVB", "TVC"]);
    expect(metadata.definingVolumes?.map((volume) => volume.label)).toEqual(["TVA Primary", "TVB Meter", "TVC Meter"]);
  });
});
