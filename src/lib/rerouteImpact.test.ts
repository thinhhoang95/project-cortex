import { describe, expect, it } from "vitest";

import {
  buildRerouteImpactScenarioGroups,
  extractRerouteImpactOverlayFeatures,
  mergeGroupedRerouteImpactResponses,
  validateRerouteImpactScenario,
  type RerouteImpactCommittedMoveLike,
  type RerouteImpactResponse,
  type RerouteImpactScenarioGroup,
} from "@/lib/rerouteImpact";

function makeMove(
  id: string,
  affectedFlightIds: string[],
  obstacleVertices: Array<Array<[number, number]>>,
  withFunnel = false,
): RerouteImpactCommittedMoveLike {
  return {
    id,
    affectedFlightIds,
    obstacles: obstacleVertices.map((vertices, index) => ({
      id: `${id}-OBS-${index + 1}`,
      vertices,
    })),
    funnels: withFunnel
      ? [
          {
            id: `${id}-FUNNEL`,
            affinityPoint: [5, 5],
            selectionPolyline: [
              [0, 0],
              [10, 0],
              [10, 10],
            ],
          },
        ]
      : [],
  };
}

function makeResponse(
  overrides: Partial<RerouteImpactResponse> = {},
): RerouteImpactResponse {
  return {
    resource_date: "2023-07-17",
    time_bin_minutes: 15,
    num_bins: 2,
    flight_ids: ["F1"],
    barred_polygon_ids: ["M1:O1"],
    tv_ids_order: ["TV_A"],
    timebins: {
      labels: ["00:00-00:15", "00:15-00:30"],
    },
    raw: {
      pre_counts: {},
      post_counts: {},
      delta_counts: {},
    },
    rolling_hour: {
      pre_counts: {},
      post_counts: {},
      delta_counts: {},
    },
    diagnostics: {
      summary: {
        requested_flight_count: 1,
        found_flight_count: 1,
        missing_flight_ids: [],
        processed_flight_count: 1,
        rerouted_flight_count: 1,
        unchanged_flight_count: 0,
        skipped_flight_count: 0,
        requested_polygon_count: 1,
        changed_tv_count: 1,
      },
      flights: {
        F1: {
          status: "rerouted",
          blocked_interval_count: 1,
          distance_delta_nm: 12,
          elapsed_delta_s: 150,
          polygons_touched: ["M1:O1"],
        },
      },
    },
    detoured_segments: {
      included: true,
      flight_count: 1,
      rerouted_flight_count: 1,
      flights: {
        F1: {
          status: "rerouted",
          interval_count: 1,
          intervals: [
            {
              polygon_ids: ["M1:O1"],
              detour_path: [
                { longitude: 1.0, latitude: 44.1 },
                { longitude: 1.1, latitude: 44.2 },
                { longitude: 1.3, latitude: 44.1 },
              ],
            },
          ],
        },
      },
    },
    capacity: {
      TV_A: [20, 20],
    },
    ...overrides,
  };
}

