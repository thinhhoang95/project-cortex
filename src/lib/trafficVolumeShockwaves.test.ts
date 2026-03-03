import { describe, expect, it } from "vitest";

import {
  computeShockwaveDeltaByTv,
  formatShockwaveHorizonLabel,
} from "./trafficVolumeShockwaves";

describe("trafficVolumeShockwaves", () => {
  it("computes future-minus-current deltas from time labels", () => {
    const result = computeShockwaveDeltaByTv({
      counts: {
        TV_A: [3, 5, 7, 4],
        TV_B: [2, 1, 1, 8],
      },
      binMinutes: 15,
      selectedTime: "00:15",
      offsetMinutes: 30,
      labels: ["00:00-00:15", "00:15-00:30", "00:30-00:45", "00:45-01:00"],
    });

    expect(result).toEqual({
      TV_A: -1,
      TV_B: 7,
    });
  });

  it("uses start_bin and arbitrary bin sizes without hardcoded offsets", () => {
    const result = computeShockwaveDeltaByTv({
      counts: {
        TV_A: [1, 2, 3, 4, 9],
      },
      binMinutes: 20,
      startBin: 3,
      selectedTime: "01:20",
      offsetMinutes: 60,
    });

    expect(result).toEqual({
      TV_A: 7,
    });
  });

  it("filters explicit traffic volumes and skips missing target bins", () => {
    const result = computeShockwaveDeltaByTv({
      counts: {
        TV_A: [1, 2],
        TV_B: [4, 5, 8],
      },
      binMinutes: 15,
      selectedTime: "00:00",
      offsetMinutes: 30,
      tvIds: ["TV_A", "TV_B", "TV_C"],
    });

    expect(result).toEqual({
      TV_B: 4,
    });
  });

  it("formats the horizon labels used by the UI", () => {
    expect(formatShockwaveHorizonLabel(0)).toBe("T");
    expect(formatShockwaveHorizonLabel(30)).toBe("T+30");
  });
});
