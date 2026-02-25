import { describe, expect, it } from "vitest";

import { toggleOrderedTrafficVolumes } from "./multiTrafficVolumeSelection";

describe("toggleOrderedTrafficVolumes", () => {
  it("adds a new selection to the end", () => {
    expect(toggleOrderedTrafficVolumes([], "TV_A")).toEqual({
      selectedTrafficVolumes: ["TV_A"],
      changed: true,
    });

    expect(toggleOrderedTrafficVolumes(["TV_A"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      changed: true,
    });
  });

  it("removes an existing selection and preserves remaining order", () => {
    expect(toggleOrderedTrafficVolumes(["TV_A", "TV_B", "TV_C"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_C"],
      changed: true,
    });
  });

  it("promotes the next TV when removing the primary", () => {
    expect(toggleOrderedTrafficVolumes(["TV_A", "TV_B", "TV_C"], "TV_A")).toEqual({
      selectedTrafficVolumes: ["TV_B", "TV_C"],
      changed: true,
    });
  });

  it("enforces the max selection limit", () => {
    expect(
      toggleOrderedTrafficVolumes(["A", "B", "C", "D", "E"], "F", 5),
    ).toEqual({
      selectedTrafficVolumes: ["A", "B", "C", "D", "E"],
      changed: false,
      reason: "max_limit",
    });
  });
});

