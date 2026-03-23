import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/flows/route";

describe("GET /api/flows", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("passes through backend JSON validation errors", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "threshold must be a float in [0,1]" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/flows?tvs=TVA&from_time_str=060000&to_time_str=070000"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "threshold must be a float in [0,1]" });
  });

  it("passes through backend 503 FL-artifact failures", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Missing precomputed FL interval artifact", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/flows?tvs=TVA&from_time_str=060000&to_time_str=070000"),
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Missing precomputed FL interval artifact");
  });

  it("returns successful backend responses unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ num_time_bins: 96, tvs: ["TVA"], timebins: [24], flows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/flows?tvs=TVA&from_time_str=060000&to_time_str=070000"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      num_time_bins: 96,
      tvs: ["TVA"],
      timebins: [24],
      flows: [],
    });
  });
});
