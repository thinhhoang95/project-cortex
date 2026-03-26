import { describe, expect, it } from "vitest";

import {
  buildFlightLevelPreviewCacheKey,
  deriveNextFlightLevelSelectedBinKeys,
} from "@/components/FlightLevelBinCountChart";

describe("buildFlightLevelPreviewCacheKey", () => {
  it("namespaces FL preview cache entries by resource-state epoch", () => {
    const baselineKey = buildFlightLevelPreviewCacheKey({
      resourceStateEpoch: 3,
      trafficVolumeId: "TV_A",
      refTimeStr: "09:00:00",
      durationMin: 30,
      startFl: 320,
      endFl: 339,
    });
    const delayedStateKey = buildFlightLevelPreviewCacheKey({
      resourceStateEpoch: 4,
      trafficVolumeId: "TV_A",
      refTimeStr: "09:00:00",
      durationMin: 30,
      startFl: 320,
      endFl: 339,
    });

    expect(delayedStateKey).not.toBe(baselineKey);
  });

  it("replaces or unions selected bins based on multiselect mode", () => {
    expect(
      deriveNextFlightLevelSelectedBinKeys({
        currentKeys: ["320-340", "340-360"],
        clickedKey: "360-380",
        multiselect: true,
      }),
    ).toEqual(["320-340", "340-360", "360-380"]);

    expect(
      deriveNextFlightLevelSelectedBinKeys({
        currentKeys: ["320-340", "340-360"],
        clickedKey: "360-380",
        multiselect: false,
      }),
    ).toEqual(["360-380"]);
  });
});
