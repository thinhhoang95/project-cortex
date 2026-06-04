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

  it("forwards VPF parameters and drops retired CD parameters", async () => {
    process.env.BACKEND_URL = "http://backend.test";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ num_time_bins: 96, tvs: ["TVA"], timebins: [24], flows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/flows?tvs=TVA&from_time_str=060000&to_time_str=070000&min_flights=4&vpf_max_flows=20&threshold=0.8&resolution=1"),
    );

    expect(response.status).toBe(200);
    const calledUrl = new URL(String(vi.mocked(global.fetch).mock.calls[0]?.[0]));
    expect(calledUrl.origin).toBe("http://backend.test");
    expect(calledUrl.pathname).toBe("/flows");
    expect(calledUrl.searchParams.get("tvs")).toBe("TVA");
    expect(calledUrl.searchParams.get("extractor")).toBe("vpf");
    expect(calledUrl.searchParams.get("min_flights")).toBe("4");
    expect(calledUrl.searchParams.get("vpf_max_flows")).toBe("20");
    expect(calledUrl.searchParams.has("threshold")).toBe(false);
    expect(calledUrl.searchParams.has("resolution")).toBe(false);
  });

  it("rejects multi-TV VPF requests locally", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/flows?tvs=TVA,TVB&from_time_str=060000&to_time_str=070000"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "VPF flow extraction requires exactly one primary tvs value" });
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
