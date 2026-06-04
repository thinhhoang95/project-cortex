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

function parseMetricId(searchParams: URLSearchParams): ComplexityMetricId {
  const metricId = String(searchParams.get("metric_id") ?? "").trim();
  if (!metricId) {
    throw new Error("metric_id parameter is required");
  }
  if (!VALID_METRICS.has(metricId)) {
    throw new Error(`Unsupported metric_id value: ${metricId}`);
  }
  return metricId as ComplexityMetricId;
}

function parseThreshold(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get("threshold");
  if (raw === null || !String(raw).trim()) return null;
  const threshold = Number(raw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("threshold must be a number in [0, 1]");
  }
  return threshold;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  let metricId: ComplexityMetricId;
  try {
    metricId = parseMetricId(searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid metric_id parameter" },
      { status: 400 },
    );
  }

  let threshold: number | null = null;
  try {
    threshold = parseThreshold(searchParams);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid threshold parameter" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    metric_id: metricId,
  });

  const timeRange = String(searchParams.get("time_range") ?? "").trim();
  if (timeRange) {
    params.set("time_range", timeRange);
  }
  if (threshold !== null) {
    params.set("threshold", String(threshold));
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/collapsed_sector_dd_hotspots?${params.toString()}`, {
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
    console.error("Error fetching collapsed_sector_dd_hotspots:", error);
    return NextResponse.json(
      { error: "Failed to fetch collapsed sector DD hotspots" },
      { status: 500 },
    );
  }
}
