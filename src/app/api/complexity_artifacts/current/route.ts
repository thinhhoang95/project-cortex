import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function forward(request: NextRequest, method: "GET" | "POST") {
  try {
    const upstream = await fetch(`${API_BASE_URL}/complexity_artifacts/current${method === "POST" ? "/compute" : ""}`, {
      method,
      headers: withAuth(request, { "Content-Type": "application/json" }),
      body: method === "POST" ? await request.text() : undefined,
      cache: "no-store",
    });
    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;
    const payload = await upstream.json().catch(() => ({}));
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("Error proxying current complexity artifact:", error);
    return NextResponse.json({ error: "Complexity service is unavailable" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return forward(request, "GET");
}

export async function POST(request: NextRequest) {
  return forward(request, "POST");
}