describe("rerouteImpact", () => {
  it("accepts convex rectangles and rejects non-convex polygons", () => {
    const validScenario = validateRerouteImpactScenario([
      makeMove("MOVE-1", ["F1"], [
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [2, 2],
          [0, 2],
        ],
      ]),
    ]);

    expect(validScenario.canSimulate).toBe(true);

    const invalidScenario = validateRerouteImpactScenario([
      makeMove("MOVE-2", ["F1"], [
        [
          [0, 0],
          [4, 0],
          [1.5, 1],
          [4, 2],
          [0, 2],
        ],
      ]),
    ]);

    expect(invalidScenario.canSimulate).toBe(false);
    expect(invalidScenario.reason).toContain("not convex polygons");
  });

  it("blocks scenarios that contain funnels", () => {
    const validation = validateRerouteImpactScenario([
      makeMove("MOVE-1", ["F1"], [
        [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
      ], true),
    ]);

    expect(validation.canSimulate).toBe(false);
    expect(validation.reason).toContain("contain funnels");
  });

  it("groups flights by their effective obstacle union", () => {
    const groups = buildRerouteImpactScenarioGroups([
      makeMove("MOVE-A", ["F1", "F2"], [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
        ],
      ]),
      makeMove("MOVE-B", ["F2", "F3"], [
        [
          [10, 0],
          [12, 0],
          [12, 2],
          [10, 2],
        ],
      ]),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.flightIds)).toEqual([["F1"], ["F2"], ["F3"]]);
    expect(groups.map((group) => group.polygonIds)).toEqual([
      ["MOVE-A:MOVE-A-OBS-1"],
      ["MOVE-A:MOVE-A-OBS-1", "MOVE-B:MOVE-B-OBS-1"],
      ["MOVE-B:MOVE-B-OBS-1"],
    ]);
  });

  it("merges grouped responses and recomputes changed TV order", () => {
    const groups: RerouteImpactScenarioGroup[] = [
      {
        signature: "A",
        flightIds: ["F1"],
        polygonIds: ["MOVE-A:OBS-1"],
        requestBody: {
          flight_ids: ["F1"],
          barred_polygons: { type: "FeatureCollection", features: [] },
          include_capacity: true,
          include_detoured_segments: true,
        },
      },
      {
        signature: "B",
        flightIds: ["F2"],
        polygonIds: ["MOVE-B:OBS-1"],
        requestBody: {
          flight_ids: ["F2"],
          barred_polygons: { type: "FeatureCollection", features: [] },
          include_capacity: true,
          include_detoured_segments: true,
        },
      },
    ];

    const merged = mergeGroupedRerouteImpactResponses(groups, [
      makeResponse({
        flight_ids: ["F1"],
        barred_polygon_ids: ["MOVE-A:OBS-1"],
        tv_ids_order: ["TV_A"],
        raw: {
          pre_counts: { TV_A: [1, 0] },
          post_counts: { TV_A: [2, 1] },
          delta_counts: { TV_A: [1, 1] },
        },
        rolling_hour: {
          pre_counts: { TV_A: [1, 0] },
          post_counts: { TV_A: [2, 2] },
          delta_counts: { TV_A: [1, 2] },
        },
      }),
      makeResponse({
        flight_ids: ["F2"],
        barred_polygon_ids: ["MOVE-B:OBS-1"],
        tv_ids_order: ["TV_B"],
        raw: {
          pre_counts: { TV_A: [0, 1], TV_B: [2, 2] },
          post_counts: { TV_A: [0, 3], TV_B: [1, 2] },
          delta_counts: { TV_A: [0, 2], TV_B: [-1, 0] },
        },
        rolling_hour: {
          pre_counts: { TV_A: [0, 1], TV_B: [2, 2] },
          post_counts: { TV_A: [0, 4], TV_B: [1, 2] },
          delta_counts: { TV_A: [0, 3], TV_B: [-1, 0] },
        },
        capacity: {
          TV_A: [20, 20],
          TV_B: [25, 25],
        },
        diagnostics: {
          summary: {
            requested_flight_count: 1,
            found_flight_count: 1,
            missing_flight_ids: [],
            processed_flight_count: 1,
            rerouted_flight_count: 0,
            unchanged_flight_count: 1,
            skipped_flight_count: 0,
            requested_polygon_count: 1,
            changed_tv_count: 1,
          },
          flights: {
            F2: {
              status: "unchanged",
              blocked_interval_count: 0,
              polygons_touched: ["MOVE-B:OBS-1"],
            },
          },
        },
        detoured_segments: {
          included: true,
          flight_count: 1,
          rerouted_flight_count: 0,
          flights: {
            F2: {
              status: "unchanged",
              interval_count: 0,
              intervals: [],
            },
          },
        },
      }),
    ]);

    expect(merged.flight_ids).toEqual(["F1", "F2"]);
    expect(merged.barred_polygon_ids).toEqual(["MOVE-A:OBS-1", "MOVE-B:OBS-1"]);
    expect(merged.raw.pre_counts.TV_A).toEqual([1, 1]);
    expect(merged.raw.post_counts.TV_A).toEqual([2, 4]);
    expect(merged.raw.delta_counts.TV_A).toEqual([1, 3]);
    expect(merged.raw.delta_counts.TV_B).toEqual([-1, 0]);
    expect(merged.tv_ids_order).toEqual(["TV_A", "TV_B"]);
    expect(merged.capacity).toEqual({
      TV_A: [20, 20],
      TV_B: [25, 25],
    });
    expect(merged.diagnostics.summary?.requested_flight_count).toBe(2);
    expect(merged.diagnostics.summary?.rerouted_flight_count).toBe(1);
    expect(merged.diagnostics.summary?.unchanged_flight_count).toBe(1);
  });

  it("throws when grouped responses disagree on capacity", () => {
    const groups: RerouteImpactScenarioGroup[] = [
      {
        signature: "A",
        flightIds: ["F1"],
        polygonIds: ["MOVE-A:OBS-1"],
        requestBody: {
          flight_ids: ["F1"],
          barred_polygons: { type: "FeatureCollection", features: [] },
          include_capacity: true,
          include_detoured_segments: true,
        },
      },
      {
        signature: "B",
        flightIds: ["F2"],
        polygonIds: ["MOVE-B:OBS-1"],
        requestBody: {
          flight_ids: ["F2"],
          barred_polygons: { type: "FeatureCollection", features: [] },
          include_capacity: true,
          include_detoured_segments: true,
        },
      },
    ];

    expect(() =>
      mergeGroupedRerouteImpactResponses(groups, [
        makeResponse({
          capacity: { TV_A: [20, 20] },
        }),
        makeResponse({
          flight_ids: ["F2"],
          capacity: { TV_A: [21, 20] },
          diagnostics: {
            summary: {
              requested_flight_count: 1,
              found_flight_count: 1,
              missing_flight_ids: [],
              processed_flight_count: 1,
              rerouted_flight_count: 0,
              unchanged_flight_count: 1,
              skipped_flight_count: 0,
              requested_polygon_count: 1,
              changed_tv_count: 1,
            },
            flights: {
              F2: {
                status: "unchanged",
                blocked_interval_count: 0,
                polygons_touched: ["MOVE-B:OBS-1"],
              },
            },
          },
          detoured_segments: {
            included: true,
            flight_count: 1,
            rerouted_flight_count: 0,
            flights: {
              F2: {
                status: "unchanged",
                interval_count: 0,
                intervals: [],
              },
            },
          },
        }),
      ]),
    ).toThrow("Capacity mismatch");
  });

  it("extracts overlay features only from valid simulated detour paths", () => {
    const features = extractRerouteImpactOverlayFeatures(
      makeResponse({
        detoured_segments: {
          included: true,
          flight_count: 1,
          rerouted_flight_count: 1,
          flights: {
            F1: {
              status: "rerouted",
              interval_count: 3,
              intervals: [
                {
                  detour_path: [
                    { longitude: 1.0, latitude: 44.0 },
                    { longitude: 1.1, latitude: 44.1 },
                  ],
                },
                {
                  detour_path: [
                    { longitude: Number.NaN, latitude: 44.0 },
                    { longitude: 1.2, latitude: 44.1 },
                  ],
                },
                {
                  detour_path: [{ longitude: 1.3, latitude: 44.2 }],
                },
              ],
            },
          },
        },
      }),
    );

    expect(features).toHaveLength(1);
    expect(features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [
        [1.0, 44.0],
        [1.1, 44.1],
      ],
    });
    expect(features[0].properties).toMatchObject({
      flightId: "F1",
      source: "reroute_impact",
    });
  });
});
