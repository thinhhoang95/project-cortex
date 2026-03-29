import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/preview_rads_for_traffic_volume/route";

describe("GET /api/preview_rads_for_traffic_volume", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("rejects blank traffic_volume_id locally", async () => {
    const response = await GET(new NextRequest("http://localhost/api/preview_rads_for_traffic_volume"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "traffic_volume_id parameter is required" });
  });

  it("rejects invalid limits locally", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/preview_rads_for_traffic_volume?traffic_volume_id=TV1&limit=999",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "limit must be an integer between 1 and 250" });
  });

  it("passes through backend validation errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "traffic volume is not tv_kind=as" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/preview_rads_for_traffic_volume?traffic_volume_id=TV1&limit=25",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "traffic volume is not tv_kind=as" });
  });

  it("returns successful backend responses unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ rad_id: "RAD1", total_instances: 1 }],
          count: 1,
          total_available: 1,
          limit: 25,
          truncated: false,
          traffic_volume_id: "TV1",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/preview_rads_for_traffic_volume?traffic_volume_id=TV1&limit=25",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ rad_id: "RAD1", total_instances: 1 }],
      count: 1,
      total_available: 1,
      limit: 25,
      truncated: false,
      traffic_volume_id: "TV1",
    });
  });
});
