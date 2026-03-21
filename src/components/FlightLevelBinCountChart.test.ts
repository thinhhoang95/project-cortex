import { describe, expect, it } from "vitest";

import { buildFlightLevelPreviewCacheKey } from "@/components/FlightLevelBinCountChart";

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
});
