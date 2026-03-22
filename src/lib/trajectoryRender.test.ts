import { describe, expect, it } from "vitest";

import {
  buildTrajectoryFlightLevelLabelFeatureCollection,
  buildTrajectoryLineFeatureCollection,
} from "@/lib/trajectoryRender";

describe("trajectoryRender", () => {
  it("keeps one base line feature per trajectory", () => {
    const collection = buildTrajectoryLineFeatureCollection([
      {
        flightId: "F1",
        callSign: "ACA101",
        coords: [
          [1, 2, 34000],
          [3, 4, 36000],
        ],
        t0: 10,
        t1: 20,
        times: [10, 20],
      },
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toMatchObject({
      flightId: "F1",
      callSign: "ACA101",
    });
  });

  it("builds one FL label feature per trajectory segment using midpoint altitude", () => {
    const collection = buildTrajectoryFlightLevelLabelFeatureCollection([
      {
        flightId: "F1",
        callSign: "ACA101",
        coords: [
          [1, 2, 34000],
          [3, 4, 36000],
          [5, 6, 35100],
        ],
        t0: 10,
        t1: 30,
        times: [10, 20, 30],
      },
    ]);

    expect(collection.features).toHaveLength(2);
    expect(collection.features.map((feature) => feature.properties?.flightLevelLabel)).toEqual(["350", "356"]);
    expect(collection.features.map((feature) => feature.properties?.flightId)).toEqual(["F1", "F1"]);
  });

  it("falls back to available altitude or FL000 when segment altitude data is missing", () => {
    const collection = buildTrajectoryFlightLevelLabelFeatureCollection([
      {
        flightId: "F1",
        coords: [
          [1, 2, undefined],
          [3, 4, 34980],
          [5, 6, undefined],
        ],
        t0: 10,
        t1: 30,
        times: [10, 20, 30],
      },
      {
        flightId: "F2",
        coords: [
          [0, 0, undefined],
          [1, 1, undefined],
        ],
        t0: 5,
        t1: 15,
        times: [5, 15],
      },
    ]);

    expect(collection.features.map((feature) => feature.properties?.flightLevelLabel)).toEqual(["350", "350", "0"]);
    expect(collection.features.map((feature) => feature.properties?.flightId)).toEqual(["F1", "F1", "F2"]);
  });
});
