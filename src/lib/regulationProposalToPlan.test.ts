import { describe, expect, it } from "vitest";

import { buildRegulationDraftFromProposalFlow } from "./regulationProposalToPlan";
import type { RegulationProposal } from "./regulationProposals";

function makeProposal(): RegulationProposal {
  return {
    id: "RP-01",
    hotspot: {
      traffic_volume_id: "TV-HOTSPOT",
      input_time_window: "09:00-11:00",
      timebins: [36, 37, 38, 39],
    },
    control_window: {
      bins: [36, 37],
      label: "09:00-09:30",
    },
    objective_improvement: {
      delta_deficit_per_hour: 12,
      delta_objective_score: 4.5,
    },
    objective_components: {
      before: {},
      after: {},
      delta: {},
    },
    flows: [
      {
        flow_id: 7,
        flight_ids: ["F1", "F2", "F3"],
        control_volume_id: "TV-FLOW",
        baseline_rate_per_hour: 40,
        allowed_rate_per_hour: 32,
        assigned_cut_per_hour: 8,
        time_window_label: "09:15-09:45",
        time_window_bins: [37, 38],
        features: {},
        final_score: 1,
      },
    ],
  };
}

describe("regulationProposalToPlan", () => {
  it("builds one regulation draft per proposal flow using flow-specific values", () => {
    const proposal = makeProposal();
    const draft = buildRegulationDraftFromProposalFlow({
      proposal,
      flow: proposal.flows[0],
      currentContext: { resourceDate: "2026-03-21", resourceStateId: "rs-1" },
    });

    expect(draft).toMatchObject({
      trafficVolume: "TV-FLOW",
      activeTimeWindowFrom: 9 * 3600 + 15 * 60,
      activeTimeWindowTo: 9 * 3600 + 45 * 60,
      flightIds: ["F1", "F2", "F3"],
      resourceDate: "2026-03-21",
      resourceStateId: "rs-1",
      rate: 32,
      proposalSource: {
        kind: "proposal",
        proposalId: "RP-01",
        flowId: "7",
      },
    });
  });

  it("filters review selections to the current flow flight ids", () => {
    const proposal = makeProposal();
    const draft = buildRegulationDraftFromProposalFlow({
      proposal,
      flow: proposal.flows[0],
      currentContext: { resourceDate: "2026-03-21", resourceStateId: null },
      selectedFlightIds: ["F2", "Z9", "F2"],
    });

    expect(draft.flightIds).toEqual(["F2"]);
  });

  it("falls back to hotspot TV and query time window when flow-level fields are missing", () => {
    const proposal = makeProposal();
    const flow = {
      ...proposal.flows[0],
      control_volume_id: null,
      time_window_label: "",
    };

    const draft = buildRegulationDraftFromProposalFlow({
      proposal: {
        ...proposal,
        control_window: { bins: [], label: "" },
      },
      flow,
      currentContext: { resourceDate: "2026-03-21", resourceStateId: "rs-2" },
      fallbackQueryTimeWindow: "10:00-11:00",
    });

    expect(draft.trafficVolume).toBe("TV-HOTSPOT");
    expect(draft.activeTimeWindowFrom).toBe(10 * 3600);
    expect(draft.activeTimeWindowTo).toBe(11 * 3600);
  });

  it("rejects drafts without replayable regulation context", () => {
    const proposal = makeProposal();
    expect(() =>
      buildRegulationDraftFromProposalFlow({
        proposal,
        flow: proposal.flows[0],
        currentContext: { resourceDate: null, resourceStateId: null },
      }),
    ).toThrow(/resource date/i);
  });
});
