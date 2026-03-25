import { describe, expect, it } from "vitest";

import {
  buildNetworkStatusDelayCauseRows,
  buildNetworkStatusDelayHistogramRows,
  computeAverageDelayMinutes,
  findSelectedResourceState,
} from "@/lib/networkStatus";

describe("networkStatus", () => {
  it("builds histogram rows in API bin order and zero-fills missing buckets", () => {
    expect(
      buildNetworkStatusDelayHistogramRows(
        [
          { key: "15-30", label: "15-30", min_inclusive: 15, max_exclusive: 30 },
          { key: "0-15", label: "0-15", min_inclusive: 0, max_exclusive: 15 },
          { key: ">=90", label: ">=90", min_inclusive: 90, max_exclusive: null },
        ],
        {
          "0-15": 4,
          ">=90": 1,
        },
      ),
    ).toEqual([
      { bucket: "15-30", count: 0 },
      { bucket: "0-15", count: 4 },
      { bucket: ">=90", count: 1 },
    ]);
  });

  it("selects the currently selected state even when the head differs", () => {
    const selectedState = findSelectedResourceState(
      [
        {
          state_id: "state-0000",
          parent_state_id: null,
          episode_index: 0,
          label: "State Zero",
          num_affected_flights: 0,
          num_delayed_flights: 0,
          total_incremental_delay_minutes: 0,
          total_cumulative_delay_minutes: 0,
          cumulative_delay_histogram: { "0-15": 0 },
          is_selected: false,
          is_head: false,
          is_state_zero: true,
        },
        {
          state_id: "state-0001",
          parent_state_id: "state-0000",
          episode_index: 1,
          label: "Older episode",
          num_affected_flights: 2,
          num_delayed_flights: 2,
          total_incremental_delay_minutes: 10,
          total_cumulative_delay_minutes: 10,
          cumulative_delay_histogram: { "0-15": 2 },
          is_selected: true,
          is_head: false,
          is_state_zero: false,
        },
        {
          state_id: "state-0002",
          parent_state_id: "state-0001",
          episode_index: 2,
          label: "Head episode",
          num_affected_flights: 3,
          num_delayed_flights: 3,
          total_incremental_delay_minutes: 12,
          total_cumulative_delay_minutes: 22,
          cumulative_delay_histogram: { "0-15": 1, "15-30": 1 },
          is_selected: false,
          is_head: true,
          is_state_zero: false,
        },
      ],
      "state-0001",
    );

    expect(selectedState?.state_id).toBe("state-0001");
    expect(selectedState?.cumulative_delay_histogram).toEqual({ "0-15": 2 });
  });

  it("builds placeholder cause rows with unavailable delay minutes", () => {
    expect(buildNetworkStatusDelayCauseRows().slice(0, 3)).toEqual([
      { cause: "Weather", delayMinutes: null },
      { cause: "ATC Staffing", delayMinutes: null },
      { cause: "Runway Congestion", delayMinutes: null },
    ]);
  });

  it("computes average delay per flight with one decimal place", () => {
    expect(computeAverageDelayMinutes(49, 20)).toBe(2.5);
    expect(computeAverageDelayMinutes(0, 20)).toBe(0);
    expect(computeAverageDelayMinutes(49, 0)).toBe(0);
  });
});
