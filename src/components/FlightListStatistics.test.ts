import { describe, expect, it } from "vitest";

import { extractTrafficVolumeIds } from "@/components/FlightListStatistics";

describe("extractTrafficVolumeIds", () => {
  it("preserves plain string identifiers", () => {
    expect(extractTrafficVolumeIds(["TV_A", " TV_B ", "TV_A"])).toEqual(["TV_A", "TV_B"]);
  });

  it("extracts canonical ids from object-shaped API entries", () => {
    expect(
      extractTrafficVolumeIds([
        { traffic_volume_id: "TV_ALPHA", date: "2023-07-17" },
        { tv_id: "TV_BRAVO", available_dates: ["2023-07-17", "2023-07-18"] },
        { id: "TV_CHARLIE", resource_manifest: { selected_date: "2023-07-18" } },
        { name: "TV_DELTA" },
      ]),
    ).toEqual(["TV_ALPHA", "TV_BRAVO", "TV_CHARLIE", "TV_DELTA"]);
  });

  it("ignores entries without a usable identifier", () => {
    expect(extractTrafficVolumeIds([{ date: "2023-07-17" }, null, undefined, {}])).toEqual([]);
  });
});
