import { describe, expect, it } from "vitest";

import {
  appendTrafficVolumeSelectionClauses,
  appendOrderedTrafficVolumes,
  formatTrafficVolumeSelectionExpression,
  getEffectiveTrafficVolumeSelectionClauses,
  getEffectiveTrafficVolumeSelectionIds,
  toggleTrafficVolumeSelectionClauses,
  toggleOrderedTrafficVolumes,
} from "./multiTrafficVolumeSelection";

describe("appendOrderedTrafficVolumes", () => {
  it("adds a new selection to the end without disturbing existing order", () => {
    expect(appendOrderedTrafficVolumes([], "TV_A")).toEqual({
      selectedTrafficVolumes: ["TV_A"],
      changed: true,
    });

    expect(appendOrderedTrafficVolumes(["TV_A"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      changed: true,
    });
  });

  it("keeps the current selection when the TV is already present", () => {
    expect(appendOrderedTrafficVolumes(["TV_A", "TV_B"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      changed: false,
    });
  });

  it("enforces the max selection limit", () => {
    expect(
      appendOrderedTrafficVolumes(["A", "B", "C", "D", "E"], "F", 5),
    ).toEqual({
      selectedTrafficVolumes: ["A", "B", "C", "D", "E"],
      changed: false,
      reason: "max_limit",
    });
  });
});

describe("toggleOrderedTrafficVolumes", () => {
  it("adds a new selection to the end", () => {
    expect(toggleOrderedTrafficVolumes([], "TV_A")).toEqual({
      selectedTrafficVolumes: ["TV_A"],
      changed: true,
    });

    expect(toggleOrderedTrafficVolumes(["TV_A"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      changed: true,
    });
  });

  it("removes an existing selection and preserves remaining order", () => {
    expect(toggleOrderedTrafficVolumes(["TV_A", "TV_B", "TV_C"], "TV_B")).toEqual({
      selectedTrafficVolumes: ["TV_A", "TV_C"],
      changed: true,
    });
  });

  it("promotes the next TV when removing the primary", () => {
    expect(toggleOrderedTrafficVolumes(["TV_A", "TV_B", "TV_C"], "TV_A")).toEqual({
      selectedTrafficVolumes: ["TV_B", "TV_C"],
      changed: true,
    });
  });

  it("enforces the max selection limit", () => {
    expect(
      toggleOrderedTrafficVolumes(["A", "B", "C", "D", "E"], "F", 5),
    ).toEqual({
      selectedTrafficVolumes: ["A", "B", "C", "D", "E"],
      changed: false,
      reason: "max_limit",
    });
  });
});

describe("toggleTrafficVolumeSelectionClauses", () => {
  it("creates a new AND clause for plain additions", () => {
    expect(toggleTrafficVolumeSelectionClauses([], "TV_A", "and")).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"]],
      selectedTrafficVolumes: ["TV_A"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });

    expect(
      toggleTrafficVolumeSelectionClauses([["TV_A"]], "TV_B", "and"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"], ["TV_B"]],
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });
  });

  it("adds OR members to the trailing clause", () => {
    expect(
      toggleTrafficVolumeSelectionClauses([["TV_A"], ["TV_B"]], "TV_C", "or"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"], ["TV_B", "TV_C"]],
      selectedTrafficVolumes: ["TV_A", "TV_B", "TV_C"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });
  });

  it("keeps the first reference clause singleton when OR is requested too early", () => {
    expect(
      toggleTrafficVolumeSelectionClauses([["TV_A"]], "TV_B", "or"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"], ["TV_B"]],
      selectedTrafficVolumes: ["TV_A", "TV_B"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });
  });

  it("toggles an existing TV off and collapses empty clauses", () => {
    expect(
      toggleTrafficVolumeSelectionClauses([["TV_A"], ["TV_B", "TV_C"]], "TV_B", "or"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"], ["TV_C"]],
      selectedTrafficVolumes: ["TV_A", "TV_C"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });

    expect(
      toggleTrafficVolumeSelectionClauses([["TV_A"], ["TV_B"]], "TV_A", "and"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_B"]],
      selectedTrafficVolumes: ["TV_B"],
      primaryTrafficVolumeId: "TV_B",
      changed: true,
    });
  });

  it("treats OR on an empty selection as a singleton clause", () => {
    expect(toggleTrafficVolumeSelectionClauses([], "TV_A", "or")).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"]],
      selectedTrafficVolumes: ["TV_A"],
      primaryTrafficVolumeId: "TV_A",
      changed: true,
    });
  });

  it("enforces the max limit across all distinct TVs", () => {
    expect(
      toggleTrafficVolumeSelectionClauses(
        [["A"], ["B", "C"], ["D", "E"]],
        "F",
        "or",
        5,
      ),
    ).toEqual({
      selectedTrafficVolumeClauses: [["A"], ["B", "C"], ["D", "E"]],
      selectedTrafficVolumes: ["A", "B", "C", "D", "E"],
      primaryTrafficVolumeId: "A",
      changed: false,
      reason: "max_limit",
    });
  });
});

describe("appendTrafficVolumeSelectionClauses", () => {
  it("does not remove an already-selected TV", () => {
    expect(
      appendTrafficVolumeSelectionClauses([["TV_A"], ["TV_B", "TV_C"]], "TV_B", "and"),
    ).toEqual({
      selectedTrafficVolumeClauses: [["TV_A"], ["TV_B", "TV_C"]],
      selectedTrafficVolumes: ["TV_A", "TV_B", "TV_C"],
      primaryTrafficVolumeId: "TV_A",
      changed: false,
    });
  });
});

describe("traffic volume selection helpers", () => {
  it("formats grouped selections as an expression", () => {
    expect(
      formatTrafficVolumeSelectionExpression([["TV_A"], ["TV_B", "TV_C"], ["TV_D"]]),
    ).toBe("TV_A AND (TV_B OR TV_C) AND TV_D");
  });

  it("derives effective clauses and ids from store-like inputs", () => {
    expect(
      getEffectiveTrafficVolumeSelectionClauses({
        selectedTrafficVolumeClauses: [["TV_A"], ["TV_B", "TV_C"]],
        selectedTrafficVolumes: ["TV_A", "TV_B", "TV_C"],
        selectedTrafficVolume: "TV_A",
      }),
    ).toEqual([["TV_A"], ["TV_B", "TV_C"]]);

    expect(
      getEffectiveTrafficVolumeSelectionIds({
        selectedTrafficVolumeClauses: [],
        selectedTrafficVolumes: ["TV_A", "TV_B"],
        selectedTrafficVolume: "TV_A",
      }),
    ).toEqual(["TV_A", "TV_B"]);
  });
});

