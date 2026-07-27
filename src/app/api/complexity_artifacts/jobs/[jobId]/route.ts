import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  try {
    const upstream = await fetch(
      `${API_BASE_URL}/complexity_artifacts/jobs/${encodeURIComponent(jobId)}`,
      {
        headers: withAuth(request, { "Content-Type": "application/json" }),
        cache: "no-store",
      },
    );
    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;
    const payload = await upstream.json().catch(() => ({}));
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    console.error("Error proxying complexity artifact job:", error);
    return NextResponse.json({ error: "Complexity service is unavailable" }, { status: 503 });
  }
}
