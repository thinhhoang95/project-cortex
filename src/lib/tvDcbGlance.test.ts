import { describe, expect, it } from "vitest";

import {
  buildTvDcbGlanceLabel,
  formatGlanceDuration,
  getSummaryTimeBinMinutes,
  type TvDcbGlanceSummary,
} from "./tvDcbGlance";

describe("tvDcbGlance", () => {
  it("formats glance durations compactly", () => {
    expect(formatGlanceDuration(0)).toBe("0m");
    expect(formatGlanceDuration(45 * 60)).toBe("45m");
    expect(formatGlanceDuration(65 * 60)).toBe("1h05");
    expect(formatGlanceDuration(135 * 60)).toBe("2h15");
  });

  it("builds a multiline label with current, trend, and closure lines", () => {
    const summary: TvDcbGlanceSummary = {
      current: {
        count: 38,
        capacity: 45,
        delta: -7,
        time_window: "08:00-08:15",
      },
      trends: [
        {
          kind: "peak",
          at_seconds: 8 * 3600 + 45 * 60,
          time_window: "08:45-09:00",
          count: 47,
          capacity: 45,
          delta: 2,
        },
        {
          kind: "trough",
          at_seconds: 10 * 3600 + 18 * 60,
          time_window: "10:15-10:30",
          count: 22,
          capacity: 45,
          delta: -23,
        },
      ],
      closure: {
        at_seconds: 10 * 3600 + 30 * 60,
        in_seconds: 147 * 60,
        reason: "capacity_unavailable",
      },
      metadata: {
        time_bin_minutes: 15,
        ref_time_str: "08:03:00",
        glance_horizon_minutes: 180,
      },
    };

    expect(buildTvDcbGlanceLabel("TV001", summary, 8 * 3600 + 3 * 60)).toBe(
      "TV001\n38/45 (-7)\n↗ 47/45 (+2·42m)  ↘ 22/45 (-23·2h15)\n✕ 2h27",
    );
  });

  it("falls back to the base label when current data is incomplete", () => {
    expect(buildTvDcbGlanceLabel("TV001", null, 0)).toBe("TV001");
    expect(
      buildTvDcbGlanceLabel(
        "TV001",
        {
          current: null,
          trends: [],
          closure: null,
          metadata: null,
        },
        0,
      ),
    ).toBe("TV001");
  });

  it("reads the metadata bin size with a fallback", () => {
    expect(
      getSummaryTimeBinMinutes({
        current: null,
        trends: [],
        closure: null,
        metadata: {
          time_bin_minutes: 20,
          ref_time_str: "08:03:00",
          glance_horizon_minutes: 60,
        },
      }),
    ).toBe(20);
    expect(getSummaryTimeBinMinutes(null, 15)).toBe(15);
  });
});
