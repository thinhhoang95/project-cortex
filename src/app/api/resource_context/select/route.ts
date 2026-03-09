import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = typeof body?.date === "string" ? body.date.trim() : "";

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const upstream = await fetch(`${API_BASE_URL}/resource_context/select`, {
      method: "POST",
      headers: withAuth(request, { "Content-Type": "application/json" }),
      body: JSON.stringify({ date }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message = payload?.detail || payload?.error || `Failed to select resource date (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error selecting resource date:", error);
    return NextResponse.json({ error: "Failed to select resource date" }, { status: 500 });
  }
}
