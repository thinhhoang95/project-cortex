import { describe, expect, it } from "vitest";

import {
  buildPreviewRadsForTrafficVolumePath,
  buildPreviewRadsPath,
  buildPreviewRadsSearchPath,
  filterRadPreviewRowsLocally,
  buildRadFlightCacheKey,
  mapRadFlightRows,
  normalizeRadId,
  resolveRadHighlightFlightIds,
} from "@/lib/radPreview";
import type { Trajectory } from "@/lib/models";

describe("radPreview helpers", () => {
  it("normalizes cache keys case-insensitively by rad id", () => {
    expect(buildRadFlightCacheKey(4, "ed2272", "L")).toBe("4|ED2272|L");
    expect(buildRadFlightCacheKey(4.8, " Ed2272 ", "I")).toBe("4|ED2272|I");
    expect(normalizeRadId(" ed2272 ")).toBe("ED2272");
  });

  it("uses the selected RAD's complete flight list for map highlighting", () => {
    const flightList = {
      rad_id: "RAD1",
      legitimacy_flag: "L" as const,
      flight_ids: ["F1", "F2", "F3"],
      count: 3,
      rule_instance_ids: [1],
      matching_rule_instance_ids: [1],
    };

    expect(resolveRadHighlightFlightIds(" rad1 ", "L", flightList)).toEqual(["F1", "F2", "F3"]);
    expect(resolveRadHighlightFlightIds("RAD2", "L", flightList)).toEqual([]);
    expect(resolveRadHighlightFlightIds("RAD1", "I", flightList)).toEqual([]);
  });

  it("maps known and unresolved flights without dropping order", () => {
    const flights: Trajectory[] = [
      {
        flightId: "F1",
        callSign: "AAA123",
        origin: "EGLL",
        destination: "LFPG",
        coords: [],
        t0: 3600,
        t1: 7200,
        times: [],
      },
    ];

    expect(mapRadFlightRows(["F1", "UNKNOWN"], flights)).toEqual([
      {
        flightId: "F1",
        callSign: "AAA123",
        origin: "EGLL",
        destination: "LFPG",
        takeoffTime: "01:00",
        flight: flights[0],
        unresolved: false,
      },
      {
        flightId: "UNKNOWN",
        callSign: "UNKNOWN",
        origin: "—",
        destination: "—",
        takeoffTime: "—",
        flight: null,
        unresolved: true,
      },
    ]);
  });

  it("builds preview list paths without forcing the backend default limit", () => {
    expect(buildPreviewRadsPath()).toBe("/api/preview_rads");
    expect(buildPreviewRadsPath(999)).toBe("/api/preview_rads?limit=250");
    expect(
      buildPreviewRadsForTrafficVolumePath({ trafficVolumeId: " EDUUUTAS ", limit: 999 }),
    ).toBe("/api/preview_rads_for_traffic_volume?traffic_volume_id=EDUUUTAS&limit=250");
  });

  it("builds preview search paths with repeated fields and optional exact match", () => {
    expect(
      buildPreviewRadsSearchPath({
        search: "  UL612  ",
        fields: ["Airway", "From", "Airway"],
      }),
    ).toBe("/api/preview_rads_search?search=UL612&fields=Airway&fields=From");

    expect(
      buildPreviewRadsSearchPath({
        search: "LAR",
        fields: ["Point/Airspace", "Utilization"],
        exactMatch: true,
      }),
    ).toBe(
      "/api/preview_rads_search?search=LAR&fields=Point%2FAirspace&fields=Utilization&exact_match=true",
    );
  });

  it("filters RAD rows locally across selected fields", () => {
    const rows = [
      {
        rad_id: "RAD1",
        first_rule_instance_id: 1,
        first_csv_row_number: 12,
        total_instances: 1,
        supported_instance_count: 1,
        unsupported_instance_count: 0,
        support_status: "supported",
        rule_instance_ids: [1],
        matching_rule_instance_ids_by_flag: { L: [1], I: [] },
        flight_counts: { L: 5, I: 0 },
        instances: [
          {
            rule_instance_id: 1,
            csv_row_number: 12,
            rad_id: "RAD1",
            airway: "UL612",
            from: "ABBEY",
            to: "KOK",
            point_or_airspace: "EDUUUTAS",
            utilization: "C",
          },
        ],
      },
      {
        rad_id: "RAD2",
        first_rule_instance_id: 2,
        first_csv_row_number: 20,
        total_instances: 1,
        supported_instance_count: 1,
        unsupported_instance_count: 0,
        support_status: "supported",
        rule_instance_ids: [2],
        matching_rule_instance_ids_by_flag: { L: [2], I: [] },
        flight_counts: { L: 7, I: 1 },
        instances: [
          {
            rule_instance_id: 2,
            csv_row_number: 20,
            rad_id: "RAD2",
            airway: "UN869",
            from: "LARDA",
            to: "SOMAX",
            point_or_airspace: "LFBBPT",
            utilization: "D",
          },
        ],
      },
    ];

    expect(
      filterRadPreviewRowsLocally(rows, {
        search: "  ul612 ",
        fields: ["Airway"],
        exactMatch: false,
      }).map((row) => row.rad_id),
    ).toEqual(["RAD1"]);

    expect(
      filterRadPreviewRowsLocally(rows, {
        search: "eduuutas",
        fields: ["Point/Airspace", "Utilization"],
        exactMatch: true,
      }).map((row) => row.rad_id),
    ).toEqual(["RAD1"]);
  });
});
