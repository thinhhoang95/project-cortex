import { describe, expect, it } from "vitest";
import {
  buildGlobalTvBasketScope,
  dedupeTrafficVolumeIds,
  matchesTrafficVolumeQuery,
} from "@/lib/globalTvBasket";

describe("globalTvBasket", () => {
  it("matches substrings and case-insensitive glob patterns", () => {
    expect(matchesTrafficVolumeQuery("EBBUEC1", "bue")).toBe(true);
    expect(matchesTrafficVolumeQuery("EBBUEC1", "ebb*")).toBe(true);
    expect(matchesTrafficVolumeQuery("EBBUEC1", "EBBUEC?")).toBe(true);
    expect(matchesTrafficVolumeQuery("XEBBUEC1", "EBB*")).toBe(false);
    expect(matchesTrafficVolumeQuery("TV.A", "TV.A")).toBe(true);
  });

  it("deduplicates case-insensitively while preserving insertion order", () => {
    expect(dedupeTrafficVolumeIds([" TV2 ", "tv2", "TV1", ""])).toEqual(["TV2", "TV1"]);
  });

  it("promotes active pins, keeps dormant pins, and intersects a search with context", () => {
    const scope = buildGlobalTvBasketScope({
      catalogIds: ["EBBUEC1", "EBBUEC2", "EDYY1", "TV4"],
      contextIds: ["TV4", "EBBUEC2", "EDYY1", "EBBUEC1"],
      pinnedIds: ["EDYY1", "OLDTV"],
      query: "EBB*",
    });

    expect(scope.activePinnedIds).toEqual(["EDYY1"]);
    expect(scope.dormantPinnedIds).toEqual(["OLDTV"]);
    expect(scope.matchedCatalogIds).toEqual(["EBBUEC1", "EBBUEC2"]);
    expect(scope.requestedCatalogIds).toEqual(["EDYY1", "EBBUEC1", "EBBUEC2"]);
    expect(scope.orderedContextIds).toEqual(["EDYY1", "EBBUEC2", "EBBUEC1"]);
  });

  it("shows the full context with pins first when search is empty", () => {
    const scope = buildGlobalTvBasketScope({
      catalogIds: ["TV1", "TV2", "TV3"],
      contextIds: ["TV3", "TV2", "TV1"],
      pinnedIds: ["TV1"],
      query: "",
    });

    expect(scope.isFiltering).toBe(false);
    expect(scope.orderedContextIds).toEqual(["TV1", "TV3", "TV2"]);
  });
});
