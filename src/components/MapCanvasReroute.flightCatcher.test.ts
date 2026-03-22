import { describe, expect, it } from "vitest";

import {
  applyCatcherToRerouteState,
  deriveVisibleFlightLineIds,
  filterCapturedToGate,
  freezeGateSnapshot,
} from "../lib/flightCatcherPolicy";

describe("MapCanvasReroute catcher behavior", () => {
  it("visible-only mode adds/removes rows using first-click visible flights", () => {
    const visibleAtGateStart = deriveVisibleFlightLineIds({
      activeInsideRangeFlightIds: ["R1", "R2"],
      focusMode: false,
      focusFlightIds: [],
    });
    const gateSnapshot = freezeGateSnapshot({
      createdAtSimTime: 20_000,
      contextMode: "visible_only",
      visibleFlightIds: visibleAtGateStart,
    });

    const admitted = filterCapturedToGate(["R1", "R3"], gateSnapshot);
    expect(admitted).toEqual(["R1"]);

    const next = applyCatcherToRerouteState({
      contextMode: gateSnapshot.contextMode,
      currentBaseFlightIds: ["R2"],
      currentSelectedFlightIds: ["R2"],
      capturedFlightIds: admitted,
      catcherMode: "include",
    });
    expect(next.nextBaseFlightIds).toEqual(["R2", "R1"]);
    expect(Array.from(next.nextSelectedFlightIds)).toEqual(["R2", "R1"]);
  });

  it("tv-baseline mode never adds rows and only toggles eligibility", () => {
    const gateSnapshot = freezeGateSnapshot({
      createdAtSimTime: 25_000,
      contextMode: "tv_baseline",
      visibleFlightIds: ["T1", "T2", "T3"],
      baselineFlightIds: ["T1", "T2"],
    });

    const admitted = filterCapturedToGate(["T1", "T3"], gateSnapshot);
    expect(admitted).toEqual(["T1"]);

    const next = applyCatcherToRerouteState({
      contextMode: gateSnapshot.contextMode,
      currentBaseFlightIds: ["T1", "T2"],
      currentSelectedFlightIds: ["T2"],
      capturedFlightIds: admitted,
      catcherMode: "include",
    });
    expect(next.nextBaseFlightIds).toEqual(["T1", "T2"]);
    expect(Array.from(next.nextSelectedFlightIds)).toEqual(["T2", "T1"]);
  });
});
