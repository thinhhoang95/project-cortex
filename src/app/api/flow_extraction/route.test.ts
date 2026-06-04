import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/flow_extraction/route";

describe("GET /api/flow_extraction", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("forwards only VPF extractor parameters", async () => {
    process.env.BACKEND_URL = "http://backend.test";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ extractor: "vpf", groups: {}, flows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/flow_extraction?traffic_volume_id=TVA&ref_time_str=060000&window_minutes=45&min_flights=4&vpf_max_flows=20&threshold=0.8&resolution=1&flight_ids=F1,F2&seed=123&limit=10",
      ),
    );

    expect(response.status).toBe(200);
    const calledUrl = new URL(String(vi.mocked(global.fetch).mock.calls[0]?.[0]));
    expect(calledUrl.pathname).toBe("/flow_extraction");
    expect(calledUrl.searchParams.get("traffic_volume_id")).toBe("TVA");
    expect(calledUrl.searchParams.get("ref_time_str")).toBe("060000");
    expect(calledUrl.searchParams.get("extractor")).toBe("vpf");
    expect(calledUrl.searchParams.get("window_minutes")).toBe("45");
    expect(calledUrl.searchParams.get("min_flights")).toBe("4");
    expect(calledUrl.searchParams.get("vpf_max_flows")).toBe("20");
    expect(calledUrl.searchParams.has("threshold")).toBe(false);
    expect(calledUrl.searchParams.has("resolution")).toBe(false);
    expect(calledUrl.searchParams.has("flight_ids")).toBe(false);
    expect(calledUrl.searchParams.has("seed")).toBe(false);
    expect(calledUrl.searchParams.has("limit")).toBe(false);
  });

  it("passes backend migration errors through", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Community-detection flow extraction is retired. Use extractor='vpf'.", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    ) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/flow_extraction?traffic_volume_id=TVA&ref_time_str=060000"),
    );

    expect(response.status).toBe(410);
    await expect(response.text()).resolves.toBe("Community-detection flow extraction is retired. Use extractor='vpf'.");
  });
});
