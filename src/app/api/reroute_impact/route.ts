import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid JSON payload",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  if (!Array.isArray(payload.flight_ids) || !payload.barred_polygons || typeof payload.barred_polygons !== "object") {
    return NextResponse.json(
      {
        error: "Missing required fields: flight_ids and barred_polygons",
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${API_BASE_URL}/reroute_impact`, {
      method: "POST",
      headers: withAuth(request, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(payload),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          error: `Backend error: ${response.status}`,
          details: text || undefined,
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("reroute_impact proxy error", error);
    return NextResponse.json(
      {
        error: "Failed to contact backend reroute_impact endpoint",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
