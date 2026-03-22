import { describe, expect, it } from "vitest";

import {
  getFlightLevelLabelFromAltitudeFeet,
  resolveFlightLineLabelSelection,
} from "@/lib/flightLineLabels";

describe("flightLineLabels", () => {
  it("enables labels when switching to a different mode", () => {
    expect(resolveFlightLineLabelSelection("callsign", false, "flightLevel")).toEqual({
      nextMode: "flightLevel",
      nextShowFlightLineLabels: true,
    });
  });

  it("hides labels when reselecting the active visible mode", () => {
    expect(resolveFlightLineLabelSelection("callsign", true, "callsign")).toEqual({
      nextMode: "callsign",
      nextShowFlightLineLabels: false,
    });
  });

  it("re-enables labels when reselecting the active hidden mode", () => {
    expect(resolveFlightLineLabelSelection("flightLevel", false, "flightLevel")).toEqual({
      nextMode: "flightLevel",
      nextShowFlightLineLabels: true,
    });
  });

  it("formats representative flight levels from feet", () => {
    expect(getFlightLevelLabelFromAltitudeFeet(34000, 36000)).toBe("350");
    expect(getFlightLevelLabelFromAltitudeFeet(undefined, 35120)).toBe("351");
    expect(getFlightLevelLabelFromAltitudeFeet(undefined, undefined)).toBe("0");
  });
});
