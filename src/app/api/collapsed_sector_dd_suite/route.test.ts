import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/collapsed_sector_dd_suite/route";

describe("GET /api/collapsed_sector_dd_suite", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("rejects blank collapsed sector ids locally", async () => {
    const response = await GET(new NextRequest("http://localhost/api/collapsed_sector_dd_suite"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "collapsed_sector_id parameter is required",
    });
  });

  it("rejects invalid sample_seconds locally", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_suite?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&sample_seconds=0",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "sample_seconds must be a positive integer",
    });
  });

  it("passes through upstream 404 payloads", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unknown collapsed_sector_id" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_suite?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Unknown collapsed_sector_id" });
  });

  it("returns successful upstream payloads unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          collapsed_sector_id: "EGTTFIS",
          sample_seconds: 120,
          snapshots: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/collapsed_sector_dd_suite?collapsed_sector_id=EGTTFIS&time_range=07:00:00-08:00:00&sample_seconds=120",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      collapsed_sector_id: "EGTTFIS",
      sample_seconds: 120,
      snapshots: [],
    });
  });
});
