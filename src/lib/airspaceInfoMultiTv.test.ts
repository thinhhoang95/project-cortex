import { describe, expect, it } from "vitest";

import {
  buildMergedMultiTvChartRows,
  buildRollingChartDataFromOccupancy,
  compareIntersectionFlightRows,
  filterChartRowsByWindow,
  intersectStringSets,
  matchesSelectedTvTraversalOrder,
  type RollingChartDataPoint,
} from "./airspaceInfoMultiTv";

describe("airspaceInfoMultiTv", () => {
  it("builds rolling occupancy and derives capacity", () => {
    const { chartData, timeBinMinutes } = buildRollingChartDataFromOccupancy({
      occupancy_counts: {
        "00:00-00:30": 2,
        "00:30-01:00": 3,
      },
      hourly_capacity: {
        "00:00-01:00": 10,
      },
      metadata: { time_bin_minutes: 30 },
    });

    expect(timeBinMinutes).toBe(30);
    expect(chartData).toHaveLength(2);
    expect(chartData[0].count).toBe(5);
    expect(chartData[0].capacity).toBe(10);
    expect(chartData[1].count).toBe(3);
  });

  it("merges chart rows across TVs and fills missing values with null", () => {
    const aRows: RollingChartDataPoint[] = [
      { time: "00:00-00:15", hour: 0, count: 1, capacity: 2 },
      { time: "00:15-00:30", hour: 0.25, count: 2, capacity: 2 },
    ];
    const bRows: RollingChartDataPoint[] = [
      { time: "00:15-00:30", hour: 0.25, count: 3, capacity: 4 },
      { time: "00:30-00:45", hour: 0.5, count: 4, capacity: 4 },
    ];

    const merged = buildMergedMultiTvChartRows({
      selectedTvIds: ["TV_A", "TV_B"],
      chartDataByTv: { TV_A: aRows, TV_B: bRows },
      keyByTv: {
        TV_A: { countKey: "aCount", capacityKey: "aCap" },
        TV_B: { countKey: "bCount", capacityKey: "bCap" },
      },
    });

    expect(merged).toEqual([
      { time: "00:00-00:15", hour: 0, aCount: 1, aCap: 2, bCount: null, bCap: null },
      { time: "00:15-00:30", hour: 0.25, aCount: 2, aCap: 2, bCount: 3, bCap: 4 },
      { time: "00:30-00:45", hour: 0.5, bCount: 4, bCap: 4, aCount: null, aCap: null },
    ]);

    const filtered = filterChartRowsByWindow(merged, 0, 15 * 60);
    expect(filtered.map((r) => r.time)).toEqual(["00:00-00:15", "00:15-00:30"]);
  });

  it("intersects IDs and sorts by deterministic multi-TV rules", () => {
    expect(
      Array.from(intersectStringSets([new Set(["F1", "F2"]), new Set(["F2", "F3"])])),
    ).toEqual(["F2"]);

    const rows = [
      {
        flightId: "F2",
        perTv: {
          TV_A: { deltaSeconds: 100, arrivalSeconds: 1000, windowStartSeconds: null },
          TV_B: { deltaSeconds: 500, arrivalSeconds: 900, windowStartSeconds: null },
        },
      },
      {
        flightId: "F1",
        perTv: {
          TV_A: { deltaSeconds: -100, arrivalSeconds: 900, windowStartSeconds: null },
          TV_B: { deltaSeconds: 300, arrivalSeconds: 800, windowStartSeconds: null },
        },
      },
      {
        flightId: "F3",
        perTv: {
          TV_A: { deltaSeconds: null, arrivalSeconds: null, windowStartSeconds: 850 },
          TV_B: { deltaSeconds: null, arrivalSeconds: null, windowStartSeconds: 860 },
        },
      },
    ] as const;

    const sorted = [...rows].sort((a, b) => compareIntersectionFlightRows(a, b, "TV_A"));
    expect(sorted.map((r) => r.flightId)).toEqual(["F1", "F2", "F3"]);
  });

  it("checks selected TV traversal order using per-TV arrival metrics", () => {
    expect(
      matchesSelectedTvTraversalOrder(
        {
          TV_A: { deltaSeconds: 10, arrivalSeconds: 100, windowStartSeconds: null },
          TV_B: { deltaSeconds: 20, arrivalSeconds: 200, windowStartSeconds: null },
          TV_C: { deltaSeconds: 30, arrivalSeconds: 300, windowStartSeconds: null },
        },
        ["TV_A", "TV_B", "TV_C"],
      ),
    ).toBe(true);

    expect(
      matchesSelectedTvTraversalOrder(
        {
          TV_A: { deltaSeconds: 10, arrivalSeconds: 300, windowStartSeconds: null },
          TV_B: { deltaSeconds: 20, arrivalSeconds: 200, windowStartSeconds: null },
        },
        ["TV_A", "TV_B"],
      ),
    ).toBe(false);
  });

  it("falls back to time-window starts and tolerates missing timing data", () => {
    expect(
      matchesSelectedTvTraversalOrder(
        {
          TV_A: { deltaSeconds: null, arrivalSeconds: null, windowStartSeconds: 600 },
          TV_B: { deltaSeconds: null, arrivalSeconds: null, windowStartSeconds: 900 },
        },
        ["TV_A", "TV_B"],
      ),
    ).toBe(true);

    expect(
      matchesSelectedTvTraversalOrder(
        {
          TV_A: { deltaSeconds: null, arrivalSeconds: 600, windowStartSeconds: null },
          TV_B: { deltaSeconds: null, arrivalSeconds: null, windowStartSeconds: null },
          TV_C: { deltaSeconds: null, arrivalSeconds: 500, windowStartSeconds: null },
        },
        ["TV_A", "TV_B", "TV_C"],
      ),
    ).toBe(false);
  });
});
