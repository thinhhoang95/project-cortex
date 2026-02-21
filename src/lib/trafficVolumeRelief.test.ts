import { describe, expect, it } from "vitest";

import {
  clipToDomain,
  computeNetDeltaByTv,
  computeRobustSymmetricDomain,
} from "./trafficVolumeRelief";

describe("trafficVolumeRelief", () => {
  it("computes signed net delta in the selected window", () => {
    const result = computeNetDeltaByTv({
      preCounts: {
        TV_A: [10, 10, 10],
        TV_B: [1, 1, 1],
      },
      postCounts: {
        TV_A: [8, 12, 9],
        TV_B: [3, 3, 3],
      },
      binMinutes: 15,
      viewFrom: "00:00",
      viewTo: "00:30",
    });

    expect(result).toEqual({
      TV_A: -1,
      TV_B: 6,
    });
  });

  it("restricts computation to matching pre/post TVs and explicit tvIds", () => {
    const result = computeNetDeltaByTv({
      preCounts: {
        TV_A: [1, 2],
        TV_C: [9, 9],
      },
      postCounts: {
        TV_A: [3, 2],
        TV_B: [9, 9],
      },
      binMinutes: 15,
      viewFrom: "00:00",
      viewTo: "00:30",
      tvIds: ["TV_A", "TV_B", "TV_C"],
    });

    expect(result).toEqual({
      TV_A: 2,
    });
  });

  it("applies time-window filtering", () => {
    const result = computeNetDeltaByTv({
      preCounts: {
        TV_A: [4, 4, 4],
      },
      postCounts: {
        TV_A: [2, 8, 0],
      },
      binMinutes: 15,
      viewFrom: "00:15",
      viewTo: "00:15",
    });

    expect(result).toEqual({
      TV_A: 4,
    });
  });

  it("returns a robust symmetric domain with percentile clipping", () => {
    const domain = computeRobustSymmetricDomain([1, 2, 3, 4], 0.5, 1);
    expect(domain).toBe(2.5);

    const fallbackDomain = computeRobustSymmetricDomain([0, 0, Number.NaN], 0.95, 1);
    expect(fallbackDomain).toBe(1);
  });

  it("clips values to domain bounds", () => {
    expect(clipToDomain(12, 5)).toBe(5);
    expect(clipToDomain(-12, 5)).toBe(-5);
    expect(clipToDomain(3, 5)).toBe(3);
  });
});
