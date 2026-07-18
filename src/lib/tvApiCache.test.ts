import { beforeEach, describe, expect, it, vi } from "vitest";

import { authFetch } from "./auth";
import {
  clearTvApiCache,
  fetchTvCountWithCapacity,
  fetchTvFlights,
  floorToTvTimeBin,
} from "./tvApiCache";

vi.mock("./auth", () => ({
  authFetch: vi.fn(),
}));

const mockedAuthFetch = vi.mocked(authFetch);

beforeEach(() => {
  clearTvApiCache();
  mockedAuthFetch.mockReset();
});

describe("tvApiCache", () => {
  it("deduplicates count requests across consumers", async () => {
    mockedAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ occupancy_counts: { "00:00-00:15": 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const request = {
      trafficVolumeId: "TV1",
      resourceStateEpoch: 7,
    };
    const [first, second] = await Promise.all([
      fetchTvCountWithCapacity(request),
      fetchTvCountWithCapacity(request),
    ]);

    expect(mockedAuthFetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("keeps flight requests distinct by reference bin", async () => {
    mockedAuthFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ details: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await fetchTvFlights({ trafficVolumeId: "TV1", refTimeStr: "00:00:00", resourceStateEpoch: 1 });
    await fetchTvFlights({ trafficVolumeId: "TV1", refTimeStr: "00:15:00", resourceStateEpoch: 1 });

    expect(mockedAuthFetch).toHaveBeenCalledTimes(2);
  });

  it("floors simulation time to the TV time bin", () => {
    expect(floorToTvTimeBin(0)).toBe(0);
    expect(floorToTvTimeBin(899)).toBe(0);
    expect(floorToTvTimeBin(900)).toBe(900);
    expect(floorToTvTimeBin(1_801)).toBe(1_800);
  });
});
