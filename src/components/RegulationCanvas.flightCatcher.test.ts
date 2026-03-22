import { describe, expect, it } from "vitest";

import {
  applyCatcherToRegulationTargets,
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
} from "../lib/flightCatcherPolicy";

describe("RegulationCanvas catcher behavior", () => {
  it("freezes first-click visibility and baseline eligibility", () => {
    const visibleAtGateStart = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["F1", "F2", "F3"],
      listDrivenEligibleFlightIds: ["F1", "F2", "F3", "F4"],
      focusMode: true,
      focusFlightIds: ["F1", "F2", "F3"],
    });
    const gateSnapshot = freezeGateSnapshot({
      createdAtSimTime: 10_000,
      contextMode: "tv_baseline",
      visibleFlightIds: visibleAtGateStart,
      baselineFlightIds: ["F2", "F3", "F4"],
    });

    expect(gateSnapshot.createdAtSimTime).toBe(10_000);

    // Completion occurs later; only first-click-eligible flights are still admitted.
    const capturedAtCompletion = ["F1", "F2", "F4"];
    const admitted = filterCapturedToGate(capturedAtCompletion, gateSnapshot);
    expect(admitted).toEqual(["F2"]);

    const nextTargets = applyCatcherToRegulationTargets({
      currentTargetFlightIds: ["F3"],
      capturedFlightIds: admitted,
      catcherMode: "include",
    });
    expect(Array.from(nextTargets)).toEqual(["F3", "F2"]);
  });

  it("gives proposal preview precedence over regulation preview before gate freeze", () => {
    const visibleAtGateStart = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["F1", "F2", "F3"],
      listDrivenEligibleFlightIds: ["F2", "Z9"],
      focusMode: true,
      focusFlightIds: ["F1", "F2", "F3"],
      proposalPreviewActive: true,
      proposalPreviewFlightIds: ["F2", "Z9"],
      regulationPreviewActive: true,
      regulationTargetFlightIds: ["F1", "F3"],
    });

    expect(visibleAtGateStart).toEqual(["F2", "Z9"]);
  });
});
