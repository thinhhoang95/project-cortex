import { describe, expect, it } from "vitest";

import {
  expandCapacityToHourlyProperties,
  getCapacityKeyForHourBin,
  getCapacityValueAtMinute,
  normalizeTrafficVolumeFeatureProperties,
} from "./airspaceDisplay";

describe("expandCapacityToHourlyProperties", () => {
  it("expands a full-day capacity slot into all hourly bins", () => {
    const expanded = expandCapacityToHourlyProperties({
      "00:00-24:00": 52,
    });

    expect(expanded[getCapacityKeyForHourBin("00:00-01:00")]).toBe(52);
    expect(expanded[getCapacityKeyForHourBin("12:00-13:00")]).toBe(52);
    expect(expanded[getCapacityKeyForHourBin("23:00-24:00")]).toBe(52);
  });

  it("lets narrower ranges override broader fallback slots", () => {
    const expanded = expandCapacityToHourlyProperties({
      "00:00-24:00": 52,
      "12:00-13:00": 41,
      "13:00-14:00": 39,
    });

    expect(expanded[getCapacityKeyForHourBin("11:00-12:00")]).toBe(52);
    expect(expanded[getCapacityKeyForHourBin("12:00-13:00")]).toBe(41);
    expect(expanded[getCapacityKeyForHourBin("13:00-14:00")]).toBe(39);
    expect(expanded[getCapacityKeyForHourBin("14:00-15:00")]).toBe(52);
  });

  it("expands wrap-around ranges across midnight", () => {
    const expanded = expandCapacityToHourlyProperties({
      "22:30-01:30": 18,
    });

    expect(expanded[getCapacityKeyForHourBin("22:00-23:00")]).toBe(18);
    expect(expanded[getCapacityKeyForHourBin("23:00-24:00")]).toBe(18);
    expect(expanded[getCapacityKeyForHourBin("00:00-01:00")]).toBe(18);
    expect(expanded[getCapacityKeyForHourBin("01:00-02:00")]).toBe(18);
    expect(expanded[getCapacityKeyForHourBin("02:00-03:00")]).toBeUndefined();
  });
});

describe("getCapacityValueAtMinute", () => {
  it("treats slot ends as exclusive so mid-hour closures take effect immediately", () => {
    const capacity = {
      "00:00-04:30": 37,
      "04:30-22:00": 9999,
      "22:00-24:00": 48,
    };

    expect(getCapacityValueAtMinute(capacity, 4 * 60 + 29)).toBe(37);
    expect(getCapacityValueAtMinute(capacity, 4 * 60 + 30)).toBe(9999);
    expect(getCapacityValueAtMinute(capacity, 4 * 60 + 50)).toBe(9999);
    expect(getCapacityValueAtMinute(capacity, 22 * 60)).toBe(48);
  });

  it("supports wrap-around ranges across midnight", () => {
    const capacity = {
      "22:30-01:30": 18,
      "01:30-22:30": 9999,
    };

    expect(getCapacityValueAtMinute(capacity, 23 * 60)).toBe(18);
    expect(getCapacityValueAtMinute(capacity, 60)).toBe(18);
    expect(getCapacityValueAtMinute(capacity, 90)).toBe(9999);
  });
});

describe("normalizeTrafficVolumeFeatureProperties", () => {
  it("stores exact capacity slot boundaries for partial-hour filtering", () => {
    const normalized = normalizeTrafficVolumeFeatureProperties({
      traffic_volume_id: "LFBRL",
      capacity: {
        "00:00-04:30": 37,
        "04:30-22:00": 9999,
        "22:00-24:00": 48,
      },
    }, { maxCapacityRangeCount: 4 });

    expect(normalized.capacity_range_count).toBe(3);
    expect(normalized.capacity_start_min_0).toBe(0);
    expect(normalized.capacity_end_min_0).toBe(270);
    expect(normalized.capacity_value_0).toBe(37);
    expect(normalized.capacity_start_min_1).toBe(270);
    expect(normalized.capacity_end_min_1).toBe(1320);
    expect(normalized.capacity_value_1).toBe(9999);
    expect(normalized.capacity_start_min_2).toBe(1320);
    expect(normalized.capacity_end_min_2).toBe(1440);
    expect(normalized.capacity_value_2).toBe(48);
    expect(normalized.capacity_start_min_3).toBe(-1);
    expect(normalized.capacity_end_min_3).toBe(-1);
    expect(normalized.capacity_value_3).toBe(9999);
  });
});
