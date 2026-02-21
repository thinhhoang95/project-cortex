import { beforeEach, describe, expect, it, vi } from "vitest";

describe("tvCapacityRanges", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads and memoizes capacity ranges", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          " TV_A ": { min_capacity: 3, max_capacity: 61 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./tvCapacityRanges");
    const first = await mod.loadTvCapacityRanges();
    const second = await mod.loadTvCapacityRanges();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.TV_A).toBeTruthy();
    expect(mod.getCachedTvCapacityRanges()).toBeTruthy();
  });

  it("formats derived range from valid min/max", async () => {
    const mod = await import("./tvCapacityRanges");
    expect(mod.formatDerivedCapacityRange({ min_capacity: 10, max_capacity: 25 })).toBe("10 to 25");
  });

  it("returns null when min/max are missing or invalid", async () => {
    const mod = await import("./tvCapacityRanges");
    expect(mod.formatDerivedCapacityRange({ min_capacity: null, max_capacity: 25 })).toBeNull();
    expect(mod.formatDerivedCapacityRange({ min_capacity: 3, max_capacity: Number.NaN })).toBeNull();
    expect(mod.formatDerivedCapacityRange(null)).toBeNull();
  });

  it("swaps reversed min/max while formatting", async () => {
    const mod = await import("./tvCapacityRanges");
    expect(mod.formatDerivedCapacityRange({ min_capacity: 80, max_capacity: 20 })).toBe("20 to 80");
  });

  it("supports async and sync TV lookup helpers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          EBBUEEC1: { min_capacity: 3, max_capacity: 61 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./tvCapacityRanges");
    expect(mod.getDerivedCapacityRangeForTv("EBBUEEC1")).toBeNull();

    const asyncValue = await mod.getDerivedCapacityRangeForTvAsync("EBBUEEC1");
    const syncValue = mod.getDerivedCapacityRangeForTv("EBBUEEC1");

    expect(asyncValue).toBe("3 to 61");
    expect(syncValue).toBe("3 to 61");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
