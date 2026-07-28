import { describe, expect, it } from "vitest";
import { buildOriginalCountsRequest } from "@/lib/originalCountsRequest";

describe("buildOriginalCountsRequest", () => {
  it("sends every deduplicated pinned and matched TV in priority order", () => {
    expect(buildOriginalCountsRequest({
      requestedTrafficVolumeIds: ["PINNED", "EBBUEC1", "ebbuec1", "EBBUEC2"],
      fromTime: "08:00",
      toTime: "10:00",
      rollingHour: true,
      rankBy: "total_excess",
    })).toEqual({
      traffic_volume_ids: ["PINNED", "EBBUEC1", "EBBUEC2"],
      from_time_str: "08:00",
      to_time_str: "10:00",
      rolling_hour: true,
      rank_by: "total_excess",
    });
  });

  it("omits traffic_volume_ids for an empty global scope", () => {
    expect(buildOriginalCountsRequest({
      requestedTrafficVolumeIds: [],
      fromTime: "00:00",
      toTime: "23:59",
      rollingHour: false,
      rankBy: "total_count",
    })).not.toHaveProperty("traffic_volume_ids");
  });
});
