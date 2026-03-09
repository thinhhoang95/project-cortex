import { describe, expect, it } from "vitest";

import { getManifestMissingKeys, hasLocalResourceSupport, listLocalResourceDates } from "@/lib/dataPaths";
import { isResourceDateReady, mergeResourceAvailability } from "@/lib/resourceDates";

describe("resourceDates", () => {
  it("exposes the seeded local manifest date", () => {
    expect(listLocalResourceDates()).toContain("2023-07-17");
    expect(hasLocalResourceSupport("2023-07-17")).toBe(true);
  });

  it("marks local-only and api-only dates correctly", () => {
    const availability = mergeResourceAvailability(
      {
        selected_date: "2023-07-17",
        available_dates: ["2023-07-17", "2023-07-29"],
        manifest_path: "/srv/resource_manifest.json",
        generation: 4,
        resolved_paths: {},
      },
      "2023-07-17",
    );

    expect(availability.find((entry) => entry.date === "2023-07-17")?.status).toBe("ready");
    expect(availability.find((entry) => entry.date === "2023-07-29")?.status).toBe("missing_local");
  });

  it("treats unknown dates as missing all local manifest resources", () => {
    expect(getManifestMissingKeys("2023-07-29")).toEqual([
      "flightsCsv",
      "airspaceGeojson",
      "collapsedSectorsGeojson",
      "airspaceJson",
      "tvCapacityRanges",
    ]);
  });

  it("confirms readiness only when both backend and local manifest support the date", () => {
    const context = {
      selected_date: "2023-07-17",
      available_dates: ["2023-07-17"],
      manifest_path: "/srv/resource_manifest.json",
      generation: 1,
      resolved_paths: {},
    };

    expect(isResourceDateReady("2023-07-17", context)).toBe(true);
    expect(isResourceDateReady("2023-07-29", context)).toBe(false);
  });
});
