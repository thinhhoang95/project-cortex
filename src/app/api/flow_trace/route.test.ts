import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/flow_trace/route";

describe("POST /api/flow_trace", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.BACKEND_URL;
  });

  it("validates flight_ids locally", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/flow_trace", {
        method: "POST",
        body: JSON.stringify({ flight_ids: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "flight_ids is required and must be a non-empty array",
    });
  });

  it("forwards normalized visited-footprint requests with auth", async () => {
    process.env.BACKEND_URL = "http://backend.test";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ volume_ids: ["TVA"], volumes: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await POST(
      new NextRequest("http://localhost/api/flow_trace", {
        method: "POST",
        headers: { Authorization: "Bearer token-1" },
        body: JSON.stringify({
          flight_ids: ["F1", " F2 ", "F1"],
          scope: "visited_footprint",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://backend.test/flow_trace");
    expect((init as RequestInit)?.headers).toMatchObject({
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String((init as RequestInit)?.body))).toEqual({
      flight_ids: ["F1", "F2"],
      scope: "visited_footprint",
    });
  });

  it("passes backend JSON errors through", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "backend validation" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await POST(
      new NextRequest("http://localhost/api/flow_trace", {
        method: "POST",
        body: JSON.stringify({ flight_ids: ["F1"] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ detail: "backend validation" });
  });
});
