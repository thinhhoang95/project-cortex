import { describe, expect, it } from "vitest";

import type {
  AutomaticRateAdjustmentResponse,
  RegulationPlanSimulationResponse,
  Trajectory,
} from "@/lib/models";
import { buildResourceStateHistoryCommitFromFlowOptimization, buildResourceStateHistoryCommitFromSimulation } from "@/lib/regulationStateCommit";

function buildTrajectory(flightId: string, callSign?: string): Trajectory {
  return {
    flightId,
    callSign: callSign ?? flightId,
    origin: "LFPG",
    destination: "EHAM",
    coords: [
      [0, 0, 30000],
      [1, 1, 30000],
    ],
    t0: 100,
    t1: 200,
    times: [100, 200],
  };
}

function buildSimulationResult(
  delaysByFlight: Record<string, number | string>,
): RegulationPlanSimulationResponse {
  return {
    delays_by_flight: delaysByFlight as Record<string, number>,
    delay_stats: {
      total_delay_minutes: 17,
      total_delay_seconds: 17 * 60,
      mean_delay_minutes: 8.5,
      mean_delay_seconds: 8.5 * 60,
      max_delay_minutes: 12,
      max_delay_seconds: 12 * 60,
      min_delay_minutes: 5,
      min_delay_seconds: 5 * 60,
      num_delayed: 2,
      num_flights: 2,
    },
    objective: 1,
    objective_components: {},
    metadata: {
      time_bin_minutes: 15,
      bins_per_tv: 96,
      bins_per_hour: 4,
      num_traffic_volumes: 1,
    },
  };
}

function buildOptimizationResult(
  delaysMin: Record<string, number | string>,
): AutomaticRateAdjustmentResponse {
  return {
    num_time_bins: 96,
    tvs: ["TV-ALPHA", "TV-BETA"],
    target_cells: [["TV-ALPHA", 28]],
    ripple_cells: [["TV-BETA", 29]],
    flows: [
      {
        flow_id: 1,
        controlled_volume: "TV-CTRL",
        n0: [0, 1],
        demand: [1],
        n_opt: [0, 1],
        target_demands: { "TV-ALPHA": [1] },
      },
    ],
    delays_min: delaysMin as Record<string, number>,
    objective_baseline: { score: 100, components: { J_cap: 90, J_delay: 10 } },
    objective_optimized: { score: 80, components: { J_cap: 70, J_delay: 10 } },
    improvement: { absolute: 20, percent: 20 },
  };
}

describe("regulationStateCommit", () => {
  it("builds a commit payload from simulated delays and regulation metadata", () => {
    const payload = buildResourceStateHistoryCommitFromSimulation({
      parentStateId: "state-0002",
      regulations: [
        {
          trafficVolume: "TV-ALPHA",
          activeTimeWindowFrom: 9 * 3600,
          activeTimeWindowTo: 10 * 3600 + 15 * 60,
          rate: 18,
          flightIds: ["FLIGHT_001", "FLIGHT_002"],
          flightCallsigns: ["CS100", "CS200"],
        },
      ],
      result: buildSimulationResult({
        CS100: 12,
        FLIGHT_002: "5",
        FLIGHT_003: 0,
      }),
      flights: [
        buildTrajectory("FLIGHT_001", "CS100"),
        buildTrajectory("FLIGHT_002", "CS200"),
      ],
    });

    expect(payload).toMatchObject({
      parent_state_id: "state-0002",
      label: "TV-ALPHA 09:00-10:15",
      delays_min: {
        FLIGHT_001: 12,
        FLIGHT_002: 5,
      },
      metadata: {
        source: "regulation_results",
        num_regulations: 1,
      },
    });
  });

  it("rejects non-integer delay values so commit stays exact", () => {
    expect(() =>
      buildResourceStateHistoryCommitFromSimulation({
        parentStateId: "state-0002",
        regulations: [],
        result: buildSimulationResult({
          FLIGHT_001: 12.5,
        }),
        flights: [buildTrajectory("FLIGHT_001")],
      }),
    ).toThrow(/integer number of minutes/);
  });

  it("rejects commits with no positive delays", () => {
    expect(() =>
      buildResourceStateHistoryCommitFromSimulation({
        parentStateId: "state-0002",
        regulations: [],
        result: buildSimulationResult({
          FLIGHT_001: 0,
        }),
        flights: [buildTrajectory("FLIGHT_001")],
      }),
    ).toThrow(/No positive delay assignments/);
  });

  it("rejects ambiguous callsign delay assignments", () => {
    expect(() =>
      buildResourceStateHistoryCommitFromSimulation({
        parentStateId: "state-0002",
        regulations: [],
        result: buildSimulationResult({
          DUP: 7,
        }),
        flights: [
          buildTrajectory("FLIGHT_001", "DUP"),
          buildTrajectory("FLIGHT_002", "DUP"),
        ],
      }),
    ).toThrow(/ambiguous/);
  });

  it("builds a commit payload from flow optimization delays and target windows", () => {
    const payload = buildResourceStateHistoryCommitFromFlowOptimization({
      parentStateId: "state-0009",
      input: {
        flows: {
          0: ["FLIGHT_001", "FLIGHT_002"],
        },
        targets: {
          "TV-BETA": { from: "08:00", to: "09:00" },
          "TV-ALPHA": { from: "07:15", to: "08:30" },
        },
      },
      result: buildOptimizationResult({
        FLOW100: 9,
        FLIGHT_002: "4",
      }),
      flights: [
        buildTrajectory("FLIGHT_001", "FLOW100"),
        buildTrajectory("FLIGHT_002", "FLOW200"),
      ],
    });

    expect(payload).toMatchObject({
      parent_state_id: "state-0009",
      label: "TV-ALPHA 07:15-08:30 +1 more",
      delays_min: {
        FLIGHT_001: 9,
        FLIGHT_002: 4,
      },
      metadata: {
        source: "flow_evaluation",
        num_targets: 2,
        num_flows: 1,
        num_delayed_flights: 2,
        controlled_volumes: ["TV-CTRL"],
        objective_baseline_score: 100,
        objective_optimized_score: 80,
      },
    });
  });
});
