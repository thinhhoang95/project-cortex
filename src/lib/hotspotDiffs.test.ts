import { describe, expect, it } from "vitest";

import {
  buildHotspotDiffCategories,
  computeHotspotChangeSummaryForWindow,
  computeHotspotDiffsFromRollingCounts,
} from "@/lib/hotspotDiffs";

describe("hotspotDiffs", () => {
  it("computes hotspot deltas from rolling counts and represents shifts as add plus remove", () => {
    const diffs = computeHotspotDiffsFromRollingCounts({
      preCounts: {
        TV_A: [4, 4, 0, 0],
        TV_B: [0, 0, 0, 0],
      },
      postCounts: {
        TV_A: [0, 4, 4, 0],
        TV_B: [0, 4, 4, 0],
      },
      capacity: {
        TV_A: [3, 3, 3, 3],
        TV_B: [3, 3, 3, 3],
      },
      tvOrder: ["TV_A", "TV_B"],
      binMinutes: 15,
    });

    expect(diffs.new_hotspots).toEqual([
      expect.objectContaining({
        traffic_volume_id: "TV_A",
        start_bin: 2,
        end_bin: 2,
        start_label: "00:30",
        end_label: "00:30",
        max_excess: 1,
        sum_excess: 1,
        peak_rolling_count: 4,
      }),
      expect.objectContaining({
        traffic_volume_id: "TV_B",
        start_bin: 1,
        end_bin: 2,
      }),
    ]);
    expect(diffs.extinguished_hotspots).toEqual([
      expect.objectContaining({
        traffic_volume_id: "TV_A",
        start_bin: 0,
        end_bin: 0,
        start_label: "00:00",
        end_label: "00:00",
      }),
    ]);
    expect(diffs.hotspot_change_summary).toEqual([
      {
        traffic_volume_id: "TV_A",
        new_hotspot_bin_count: 1,
        extinguished_hotspot_bin_count: 1,
        net_hotspot_bin_delta: 0,
        new_hotspot_segment_count: 1,
        extinguished_hotspot_segment_count: 1,
      },
      {
        traffic_volume_id: "TV_B",
        new_hotspot_bin_count: 2,
        extinguished_hotspot_bin_count: 0,
        net_hotspot_bin_delta: 2,
        new_hotspot_segment_count: 1,
        extinguished_hotspot_segment_count: 0,
      },
    ]);
  });

  it("filters hotspot summaries to the visible time window", () => {
    const diffs = computeHotspotDiffsFromRollingCounts({
      preCounts: {
        TV_A: [4, 4, 0, 0],
      },
      postCounts: {
        TV_A: [0, 4, 4, 0],
      },
      capacity: {
        TV_A: [3, 3, 3, 3],
      },
      tvOrder: ["TV_A"],
      binMinutes: 15,
    });

    expect(
      computeHotspotChangeSummaryForWindow({
        hotspotDiffs: diffs,
        tvOrder: ["TV_A"],
        binMinutes: 15,
        viewFrom: "00:00",
        viewTo: "00:59",
      }),
    ).toEqual([
      {
        traffic_volume_id: "TV_A",
        new_hotspot_bin_count: 1,
        extinguished_hotspot_bin_count: 1,
        net_hotspot_bin_delta: 0,
        new_hotspot_segment_count: 1,
        extinguished_hotspot_segment_count: 1,
      },
    ]);

    expect(
      computeHotspotChangeSummaryForWindow({
        hotspotDiffs: diffs,
        tvOrder: ["TV_A"],
        binMinutes: 15,
        viewFrom: "00:15",
        viewTo: "00:45",
      }),
    ).toEqual([
      {
        traffic_volume_id: "TV_A",
        new_hotspot_bin_count: 1,
        extinguished_hotspot_bin_count: 0,
        net_hotspot_bin_delta: 1,
        new_hotspot_segment_count: 1,
        extinguished_hotspot_segment_count: 0,
      },
    ]);
  });

  it("sorts changed TVs by balanced add/remove impact and ignores invalid capacity bins", () => {
    const categories = buildHotspotDiffCategories({
      hotspotDiffs: {
        hotspot_change_summary: [
          {
            traffic_volume_id: "TV_A",
            new_hotspot_bin_count: 3,
            extinguished_hotspot_bin_count: 1,
            net_hotspot_bin_delta: 2,
            new_hotspot_segment_count: 2,
            extinguished_hotspot_segment_count: 1,
          },
          {
            traffic_volume_id: "TV_B",
            new_hotspot_bin_count: 2,
            extinguished_hotspot_bin_count: 2,
            net_hotspot_bin_delta: 0,
            new_hotspot_segment_count: 1,
            extinguished_hotspot_segment_count: 1,
          },
        ],
      },
      tvOrder: ["TV_A", "TV_B"],
      binMinutes: 15,
      viewFrom: "00:00",
      viewTo: "23:59",
    });

    expect(categories.changed.map((entry) => entry.traffic_volume_id)).toEqual([
      "TV_B",
      "TV_A",
    ]);

    const diffs = computeHotspotDiffsFromRollingCounts({
      preCounts: {
        TV_C: [5, 5],
      },
      postCounts: {
        TV_C: [6, 6],
      },
      capacity: {
        TV_C: [9999, 9999],
      },
      tvOrder: ["TV_C"],
      binMinutes: 15,
    });

    expect(diffs.new_hotspots).toEqual([]);
    expect(diffs.extinguished_hotspots).toEqual([]);
    expect(diffs.hotspot_change_summary).toEqual([]);
  });
});
