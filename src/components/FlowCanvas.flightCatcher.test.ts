import { describe, expect, it } from "vitest";

import {
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
} from "../lib/flightCatcherPolicy";

describe("FlowCanvas catcher behavior", () => {
  it("uses shared visible-line precedence with proposal preview and baseline clamp", () => {
    const visibleAtGateStart = deriveVisibleFlightLineIds({
      insideRangeActiveFlightIds: ["A", "B", "C"],
      focusMode: true,
      focusFlightIds: ["A", "Z"],
      proposalPreviewActive: true,
      proposalPreviewFlightIds: ["B", "Z"],
      clampToActiveSet: true,
    });

    // Proposal preview wins over focus, then active-set clamp removes Z.
    expect(visibleAtGateStart).toEqual(["B"]);

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
