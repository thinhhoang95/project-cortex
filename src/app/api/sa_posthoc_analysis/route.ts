import { NextRequest, NextResponse } from "next/server";
import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const runId = requestUrl.searchParams.get("run_id");
  const series = requestUrl.searchParams.get("series");

  if (!runId || !runId.trim()) {
    return NextResponse.json(
      { error: "run_id query parameter is required" },
      { status: 400 },
    );
  }

  if (series && series !== "best" && series !== "current") {
    return NextResponse.json(
      { error: "series must be either 'best' or 'current'" },
      { status: 400 },
    );
  }

  const upstreamUrl = new URL(`${API_BASE_URL}/sa_posthoc_analysis`);
  upstreamUrl.searchParams.set("run_id", runId.trim());
  if (series) {
    upstreamUrl.searchParams.set("series", series);
  }

  try {
    const response = await fetch(upstreamUrl.toString(), {
      headers: withAuth(request),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Failed to fetch SA posthoc analysis",
          details: body || `Upstream responded with status ${response.status}`,
        },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching SA posthoc analysis:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch SA posthoc analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
