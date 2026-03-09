import { describe, expect, it } from "vitest";

import {
  expandCapacityToHourlyProperties,
  getCapacityKeyForHourBin,
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
