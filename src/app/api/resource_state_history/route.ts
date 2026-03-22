import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(`${API_BASE_URL}/resource_state_history`, {
      method: "GET",
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message = payload?.detail || payload?.error || `Failed to fetch resource state history (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching resource state history:", error);
    return NextResponse.json({ error: "Failed to fetch resource state history" }, { status: 500 });
  }
}
