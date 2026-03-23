import { describe, expect, it } from "vitest";

import { formatCrossingFlightLevelRange } from "@/lib/trafficVolumeFormat";

describe("formatCrossingFlightLevelRange", () => {
  it("compacts standard API FL labels", () => {
    expect(
      formatCrossingFlightLevelRange({
        label: "FL100-FL350",
      }),
    ).toBe("100-350");
  });

  it("falls back to numeric bounds when no label is present", () => {
    expect(
      formatCrossingFlightLevelRange({
        min_fl: 280,
        max_fl: 300,
      }),
    ).toBe("280-300");
  });

  it("renders the API sentinel range as -1", () => {
    expect(
      formatCrossingFlightLevelRange({
        label: "FL -1",
      }),
    ).toBe("-1");
    expect(
      formatCrossingFlightLevelRange({
        min_fl: -1,
        max_fl: -1,
      }),
    ).toBe("-1");
  });

  it("returns null when the crossing range cannot be resolved", () => {
    expect(formatCrossingFlightLevelRange(null)).toBeNull();
    expect(formatCrossingFlightLevelRange({})).toBeNull();
  });
});
