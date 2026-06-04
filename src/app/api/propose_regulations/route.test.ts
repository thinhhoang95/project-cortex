import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/propose_regulations/route";

describe("POST /api/propose_regulations", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("forwards VPF controls and drops retired CD controls", async () => {
    process.env.BACKEND_URL = "http://backend.test";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ proposals: [], extractor: "vpf" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await POST(
      new NextRequest("http://localhost/api/propose_regulations", {
        method: "POST",
        body: JSON.stringify({
          traffic_volume_id: "TVA",
          time_window: "06:00-07:00",
          top_k_regulations: 3,
          min_flights: 4,
          vpf_max_flows: 20,
          threshold: 0.8,
          resolution: 1,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://backend.test/propose_regulations");
    const payload = JSON.parse(String((init as RequestInit)?.body));
    expect(payload).toEqual({
      traffic_volume_id: "TVA",
      time_window: "06:00-07:00",
      extractor: "vpf",
      top_k_regulations: 3,
      min_flights: 4,
      vpf_max_flows: 20,
    });
  });

  it("passes backend JSON errors through", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "CD selector is retired" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await POST(
      new NextRequest("http://localhost/api/propose_regulations", {
        method: "POST",
        body: JSON.stringify({
          traffic_volume_id: "TVA",
          time_window: "06:00-07:00",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "CD selector is retired" });
  });
});
