import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/collapsed_sector_dd_hotspots/route";

describe("GET /api/collapsed_sector_dd_hotspots", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("rejects blank metric ids locally", async () => {
    const response = await GET(new NextRequest("http://localhost/api/collapsed_sector_dd_hotspots"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "metric_id parameter is required",
    });
  });

  it("rejects invalid metric ids locally", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/collapsed_sector_dd_hotspots?metric_id=not_real"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported metric_id value: not_real",
    });
  });

  it("rejects invalid thresholds locally", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/collapsed_sector_dd_hotspots?metric_id=td&threshold=1.2"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "threshold must be a number in [0, 1]",
    });
  });

  it("forwards metric, time range, and threshold to the backend", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ hotspots: [], count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;
    global.fetch = fetchSpy;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_hotspots?metric_id=hc&time_range=07:00:00-08:00:00&threshold=0.05",
      ),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "metric_id=hc",
    );
    expect(String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "time_range=07%3A00%3A00-08%3A00%3A00",
    );
    expect(String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "threshold=0.05",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hotspots: [], count: 0 });
  });

  it("passes through upstream 503 payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Hotspot aggregate cache unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/collapsed_sector_dd_hotspots?metric_id=td"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hotspot aggregate cache unavailable",
    });
  });
});
