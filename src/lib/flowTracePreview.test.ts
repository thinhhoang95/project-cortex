import { describe, expect, it } from "vitest";

import {
  deriveFlowTracePreviewFlightIds,
  getFlowTracePreviewKey,
} from "./flowTracePreview";

describe("flow trace preview derivation", () => {
  it("uses list preview ids ahead of proposal previews", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        flightLinePreviewFlightIds: new Set(["L2", "L1"]),
        proposalPreviewActive: true,
        proposalPreviewFlightIds: ["P1", "P2"],
      }),
    ).toEqual(["L2", "L1"]);
  });

  it("uses hovered flow groups ahead of wider list previews", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        flightLinePreviewFlightIds: new Set(["L2", "L1"]),
        flowPreviewGroupId: "g",
        flowGroups: { g: ["G1", "G2"] },
      }),
    ).toEqual(["G1", "G2"]);
  });

  it("traces active proposal and regulation previews when they contain flows", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        proposalPreviewActive: true,
        proposalPreviewFlightIds: ["P1", "P2", "P1", ""],
      }),
    ).toEqual(["P1", "P2"]);

    expect(
      deriveFlowTracePreviewFlightIds({
        regulationPreviewActive: true,
        regulationTargetFlightIds: new Set(["R1", "R2"]),
      }),
    ).toEqual(["R1", "R2"]);
  });

  it("traces hovered flow groups unless a single flight is being previewed", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        flowPreviewGroupId: "g",
        flowGroups: { g: ["G1", "G2"] },
      }),
    ).toEqual(["G1", "G2"]);

    expect(
      deriveFlowTracePreviewFlightIds({
        flowPreviewFlightId: "G1",
        flowPreviewGroupId: "g",
        flowGroups: { g: ["G1", "G2"] },
      }),
    ).toEqual([]);
  });

  it("does not trace single-flight previews", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        flightLinePreviewFlightIds: new Set(["L1"]),
        flowPreviewGroupId: "g",
        flowGroups: { g: ["G1", "G2"] },
      }),
    ).toEqual([]);

    expect(
      deriveFlowTracePreviewFlightIds({
        proposalPreviewActive: true,
        proposalPreviewFlightIds: ["P1"],
      }),
    ).toEqual([]);
  });

  it("lets single-flight hover suppress a wider active preview", () => {
    expect(
      deriveFlowTracePreviewFlightIds({
        flowPreviewFlightId: "F1",
        flightLinePreviewFlightIds: new Set(["F1", "F2"]),
        flowPreviewGroupId: "g",
        flowGroups: { g: ["F1", "F2"] },
      }),
    ).toEqual([]);
  });

  it("uses a stable key for equivalent flight-id sets", () => {
    expect(getFlowTracePreviewKey(["B", "A", "B", ""])).toBe(getFlowTracePreviewKey(["A", "B"]));
  });
});
