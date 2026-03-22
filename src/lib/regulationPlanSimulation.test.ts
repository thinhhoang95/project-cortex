import { describe, expect, it } from "vitest";

import { buildRegulationPlanSimulationPayload } from "@/lib/regulationPlanSimulation";

describe("regulationPlanSimulation", () => {
  it("uses canonical flight IDs without remapping callsigns", () => {
    const payload = buildRegulationPlanSimulationPayload({
      regulations: [
        {
          trafficVolume: "TV-ALPHA",
          rate: 18,
          activeTimeWindowFrom: 9 * 3600,
          activeTimeWindowTo: 10 * 3600,
          flightIds: ["FLIGHT_001", "FLIGHT_002"],
          resourceDate: "2026-03-21",
          resourceStateId: "state-0002",
        },
      ],
      currentContext: {
        resourceDate: "2026-03-21",
        resourceStateId: "state-0002",
      },
    });

    expect(payload.regulations[0]?.target_flight_ids).toEqual(["FLIGHT_001", "FLIGHT_002"]);
  });

  it("rejects legacy callsign-only target lists", () => {
    expect(() =>
      buildRegulationPlanSimulationPayload({
        regulations: [
          {
            trafficVolume: "TV-ALPHA",
            rate: 18,
            activeTimeWindowFrom: 9 * 3600,
            activeTimeWindowTo: 10 * 3600,
            flightIds: [],
            flightCallsigns: ["CS100"],
            resourceDate: "2026-03-21",
            resourceStateId: "state-0002",
          },
        ],
        currentContext: {
          resourceDate: "2026-03-21",
          resourceStateId: "state-0002",
        },
      }),
    ).toThrow(/legacy callsign targets/);
  });

  it("rejects regulations from a different resource state", () => {
    expect(() =>
      buildRegulationPlanSimulationPayload({
        regulations: [
          {
            trafficVolume: "TV-ALPHA",
            rate: 18,
            activeTimeWindowFrom: 9 * 3600,
            activeTimeWindowTo: 10 * 3600,
            flightIds: ["FLIGHT_001"],
            resourceDate: "2026-03-20",
            resourceStateId: "state-0001",
          },
        ],
        currentContext: {
          resourceDate: "2026-03-21",
          resourceStateId: "state-0002",
        },
      }),
    ).toThrow(/belongs to 2026-03-20 \/ state state-0001/);
  });
});
