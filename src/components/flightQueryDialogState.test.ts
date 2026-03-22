import { describe, expect, it } from "vitest";

import { flightIdListsEqual, shouldEnableReset } from "@/components/flightQueryDialogState";

describe("flightIdListsEqual", () => {
  it("returns true for identical ordered lists", () => {
    expect(flightIdListsEqual(["F1", "F2"], ["F1", "F2"])).toBe(true);
  });

  it("returns false when the lists differ by length or ordering", () => {
    expect(flightIdListsEqual(["F1"], ["F1", "F2"])).toBe(false);
    expect(flightIdListsEqual(["F1", "F2"], ["F2", "F1"])).toBe(false);
  });
});

describe("shouldEnableReset", () => {
  it("returns false without a baseline or while a request is in flight", () => {
    expect(
      shouldEnableReset({
        baselineFlightIds: [],
        resultFlightIds: ["F1"],
        isSubmitting: false,
        hasResponse: true,
        hasError: false,
      }),
    ).toBe(false);

    expect(
      shouldEnableReset({
        baselineFlightIds: ["F1", "F2"],
        resultFlightIds: ["F2"],
        isSubmitting: true,
        hasResponse: false,
        hasError: false,
      }),
    ).toBe(false);
  });

  it("returns true when the current result list differs from the baseline", () => {
    expect(
      shouldEnableReset({
        baselineFlightIds: ["F1", "F2"],
        resultFlightIds: ["F2"],
        isSubmitting: false,
        hasResponse: false,
        hasError: false,
      }),
    ).toBe(true);
  });

  it("returns true when a response exists even if the visible list matches the baseline", () => {
    expect(
      shouldEnableReset({
        baselineFlightIds: ["F1", "F2"],
        resultFlightIds: ["F1", "F2"],
        isSubmitting: false,
        hasResponse: true,
        hasError: false,
      }),
    ).toBe(true);
  });

  it("returns true when an error exists so the dialog can recover to baseline state", () => {
    expect(
      shouldEnableReset({
        baselineFlightIds: ["F1", "F2"],
        resultFlightIds: ["F1", "F2"],
        isSubmitting: false,
        hasResponse: false,
        hasError: true,
      }),
    ).toBe(true);
  });
});
