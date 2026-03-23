import { describe, expect, it } from "vitest";

import {
  OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
  computeOccupancyTvWindowStats,
  computeOccupancyWindowStatsByTv,
  getOccupancyWindowRange,
  scoreOccupancyTvWindowStats,
} from "./occupancyWindowStats";

describe("occupancyWindowStats", () => {
  it("computes total, absolute change, relative change, and exceedance for a window", () => {
    const range = getOccupancyWindowRange(15, 45, 15);
    const stats = computeOccupancyTvWindowStats({
      preSeries: [10, 10, 20, 20],
      postSeries: [20, 5, 25, 20],
      capacitySeries: [18, 4, 22, 50],
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      binMinutes: 15,
    });

    expect(stats).toEqual({
      total: 50,
      absChange: 10,
      relativeDelta: 10,
      relativeBase: 50,
      exceedance: 1,
      totalExcessReduced: 5,
      totalExcessInduced: 5,
      netDelta: 0,
      hasPreSeries: true,
      hasPostSeries: true,
    });
  });

  it("falls back to pre totals when post is unavailable", () => {
    const stats = computeOccupancyTvWindowStats({
      preSeries: [3, 4, 5],
      startIndex: 0,
      endIndex: 1,
      binMinutes: 15,
    });

    expect(stats).toEqual({
      total: 7,
      absChange: 0,
      relativeDelta: 0,
      relativeBase: 0,
      exceedance: 0,
      totalExcessReduced: 0,
      totalExcessInduced: 0,
      netDelta: 0,
      hasPreSeries: true,
      hasPostSeries: false,
    });
  });

  it("builds per-tv stats for sorting without requiring matching lengths", () => {
    const range = getOccupancyWindowRange(0, 30, 15);
    const statsByTv = computeOccupancyWindowStatsByTv({
      preCounts: {
        TV_A: [2, 2, 2],
        TV_B: [5, 5, 5],
      },
      postCounts: {
        TV_A: [6, 2, 1],
      },
      capacity: {
        TV_A: [4, 4, 4],
        TV_B: [3, 3, 3],
      },
      tvIds: ["TV_A", "TV_B"],
      windowRange: range,
      binMinutes: 15,
    });

    expect(statsByTv.TV_A).toMatchObject({
      total: 9,
      absChange: 5,
      relativeDelta: 5,
      relativeBase: 6,
      exceedance: 0.5,
      totalExcessReduced: 0,
      totalExcessInduced: 2,
      netDelta: 3,
      hasPreSeries: true,
      hasPostSeries: true,
    });
    expect(statsByTv.TV_B).toMatchObject({
      total: 15,
      absChange: 0,
      relativeDelta: 0,
      relativeBase: 0,
      exceedance: 1.5,
      totalExcessReduced: 0,
      totalExcessInduced: 0,
      netDelta: 0,
      hasPreSeries: true,
      hasPostSeries: false,
    });
  });

  it("ignores missing or hidden capacity bins when computing exceedance", () => {
    const stats = computeOccupancyTvWindowStats({
      preSeries: [1, 1],
      postSeries: [8, 8],
      capacitySeries: [1000, Number.NaN],
      startIndex: 0,
      endIndex: 1,
      binMinutes: 15,
      capacityHideThreshold: OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
    });

    expect(stats.exceedance).toBe(0);
    expect(stats.totalExcessReduced).toBe(0);
    expect(stats.totalExcessInduced).toBe(0);
  });

  it("counts excess reduction using bins that are over capacity before regulation", () => {
    const stats = computeOccupancyTvWindowStats({
      preSeries: [12, 5, 9],
      postSeries: [7, 3, 9],
      capacitySeries: [10, 4, 9],
      startIndex: 0,
      endIndex: 2,
      binMinutes: 15,
    });

    expect(stats.totalExcessReduced).toBe(7);
    expect(scoreOccupancyTvWindowStats(stats, "total_excess_reduced")).toBe(7);
  });

  it("counts excess induction using bins that are over capacity after regulation", () => {
    const stats = computeOccupancyTvWindowStats({
      preSeries: [8, 6, 5],
      postSeries: [11, 9, 5],
      capacitySeries: [10, 8, 7],
      startIndex: 0,
      endIndex: 2,
      binMinutes: 15,
    });

    expect(stats.totalExcessInduced).toBe(6);
    expect(scoreOccupancyTvWindowStats(stats, "total_excess_induced")).toBe(6);
  });

  it("returns zero excess-reduced and excess-induced scores without both pre and post series", () => {
    const stats = computeOccupancyTvWindowStats({
      postSeries: [4, 5, 6],
      capacitySeries: [3, 3, 3],
      startIndex: 0,
      endIndex: 2,
      binMinutes: 15,
    });

    expect(scoreOccupancyTvWindowStats(stats, "total_excess_reduced")).toBe(0);
    expect(scoreOccupancyTvWindowStats(stats, "total_excess_induced")).toBe(0);
  });
});
