import { describe, expect, it } from "vitest";

import {
  buildCollapsedSectorDdContextPath,
  buildCollapsedSectorDdContextTimeRange,
  buildComplexityContextDensityRulerModel,
  buildCollapsedSectorDdSuitePath,
  buildCollapsedSectorDdTracePath,
  buildComplexityChartRows,
  buildComplexityContextSpatialOverlayFeatures,
  buildComplexityOverlayCollections,
  buildForwardTimeRange,
  getClosestSnapshot,
  getComplexityMetricSpatialContext,
  getComplexityContextSlot,
  getTraceEnvelope,
  mergeTraceEnvelopes,
  sumMetricCounts,
  type ComplexityContextMetric,
  type ComplexityContextResponse,
  type ComplexityContextSlot,
  type ComplexityTraceResponse,
} from "@/lib/csComplexity";

describe("csComplexity helpers", () => {
  it("builds forward windows and client paths without wraparound", () => {
    expect(buildForwardTimeRange(7 * 3600, "1h")).toBe("07:00:00-08:00:00");
    expect(buildForwardTimeRange(7 * 3600, "2m")).toBe("07:00:00-07:02:00");
    expect(buildForwardTimeRange(86350, "1h")).toBe("23:59:10-23:59:59");

    expect(
      buildCollapsedSectorDdContextPath({
        collapsedSectorId: " EGTTFIS ",
        timeRange: "07:00:00-07:30:00",
        metrics: ["hc", "cp25_proxy", "hc"],
      }),
    ).toBe(
      "/api/collapsed_sector_dd_context?collapsed_sector_id=EGTTFIS&time_range=07%3A00%3A00-07%3A30%3A00&metrics=hc%2Ccp25_proxy",
    );

    expect(
      buildCollapsedSectorDdSuitePath({
        collapsedSectorId: " EGTTFIS ",
        timeRange: "07:00:00-08:00:00",
        sampleSeconds: 120,
      }),
    ).toBe(
      "/api/collapsed_sector_dd_suite?collapsed_sector_id=EGTTFIS&time_range=07%3A00%3A00-08%3A00%3A00&sample_seconds=120",
    );

    expect(
      buildCollapsedSectorDdTracePath({
        collapsedSectorId: "EGTTFIS",
        timeRange: "07:00:00-08:00:00",
        metrics: ["hc", "cp25_proxy", "hc"],
        sampleSeconds: 120,
        maxRecordsPerMetric: 200,
      }),
    ).toBe(
      "/api/collapsed_sector_dd_trace?collapsed_sector_id=EGTTFIS&time_range=07%3A00%3A00-08%3A00%3A00&metrics=hc%2Ccp25_proxy&sample_seconds=120&max_records_per_metric=200",
    );

    expect(buildCollapsedSectorDdContextTimeRange(7 * 3600 + 17 * 60)).toBe("07:00:00-07:30:00");
    expect(buildCollapsedSectorDdContextTimeRange(23 * 3600 + 50 * 60)).toBe("23:30:00-23:59:59");
  });

  it("selects the closest snapshot and exposes typed trace envelopes", () => {
    const response: ComplexityTraceResponse = {
      collapsed_sector_id: "EGTTFIS",
      date: "2023-07-16",
      time_range: {
        start: "07:00:00",
        end: "08:00:00",
        start_s: 25200,
        end_s: 28800,
      },
      sample_seconds: 120,
      snapshots: [
        {
          sector_id: "EGTTFIS",
          sample_end_s: 25200,
          sample_end_time: "07:00:00",
          window_start_s: 25080,
          window_start_time: "06:58:00",
          sample_seconds: 120,
          counts: {
            sector_id: "EGTTFIS",
            sample_end_s: 25200,
            td: 10,
            hc: 1,
            sc_groundspeed_proxy: 0,
            ac_segment: 0,
            md5_raw: 0,
            md10_raw: 0,
            cp25_proxy: 0,
            cp40_proxy: 0,
            cp70_proxy: 0,
          },
          traces_by_metric: {
            hc: {
              metric_id: "hc",
              count: 1,
              records: [
                {
                  flight_id: "F1",
                  event_state: { lon: 1, lat: 50, alt_ft: 32000 },
                  heading_before_deg: 90,
                  heading_after_deg: 45,
                  heading_delta_deg: 45,
                },
              ],
            },
          },
        },
        {
          sector_id: "EGTTFIS",
          sample_end_s: 25320,
          sample_end_time: "07:02:00",
          window_start_s: 25200,
          window_start_time: "07:00:00",
          sample_seconds: 120,
          counts: {
            sector_id: "EGTTFIS",
            sample_end_s: 25320,
            td: 12,
            hc: 2,
            sc_groundspeed_proxy: 1,
            ac_segment: 0,
            md5_raw: 0,
            md10_raw: 0,
            cp25_proxy: 0,
            cp40_proxy: 0,
            cp70_proxy: 0,
          },
          traces_by_metric: {},
        },
      ],
    };

    const closest = getClosestSnapshot(response.snapshots, 25290);
    expect(closest?.sample_end_s).toBe(25320);
    expect(getTraceEnvelope(response.snapshots[0], "hc")?.records[0]).toMatchObject({
      flight_id: "F1",
      heading_delta_deg: 45,
    });
    expect(mergeTraceEnvelopes(response.snapshots, "hc")).toMatchObject({
      metric_id: "hc",
      count: 1,
      returned_record_count: 1,
      records: [{ flight_id: "F1", heading_delta_deg: 45 }],
    });
  });

  it("builds chart rows and heading-change overlay geometry", () => {
    const suiteSnapshots = [
      {
        sector_id: "EGTTFIS",
        sample_end_s: 25200,
        sample_end_time: "07:00:00",
        window_start_s: 25080,
        window_start_time: "06:58:00",
        sample_seconds: 120,
        td: 10,
        hc: 3,
        sc_groundspeed_proxy: 4,
        ac_segment: 5,
        md5_raw: 6,
        md10_raw: 7,
        cp25_proxy: 8,
        cp40_proxy: 9,
        cp70_proxy: 10,
      },
      {
        sector_id: "EGTTFIS",
        sample_end_s: 25320,
        sample_end_time: "07:02:00",
        window_start_s: 25200,
        window_start_time: "07:00:00",
        sample_seconds: 120,
        td: 2,
        hc: 1,
        sc_groundspeed_proxy: 0,
        ac_segment: 1,
        md5_raw: 0,
        md10_raw: 1,
        cp25_proxy: 0,
        cp40_proxy: 0,
        cp70_proxy: 1,
      },
    ];
    const chartRows = buildComplexityChartRows(suiteSnapshots);

    expect(sumMetricCounts(suiteSnapshots, "td")).toBe(12);

    expect(chartRows).toEqual([
      {
        sampleEndSeconds: 25200,
        sampleEndTime: "07:00:00",
        td: 10,
        hc: 3,
        sc_groundspeed_proxy: 4,
        ac_segment: 5,
        md5_raw: 6,
        md10_raw: 7,
        cp25_proxy: 8,
        cp40_proxy: 9,
        cp70_proxy: 10,
      },
      {
        sampleEndSeconds: 25320,
        sampleEndTime: "07:02:00",
        td: 2,
        hc: 1,
        sc_groundspeed_proxy: 0,
        ac_segment: 1,
        md5_raw: 0,
        md10_raw: 1,
        cp25_proxy: 0,
        cp40_proxy: 0,
        cp70_proxy: 1,
      },
    ]);

    const overlay = buildComplexityOverlayCollections({
      metricId: "hc",
      envelope: {
        metric_id: "hc",
        count: 1,
        records: [
          {
            flight_id: "F1",
            event_state: { lon: 2, lat: 48, alt_ft: 33000 },
            heading_before_deg: 90,
            heading_after_deg: 45,
            heading_delta_deg: 45,
          },
        ],
      },
      flLowerBound: 300,
      flUpperBound: 350,
    });

    expect(overlay.lines.features).toHaveLength(2);
    expect(overlay.points.features).toHaveLength(1);
    expect(overlay.labels.features.map((feature) => feature.properties?.labelText)).toEqual(
      expect.arrayContaining(["➜", "Δ45°"]),
    );
  });

  it("filters overlay records outside the selected flight level range", () => {
    const overlay = buildComplexityOverlayCollections({
      metricId: "cp25_proxy",
      envelope: {
        metric_id: "cp25_proxy",
        count: 1,
        records: [
          {
            flight_id_a: "F1",
            flight_id_b: "F2",
            state_a: { lon: 1, lat: 50, alt_ft: 18000 },
            state_b: { lon: 1.2, lat: 50.2, alt_ft: 18000 },
            cpa_midpoint_state: { lon: 1.1, lat: 50.1, alt_ft: 18000 },
          },
        ],
      },
      flLowerBound: 300,
      flUpperBound: 350,
    });

    expect(overlay.lines.features).toHaveLength(0);
    expect(overlay.points.features).toHaveLength(0);
    expect(overlay.labels.features).toHaveLength(0);
  });

  it("selects the containing context slot for the current 30-minute window", () => {
    const contextResponse: ComplexityContextResponse = {
      collapsed_sector_id: "EGTTFIS",
      date: "2023-07-16",
      time_range: {
        start: "07:00:00",
        end: "08:00:00",
        start_s: 25200,
        end_s: 28800,
      },
      context_bin_minutes: 30,
      slots: [
        {
          slot_index: 14,
          slot_start_s: 25200,
          slot_start_time: "07:00:00",
          slot_end_s: 27000,
          slot_end_time: "07:30:00",
          time_bin: "07:00-07:30",
          metrics: {},
        },
        {
          slot_index: 15,
          slot_start_s: 27000,
          slot_start_time: "07:30:00",
          slot_end_s: 28800,
          slot_end_time: "08:00:00",
          time_bin: "07:30-08:00",
          metrics: {},
        },
      ],
    };

    expect(getComplexityContextSlot(contextResponse.slots, 25200)?.slot_index).toBe(14);
    expect(getComplexityContextSlot(contextResponse.slots, 27120)?.slot_index).toBe(15);
  });

  it("builds a multimodal density ruler model and keeps the observed marker in range", () => {
    const metricContext: ComplexityContextMetric = {
      observed_value: 78,
      expected_mean: 54.1,
      upper_tail_probability: 0.081,
      distribution_available: true,
      distribution: {
        mode_count: 3,
        weights: [0.5, 0.3, 0.2],
        means: [48, 57, 67.5],
        variances: [12, 18, 24],
      },
    };

    const model = buildComplexityContextDensityRulerModel(metricContext, 64);
    expect(model).not.toBeNull();
    expect(model?.samples).toHaveLength(64);
    expect(model?.distributionAvailable).toBe(true);
    expect(model?.domainMax).toBeGreaterThanOrEqual(78);
    expect(model?.observedRatio).toBeGreaterThan(0.8);
    expect([...(new Set(model?.samples.map((sample) => sample.band)) ?? new Set())]).toEqual(
      expect.arrayContaining(["yellow", "orange", "red"]),
    );
  });

  it("returns no spatial overlay for td or when spatial fields are absent", () => {
    const sectorFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ]],
      },
      properties: { traffic_volume_id: "EGTTFIS" },
    };

    expect(
      buildComplexityContextSpatialOverlayFeatures({
        metricId: "td",
        spatialContext: {
          spatial_weights: [1],
          spatial_mean_lon: [1],
          spatial_mean_lat: [1],
          spatial_cov_xx: [0.1],
          spatial_cov_xy: [0],
          spatial_cov_yy: [0.1],
        },
        sectorFeature,
      }).features,
    ).toHaveLength(0);

    expect(
      buildComplexityContextSpatialOverlayFeatures({
        metricId: "hc",
        spatialContext: {},
        sectorFeature,
      }).features,
    ).toHaveLength(0);
  });

  it("prefers additive event_spatial context for non-td metrics", () => {
    const slot: ComplexityContextSlot = {
      slot_index: 18,
      slot_start_s: 32400,
      slot_start_time: "09:00:00",
      slot_end_s: 34200,
      slot_end_time: "09:30:00",
      metrics: {
        hc: {
          observed_value: 3,
          distribution_available: true,
          expected_mean: 2.5,
        },
      },
      event_spatial: {
        hc: {
          distribution_available: true,
          event_count: 9,
          distribution: {
            mode_count: 2,
            weights: [0.6, 0.4],
            mean_lon: [0.8, 1.2],
            mean_lat: [0.9, 1.1],
            cov_xx: [0.08, 0.05],
            cov_xy: [0.01, -0.008],
            cov_yy: [0.05, 0.04],
          },
        },
      },
    };

    expect(getComplexityMetricSpatialContext(slot, "hc")).toEqual(slot.event_spatial?.hc);
    expect(getComplexityMetricSpatialContext(slot, "td")).toBeNull();
  });

  it("builds clipped spatial context bands from additive event_spatial data", () => {
    const spatialContext = {
      distribution_available: true,
      event_count: 19,
      distribution: {
        mode_count: 2,
        weights: [0.7, 0.3],
        mean_lon: [0.75, 1.25],
        mean_lat: [1, 1],
        cov_xx: [0.08, 0.05],
        cov_xy: [0.01, -0.008],
        cov_yy: [0.05, 0.04],
      },
    };
    const sectorFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [0.5, 0.55],
          [1.5, 0.55],
          [1.5, 1.45],
          [0.5, 1.45],
          [0.5, 0.55],
        ]],
      },
      properties: { traffic_volume_id: "EGTTFIS" },
    };

    const overlay = buildComplexityContextSpatialOverlayFeatures({
      metricId: "hc",
      spatialContext,
      sectorFeature,
    });

    expect(overlay.features.length).toBeGreaterThan(0);
    expect(new Set(overlay.features.map((feature) => feature.properties?.fillColor))).toEqual(
      new Set(["#facc15", "#f97316", "#ef4444"]),
    );

    const allCoordinates = overlay.features.flatMap((feature) => {
      if (feature.geometry.type === "Polygon") {
        return feature.geometry.coordinates.flat();
      }
      return feature.geometry.coordinates.flat(2);
    });

    for (const [lon, lat] of allCoordinates) {
      expect(lon).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(lon).toBeLessThanOrEqual(1.5 + 1e-6);
      expect(lat).toBeGreaterThanOrEqual(0.55 - 1e-6);
      expect(lat).toBeLessThanOrEqual(1.45 + 1e-6);
    }
  });

  it("keeps backward compatibility with legacy metric-local spatial fields", () => {
    const overlay = buildComplexityContextSpatialOverlayFeatures({
      metricId: "cp25_proxy",
      spatialContext: {
        spatial_mode_count: 1,
        spatial_weights: [1],
        spatial_mean_lon: [1],
        spatial_mean_lat: [1],
        spatial_cov_xx: [0.02],
        spatial_cov_xy: [0],
        spatial_cov_yy: [0.02],
      } satisfies ComplexityContextMetric,
      sectorFeature: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [0.5, 0.5],
            [1.5, 0.5],
            [1.5, 1.5],
            [0.5, 1.5],
            [0.5, 0.5],
          ]],
        },
        properties: {},
      },
    });

    expect(overlay.features.length).toBeGreaterThan(0);
  });
});
