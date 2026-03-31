import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/collapsed_sector_dd_trace/route";

describe("GET /api/collapsed_sector_dd_trace", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("rejects invalid metrics locally", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_trace?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&metrics=hc,not_real",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported metrics value: not_real",
    });
  });

  it("rejects invalid max_records_per_metric locally", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_trace?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&max_records_per_metric=-1",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "max_records_per_metric must be a non-negative integer",
    });
  });

  it("forwards comma-separated metrics to the backend", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ snapshots: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;
    global.fetch = fetchSpy;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_trace?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&metrics=hc&metrics=cp25_proxy",
      ),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "metrics=hc%2Ccp25_proxy",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ snapshots: [] });
  });

  it("passes through upstream 503 payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "DD resources cannot be initialized" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_trace?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&metrics=hc",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "DD resources cannot be initialized",
    });
  });
});
