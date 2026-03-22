import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

function normalizeTrafficVolumeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}));
    const trafficVolumeIds = normalizeTrafficVolumeIds(payload?.traffic_volume_ids);
    const refTimeStr =
      typeof payload?.ref_time_str === "string" ? payload.ref_time_str.trim() : "";
    const glanceHorizonMinutes = Number(payload?.glance_horizon_minutes);
    const maxExtremaPerTv = Number(payload?.max_extrema_per_tv);

    if (trafficVolumeIds.length === 0) {
      return NextResponse.json(
        { error: "traffic_volume_ids must be a non-empty array" },
        { status: 400 },
      );
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(refTimeStr)) {
      return NextResponse.json(
        { error: "ref_time_str must use exact HH:MM:SS format" },
        { status: 400 },
      );
    }
    if (!Number.isFinite(glanceHorizonMinutes) || glanceHorizonMinutes <= 0) {
      return NextResponse.json(
        { error: "glance_horizon_minutes must be a positive number" },
        { status: 400 },
      );
    }
    if (!Number.isInteger(maxExtremaPerTv) || maxExtremaPerTv !== 2) {
      return NextResponse.json(
        { error: "max_extrema_per_tv must be the integer 2" },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${API_BASE_URL}/tv_dcb_glance`, {
      method: "POST",
      headers: withAuth(request, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        traffic_volume_ids: trafficVolumeIds,
        ref_time_str: refTimeStr,
        glance_horizon_minutes: glanceHorizonMinutes,
        max_extrema_per_tv: maxExtremaPerTv,
      }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream);
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const parsed = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message =
        parsed?.detail ||
        parsed?.error ||
        `Failed to fetch TV DCB glance (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error proxying tv_dcb_glance:", error);
    return NextResponse.json(
      { error: "Failed to proxy tv_dcb_glance" },
      { status: 500 },
    );
  }
}
