import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = String(searchParams.get("traffic_volume_id") ?? "").trim();
  const limitRaw = searchParams.get("limit");

  if (!trafficVolumeId) {
    return NextResponse.json({ error: "traffic_volume_id parameter is required" }, { status: 400 });
  }

  const params = new URLSearchParams({ traffic_volume_id: trafficVolumeId });

  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 250) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 250" },
        { status: 400 },
      );
    }
    params.set("limit", String(parsed));
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/preview_rads_for_traffic_volume?${params.toString()}`, {
      method: "GET",
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message =
        payload?.detail ||
        payload?.error ||
        `Failed to fetch traffic-volume RAD previews (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching preview_rads_for_traffic_volume:", error);
    return NextResponse.json(
      { error: "Failed to fetch traffic-volume RAD previews" },
      { status: 500 },
    );
  }
}
