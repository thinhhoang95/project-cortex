import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const radId = String(searchParams.get("rad_id") ?? "").trim();
  const legitimacyFlag = String(searchParams.get("legitimacy_flag") ?? "").trim().toUpperCase();

  if (!radId) {
    return NextResponse.json({ error: "rad_id parameter is required" }, { status: 400 });
  }
  if (legitimacyFlag !== "L" && legitimacyFlag !== "I") {
    return NextResponse.json(
      { error: "legitimacy_flag must be L or I" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    rad_id: radId,
    legitimacy_flag: legitimacyFlag,
  });

  try {
    const upstream = await fetch(`${API_BASE_URL}/preview_rad_flight_list?${params.toString()}`, {
      method: "GET",
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message =
        payload?.detail || payload?.error || `Failed to fetch RAD flight list (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching preview_rad_flight_list:", error);
    return NextResponse.json({ error: "Failed to fetch RAD flight list" }, { status: 500 });
  }
}
