import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";
import { COMPLEXITY_METRIC_IDS, type ComplexityMetricId } from "@/lib/csComplexity";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";
const VALID_METRICS = new Set<string>(COMPLEXITY_METRIC_IDS);

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

function parseMetrics(searchParams: URLSearchParams): ComplexityMetricId[] {
  const rawValues = searchParams.getAll("metrics");
  const metrics = rawValues
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const invalid = metrics.find((metric) => !VALID_METRICS.has(metric));
  if (invalid) {
    throw new Error(`Unsupported metrics value: ${invalid}`);
  }

  return Array.from(new Set(metrics)) as ComplexityMetricId[];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const collapsedSectorId = String(searchParams.get("collapsed_sector_id") ?? "").trim();
  const timeRange = String(searchParams.get("time_range") ?? "").trim();

  if (!collapsedSectorId) {
    return NextResponse.json({ error: "collapsed_sector_id parameter is required" }, { status: 400 });
  }

  if (!timeRange) {
    return NextResponse.json({ error: "time_range parameter is required" }, { status: 400 });
  }

  let metrics: ComplexityMetricId[] = [];
  try {
    metrics = parseMetrics(searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid metrics parameter" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    collapsed_sector_id: collapsedSectorId,
    time_range: timeRange,
  });

  if (metrics.length > 0) {
    params.set("metrics", metrics.join(","));
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/collapsed_sector_dd_context?${params.toString()}`, {
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
    console.error("Error fetching collapsed_sector_dd_context:", error);
    return NextResponse.json(
      { error: "Failed to fetch collapsed sector DD context" },
      { status: 500 },
    );
  }
}
