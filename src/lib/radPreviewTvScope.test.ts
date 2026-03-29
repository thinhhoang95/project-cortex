import { describe, expect, it } from "vitest";

import {
  collectTvFlightIdsInWindow,
  formatTvFlightsReferenceTime,
  getTvScopeWindowSeconds,
  intersectOrderedFlightIds,
  type TvFlightsPayload,
} from "@/lib/radPreviewTvScope";

describe("radPreviewTvScope helpers", () => {
  it("formats TV flight reference times and window lengths", () => {
    expect(formatTvFlightsReferenceTime(3661)).toBe("010101");
    expect(getTvScopeWindowSeconds("45")).toBe(2700);
    expect(getTvScopeWindowSeconds("2h")).toBe(7200);
  });

  it("collects ordered TV flights within the active window", () => {
    const payload: TvFlightsPayload = {
      kind: "ordered",
      data: {
        traffic_volume_id: "TV1",
        ref_time_str: "060000",
        ordered_flights: ["F2", "F1", "F3"],
        details: [
          {
            flight_id: "F1",
            arrival_time: "06:10",
            arrival_seconds: 6 * 3600 + 10 * 60,
            delta_seconds: 0,
            time_window: "06:00-07:00",
          },
          {
            flight_id: "F2",
            arrival_time: "05:50",
            arrival_seconds: 5 * 3600 + 50 * 60,
            delta_seconds: 0,
            time_window: "05:00-06:00",
          },
          {
            flight_id: "F3",
            arrival_time: "06:45",
            arrival_seconds: 6 * 3600 + 45 * 60,
            delta_seconds: 0,
            time_window: "06:00-07:00",
          },
        ],
      },
    };

    expect(collectTvFlightIdsInWindow(payload, 6 * 3600, 30 * 60)).toEqual(["F1"]);
    expect(collectTvFlightIdsInWindow(payload, 6 * 3600, 60 * 60)).toEqual(["F1", "F3"]);
  });

  it("collects legacy TV flights within the active window and preserves order", () => {
    const payload: TvFlightsPayload = {
      kind: "legacy",
      data: {
        "06:00-07:00": ["F1", "F2"],
        "07:00-08:00": ["F2", "F3"],
      },
    };

    expect(collectTvFlightIdsInWindow(payload, 6 * 3600, 60 * 60)).toEqual(["F1", "F2", "F3"]);
  });

  it("intersects ordered flight ids without changing the source order", () => {
    expect(intersectOrderedFlightIds(["F3", "F1", "F2"], ["F2", "F3"])).toEqual(["F3", "F2"]);
  });
});
