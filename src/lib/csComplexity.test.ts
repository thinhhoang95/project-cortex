import { describe, expect, it } from "vitest";

import {
  buildCollapsedSectorDdSuitePath,
  buildCollapsedSectorDdTracePath,
  buildComplexityChartRows,
  buildComplexityOverlayCollections,
  buildForwardTimeRange,
  getClosestSnapshot,
  getTraceEnvelope,
  mergeTraceEnvelopes,
  sumMetricCounts,
  type ComplexityTraceResponse,
} from "@/lib/csComplexity";

describe("csComplexity helpers", () => {
  it("builds forward windows and client paths without wraparound", () => {
    expect(buildForwardTimeRange(7 * 3600, "1h")).toBe("07:00:00-08:00:00");
    expect(buildForwardTimeRange(7 * 3600, "2m")).toBe("07:00:00-07:02:00");
    expect(buildForwardTimeRange(86350, "1h")).toBe("23:59:10-23:59:59");

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
});
