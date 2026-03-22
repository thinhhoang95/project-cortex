import { describe, expect, it } from "vitest";

import {
  addMinutesToHHMM,
  formatSecondsToExtendedHHMM,
  formatSecondsToHHMM,
} from "@/lib/time";

describe("time", () => {
  it("wraps HH:MM formatting to the clock day", () => {
    expect(formatSecondsToHHMM(25 * 3600 + 15 * 60)).toBe("01:15");
    expect(formatSecondsToHHMM(24 * 3600)).toBe("00:00");
  });

  it("preserves extended-hour formatting for display-only use cases", () => {
    expect(formatSecondsToExtendedHHMM(25 * 3600 + 15 * 60)).toBe("25:15");
  });

  it("wraps HH:MM arithmetic across midnight", () => {
    expect(addMinutesToHHMM("23:30", 90)).toBe("01:00");
  });
});
