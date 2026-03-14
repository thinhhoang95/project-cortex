import { describe, expect, it } from "vitest";

import {
  aggregateFlightLevelBins,
  buildFlightLevelBinLabel,
  filterFlightLevelBinsToWindow,
  type FlightLevelCountBin,
} from "./flightLevelBinCounts";

const BASE_BINS: FlightLevelCountBin[] = [
  { start_fl: 0, end_fl: 10, count: 2 },
  { start_fl: 10, end_fl: 20, count: 3 },
  { start_fl: 20, end_fl: 30, count: 5 },
  { start_fl: 30, end_fl: 40, count: 7 },
  { start_fl: 40, end_fl: 50, count: 11 },
];

describe("flightLevelBinCounts", () => {
  it("formats flight level labels in the panel style", () => {
    expect(buildFlightLevelBinLabel(0, 10)).toBe("FL000-010");
    expect(buildFlightLevelBinLabel(450, 500)).toBe("FL450-500");
  });

  it("keeps the native 1000 ft bins intact", () => {
    const aggregated = aggregateFlightLevelBins({
      bins: BASE_BINS,
      binSizeFeet: 1000,
      rangeStartFl: 0,
      rangeEndFl: 50,
    });

    expect(aggregated).toHaveLength(5);
    expect(aggregated.map((row) => row.count)).toEqual([2, 3, 5, 7, 11]);
  });

  it("aggregates adjacent 1000 ft bins into larger client-side bands", () => {
    const aggregated = aggregateFlightLevelBins({
      bins: BASE_BINS,
      binSizeFeet: 2000,
      rangeStartFl: 0,
      rangeEndFl: 50,
    });

    expect(aggregated).toEqual([
      { key: "0-20", startFl: 0, endFl: 20, count: 5, label: "FL000-020" },
      { key: "20-40", startFl: 20, endFl: 40, count: 12, label: "FL020-040" },
      { key: "40-50", startFl: 40, endFl: 50, count: 11, label: "FL040-050" },
    ]);
  });

  it("fills missing aggregated bands with zero counts to keep the axis stable", () => {
    const sparseBins: FlightLevelCountBin[] = [
      { start_fl: 0, end_fl: 10, count: 4 },
      { start_fl: 30, end_fl: 40, count: 6 },
    ];

    const aggregated = aggregateFlightLevelBins({
      bins: sparseBins,
      binSizeFeet: 1000,
      rangeStartFl: 0,
      rangeEndFl: 40,
    });

    expect(aggregated.map((row) => row.count)).toEqual([4, 0, 0, 6]);
  });

  it("can omit empty aggregated bands for display", () => {
    const sparseBins: FlightLevelCountBin[] = [
      { start_fl: 0, end_fl: 10, count: 4 },
      { start_fl: 30, end_fl: 40, count: 6 },
    ];

    const aggregated = aggregateFlightLevelBins({
      bins: sparseBins,
      binSizeFeet: 1000,
      rangeStartFl: 0,
      rangeEndFl: 40,
      includeEmpty: false,
    });

    expect(aggregated.map((row) => row.label)).toEqual(["FL000-010", "FL030-040"]);
  });

  it("derives focus-window counts from overlapping segments", () => {
    const focused = filterFlightLevelBinsToWindow({
      bins: [
        {
          start_fl: 0,
          end_fl: 10,
          count: 99,
          segments: [
            { start_time_str: "06:00:00", end_time_str: "06:04:30", count: 1 },
            { start_time_str: "06:10:00", end_time_str: "06:12:00", count: 1 },
            { start_time_str: "06:20:00", end_time_str: "06:25:00", count: 4 },
          ],
        },
        {
          start_fl: 10,
          end_fl: 20,
          count: 88,
          segments: [
            { start_time_str: "06:03:00", end_time_str: "06:08:00", count: 2 },
          ],
        },
      ],
      windowStartSeconds: 6 * 3600,
      windowSeconds: 15 * 60,
    });

    expect(focused.map((bin) => bin.count)).toEqual([2, 2]);
  });
});
