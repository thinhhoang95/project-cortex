import { beforeEach, describe, expect, it } from "vitest";

import type { ResourceStateSyncPayload } from "@/lib/resourceStates";

import { useSimStore } from "./useSimStore";

const RESOURCE_STATE_PAYLOAD: ResourceStateSyncPayload = {
  resourceDate: "2023-07-17",
  selectedStateId: "state-0001",
  headStateId: "state-0001",
  stateZeroId: "state-0000",
  numStates: 2,
  stateHistoryGeneration: 1,
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
      state_id: "state-0001",
      parent_state_id: "state-0000",
      episode_index: 1,
      label: "Morning mitigation",
      num_affected_flights: 1,
      num_delayed_flights: 1,
      total_incremental_delay_minutes: 12,
      total_cumulative_delay_minutes: 12,
      is_selected: true,
      is_head: true,
      is_state_zero: false,
    },
  ],
  selectedCumulativeDelaysMin: {
    FLIGHT_001: 12,
  },
};

describe("useSimStore resourceDate", () => {
  beforeEach(() => {
    useSimStore.getState().clearResourceDate();
    useSimStore.getState().clearResourceState();
    useSimStore.getState().resetAll();
  });

  it("stores the canonical ISO resource date", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    expect(useSimStore.getState().resourceDate).toBe("2023-07-17");
  });

  it("preserves resourceDate across resetAll", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    useSimStore.getState().syncResourceState(RESOURCE_STATE_PAYLOAD);
    useSimStore.getState().setShowFlightLines(false);
    useSimStore.getState().setFlightLineLabelMode("flightLevel");

    useSimStore.getState().resetAll();

    expect(useSimStore.getState().resourceDate).toBe("2023-07-17");
    expect(useSimStore.getState().resourceStateSelectedId).toBe("state-0001");
    expect(useSimStore.getState().showFlightLines).toBe(true);
    expect(useSimStore.getState().flightLineLabelMode).toBe("callsign");
  });

  it("can clear an invalid persisted resource date", () => {
    useSimStore.getState().setResourceDate("2023-07-17");
    useSimStore.getState().clearResourceDate();
    expect(useSimStore.getState().resourceDate).toBeNull();
  });

  it("materializes delayed flights from the selected resource state", () => {
    useSimStore.getState().syncResourceState(RESOURCE_STATE_PAYLOAD);

    const delayedFlights = useSimStore.getState().setBaselineFlights([
      {
        flightId: "FLIGHT_001",
        callSign: "AFR001",
        origin: "LFPG",
        destination: "EHAM",
        coords: [[1, 1, 30000], [2, 2, 30000]],
        t0: 120,
        t1: 300,
        times: [120, 300],
      },
    ]);

    expect(delayedFlights[0]?.t0).toBe(120 + 12 * 60);
    expect(delayedFlights[0]?.t1).toBe(300 + 12 * 60);
    expect(useSimStore.getState().range).toEqual([120 + 12 * 60, 300 + 12 * 60]);
  });

  it("appends traffic-volume selections without replacing the existing multi-selection", () => {
    const store = useSimStore.getState();

    store.setSelectedTrafficVolume("TV_A", {
      properties: { traffic_volume_id: "TV_A" } as any,
    });
    store.appendSelectedTrafficVolume("TV_B", {
      properties: { traffic_volume_id: "TV_B" } as any,
    });

    expect(useSimStore.getState().selectedTrafficVolumes).toEqual(["TV_A", "TV_B"]);
    expect(useSimStore.getState().selectedTrafficVolume).toBe("TV_A");
  });
});
