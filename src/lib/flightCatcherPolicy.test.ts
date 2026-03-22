import { describe, expect, it } from "vitest";

import {
  applyCatcherToRegulationTargets,
  applyCatcherToRerouteState,
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
} from "./flightCatcherPolicy";

describe("freezeGateSnapshot", () => {
  it("freezes visible-only eligibility without baseline filtering", () => {
    const snapshot = freezeGateSnapshot({
      createdAtSimTime: 3600,
      contextMode: "visible_only",
      visibleFlightIds: ["F1", "F2", "F2", ""],
    });

    expect(snapshot.createdAtSimTime).toBe(3600);
    expect(snapshot.contextMode).toBe("visible_only");
    expect(Array.from(snapshot.eligibleFlightIds)).toEqual(["F1", "F2"]);
  });

  it("intersects visible ids with baseline ids in tv-baseline mode", () => {
    const snapshot = freezeGateSnapshot({
      createdAtSimTime: 7200,
      contextMode: "tv_baseline",
      visibleFlightIds: ["F1", "F2", "F3"],
      baselineFlightIds: ["F2", "F4"],
    });

    expect(snapshot.createdAtSimTime).toBe(7200);
    expect(Array.from(snapshot.eligibleFlightIds)).toEqual(["F2"]);
  });
});

describe("filterCapturedToGate", () => {
  it("returns only captured ids admitted by the frozen gate snapshot", () => {
    const snapshot = freezeGateSnapshot({
      createdAtSimTime: 9000,
      contextMode: "tv_baseline",
      visibleFlightIds: ["A", "B", "C"],
      baselineFlightIds: ["A", "C"],
    });

    const filtered = filterCapturedToGate(["A", "B", "C", "Z"], snapshot);
    expect(filtered).toEqual(["A", "C"]);
  });
});

describe("applyCatcherToRegulationTargets", () => {
  it("adds ids on include and removes ids on exclude", () => {
    const added = applyCatcherToRegulationTargets({
      currentTargetFlightIds: ["F1"],
      capturedFlightIds: ["F2", "F3"],
      catcherMode: "include",
    });
    expect(Array.from(added)).toEqual(["F1", "F2", "F3"]);

    const removed = applyCatcherToRegulationTargets({
      currentTargetFlightIds: added,
      capturedFlightIds: ["F2"],
      catcherMode: "exclude",
    });
    expect(Array.from(removed)).toEqual(["F1", "F3"]);
  });
});

describe("applyCatcherToRerouteState", () => {
  it("adds/removes rows in visible-only mode", () => {
    const included = applyCatcherToRerouteState({
      contextMode: "visible_only",
      currentBaseFlightIds: ["A", "B"],
      currentSelectedFlightIds: ["A", "B"],
      capturedFlightIds: ["C"],
      catcherMode: "include",
    });
    expect(included.nextBaseFlightIds).toEqual(["A", "B", "C"]);
    expect(Array.from(included.nextSelectedFlightIds)).toEqual(["A", "B", "C"]);

    const excluded = applyCatcherToRerouteState({
      contextMode: "visible_only",
      currentBaseFlightIds: included.nextBaseFlightIds,
      currentSelectedFlightIds: included.nextSelectedFlightIds,
      capturedFlightIds: ["B"],
      catcherMode: "exclude",
    });
    expect(excluded.nextBaseFlightIds).toEqual(["A", "C"]);
    expect(Array.from(excluded.nextSelectedFlightIds)).toEqual(["A", "C"]);
  });

  it("keeps baseline rows fixed in tv-baseline mode and only toggles selection", () => {
    const includeOnlySelection = applyCatcherToRerouteState({
      contextMode: "tv_baseline",
      currentBaseFlightIds: ["A", "B", "C"],
      currentSelectedFlightIds: ["A"],
      capturedFlightIds: ["B", "Z"],
      catcherMode: "include",
    });
    expect(includeOnlySelection.nextBaseFlightIds).toEqual(["A", "B", "C"]);
    expect(Array.from(includeOnlySelection.nextSelectedFlightIds)).toEqual(["A", "B"]);

    const excludeOnlySelection = applyCatcherToRerouteState({
      contextMode: "tv_baseline",
      currentBaseFlightIds: ["A", "B", "C"],
      currentSelectedFlightIds: ["A", "B", "C"],
      capturedFlightIds: ["B"],
      catcherMode: "exclude",
    });
    expect(excludeOnlySelection.nextBaseFlightIds).toEqual(["A", "B", "C"]);
    expect(Array.from(excludeOnlySelection.nextSelectedFlightIds)).toEqual(["A", "C"]);
  });
});

describe("deriveVisibleFlightLineIds", () => {
  it("respects preview and flow precedence, then filters list-driven modes through shared eligibility", () => {
    const visibleFromFlightLinePreview = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["A", "B", "C"],
      listDrivenEligibleFlightIds: ["A", "B", "D"],
      focusMode: true,
      focusFlightIds: ["A", "B", "D"],
      flightLinePreviewFlightIds: ["D", "E"],
      flowPreviewGroupId: "group-1",
      flowGroups: { "group-1": ["B", "D"] },
    });
    expect(visibleFromFlightLinePreview).toEqual(["D"]);

    const visibleFromFlowPreview = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["A", "B", "C"],
      listDrivenEligibleFlightIds: ["A", "B", "D"],
      focusMode: true,
      focusFlightIds: ["A", "B", "D"],
      flowPreviewGroupId: "group-1",
      flowGroups: { "group-1": ["B", "D"] },
    });
    expect(visibleFromFlowPreview).toEqual(["B", "D"]);

    const visibleFromFocus = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["A", "B", "C"],
      listDrivenEligibleFlightIds: ["A", "D"],
      focusMode: true,
      focusFlightIds: ["A", "D"],
    });
    expect(visibleFromFocus).toEqual(["A", "D"]);
  });
});
