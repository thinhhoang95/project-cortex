import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parentStateId =
      body && typeof body === "object" && typeof body.parent_state_id === "string"
        ? body.parent_state_id.trim()
        : "";
    const label =
      body && typeof body === "object" && typeof body.label === "string"
        ? body.label.trim()
        : "";
    const metadata =
      body && typeof body === "object" && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : undefined;
    const delaysMin =
      body && typeof body === "object" && body.delays_min && typeof body.delays_min === "object" && !Array.isArray(body.delays_min)
        ? body.delays_min
        : null;

    if (!parentStateId) {
      return NextResponse.json({ error: "parent_state_id is required" }, { status: 400 });
    }

    if (!delaysMin) {
      return NextResponse.json({ error: "delays_min must be an object" }, { status: 400 });
    }

    const upstreamBody: Record<string, unknown> = {
      parent_state_id: parentStateId,
      delays_min: delaysMin,
    };

    if (label) {
      upstreamBody.label = label;
    }
    if (metadata) {
      upstreamBody.metadata = metadata;
    }

    const upstream = await fetch(`${API_BASE_URL}/resource_state_history_commit`, {
      method: "POST",
      headers: withAuth(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(upstreamBody),
    });

    const unauthorized = await maybeHandleUnauthorized(
      upstream,
      "Unauthorized",
    );
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message =
        payload?.detail ||
        payload?.error ||
        `Failed to commit resource state history (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error committing resource state history:", error);
    return NextResponse.json(
      { error: "Failed to commit resource state history" },
      { status: 500 },
    );
  }
}
