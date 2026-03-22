import { describe, expect, it } from "vitest";

import {
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
} from "../lib/flightCatcherPolicy";

describe("FlowCanvas catcher behavior", () => {
  it("uses shared visible-line precedence with proposal preview and baseline clamp", () => {
    const visibleAtGateStart = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["A", "B", "C"],
      listDrivenEligibleFlightIds: ["A", "B", "Z"],
      focusMode: true,
      focusFlightIds: ["A", "Z"],
      proposalPreviewActive: true,
      proposalPreviewFlightIds: ["B", "Z"],
    });

    // Proposal preview wins over focus; inactive but eligible flights stay visible.
    expect(visibleAtGateStart).toEqual(["B", "Z"]);

    const gateSnapshot = freezeGateSnapshot({
      createdAtSimTime: 15_000,
      contextMode: "tv_baseline",
      visibleFlightIds: visibleAtGateStart,
      baselineFlightIds: ["B", "C"],
    });

    const admitted = filterCapturedToGate(["A", "B", "C"], gateSnapshot);
    expect(admitted).toEqual(["B"]);
    expect(gateSnapshot.createdAtSimTime).toBe(15_000);
  });
});
