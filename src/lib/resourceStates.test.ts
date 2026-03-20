import { describe, expect, it } from "vitest";

import type { Trajectory } from "@/lib/models";
import {
  applyCumulativeDelaysToTrajectories,
  buildResourceStateSyncPayload,
  computeTrajectoryRange,
} from "@/lib/resourceStates";

function buildTrajectory(flightId: string, times: number[]): Trajectory {
  return {
    flightId,
    callSign: flightId,
    origin: "LFPG",
    destination: "EHAM",
    coords: times.map((_, index) => [index, index, 30000] as [number, number, number]),
    t0: times[0] ?? 0,
    t1: times[times.length - 1] ?? 0,
    times,
  };
}

describe("resourceStates", () => {
  it("applies cumulative delay minutes exactly to local trajectories", () => {
    const baseline = [
      buildTrajectory("FLIGHT_001", [100, 200, 300]),
      buildTrajectory("FLIGHT_002", [400, 500, 600]),
    ];

    const delayed = applyCumulativeDelaysToTrajectories(baseline, {
      FLIGHT_001: 12,
    });

    expect(delayed[0]?.t0).toBe(100 + 12 * 60);
    expect(delayed[0]?.t1).toBe(300 + 12 * 60);
    expect(delayed[0]?.times).toEqual([100 + 12 * 60, 200 + 12 * 60, 300 + 12 * 60]);
    expect(delayed[1]).toBe(baseline[1]);
  });

  it("computes trajectory range from delayed flights", () => {
    const range = computeTrajectoryRange([
      buildTrajectory("A", [900, 1200]),
      buildTrajectory("B", [120, 480]),
    ]);

    expect(range).toEqual([120, 1200]);
  });

  it("builds sync payloads from context summaries plus selected history delays", () => {
    const payload = buildResourceStateSyncPayload(
      {
        selected_date: "2023-07-18",
        selected_state_id: "state-0002",
        head_state_id: "state-0002",
        state_zero_id: "state-0000",
        num_states: 3,
        state_history_generation: 4,
        states: [
          {
            state_id: "state-0000",
            parent_state_id: null,
            episode_index: 0,
            label: "State Zero",
            num_affected_flights: 0,
            num_delayed_flights: 0,
            total_incremental_delay_minutes: 0,
            total_cumulative_delay_minutes: 0,
            is_selected: false,
            is_head: false,
            is_state_zero: true,
          },
          {
            state_id: "state-0002",
            parent_state_id: "state-0001",
            episode_index: 2,
            label: "Second wave",
            num_affected_flights: 2,
            num_delayed_flights: 4,
            total_incremental_delay_minutes: 15,
            total_cumulative_delay_minutes: 49,
            is_selected: true,
            is_head: true,
            is_state_zero: false,
          },
        ],
      },
      {
        resource_date: "2023-07-18",
        state_zero_id: "state-0000",
        selected_state_id: "state-0002",
        head_state_id: "state-0002",
        num_states: 3,
        state_history_generation: 4,
        states: [
          {
            state_id: "state-0002",
            parent_state_id: "state-0001",
            episode_index: 2,
            label: "Second wave",
            num_affected_flights: 2,
            num_delayed_flights: 4,
            total_incremental_delay_minutes: 15,
            total_cumulative_delay_minutes: 49,
            is_selected: true,
            is_head: true,
            is_state_zero: false,
            cumulative_delays_min: {
              FLIGHT_001: 12,
              FLIGHT_002: 12,
            },
          },
        ],
      },
    );

    expect(payload.selectedStateId).toBe("state-0002");
    expect(payload.selectedCumulativeDelaysMin).toEqual({
      FLIGHT_001: 12,
      FLIGHT_002: 12,
    });
    expect(payload.states).toHaveLength(2);
  });
});
