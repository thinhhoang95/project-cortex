import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function parseUpstreamBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  const text = raw.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collapsedSectorId = String(searchParams.get("collapsed_sector_id") ?? "").trim();
  const timeRange = String(searchParams.get("time_range") ?? "").trim();
  const sampleSecondsRaw = searchParams.get("sample_seconds");

  if (!collapsedSectorId) {
    return NextResponse.json({ error: "collapsed_sector_id parameter is required" }, { status: 400 });
  }

  if (!timeRange) {
    return NextResponse.json({ error: "time_range parameter is required" }, { status: 400 });
  }

  const params = new URLSearchParams({
    collapsed_sector_id: collapsedSectorId,
    time_range: timeRange,
  });

  if (sampleSecondsRaw !== null) {
    const parsed = Number.parseInt(sampleSecondsRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "sample_seconds must be a positive integer" },
        { status: 400 },
      );
    }
    params.set("sample_seconds", String(parsed));
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/collapsed_sector_dd_suite?${params.toString()}`, {
      method: "GET",
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const payload = await parseUpstreamBody(upstream);
    if (!upstream.ok) {
      return NextResponse.json(payload ?? {}, { status: upstream.status });
    }

    return NextResponse.json(payload ?? {});
  } catch (error) {
    console.error("Error fetching collapsed_sector_dd_suite:", error);
    return NextResponse.json(
      { error: "Failed to fetch collapsed sector DD suite" },
      { status: 500 },
    );
  }
}
