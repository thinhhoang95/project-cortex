import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/collapsed_sector_dd_context/route";

describe("GET /api/collapsed_sector_dd_context", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("rejects blank collapsed sector ids locally", async () => {
    const response = await GET(new NextRequest("http://localhost/api/collapsed_sector_dd_context"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "collapsed_sector_id parameter is required",
    });
  });

  it("rejects invalid metrics locally", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_context?collapsed_sector_id=EGTTFIS&time_range=07:00:00-07:30:00&metrics=hc,not_real",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported metrics value: not_real",
    });
  });

  it("forwards comma-separated metrics to the backend", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ slots: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;
    global.fetch = fetchSpy;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_context?collapsed_sector_id=EGTTFIS&time_range=07:00:00-07:30:00&metrics=hc&metrics=cp25_proxy",
      ),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "metrics=hc%2Ccp25_proxy",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ slots: [] });
  });

  it("passes through upstream 500 payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Aggregate cache unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_context?collapsed_sector_id=EGTTFIS&time_range=07:00:00-07:30:00",
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Aggregate cache unavailable",
    });
  });
});
