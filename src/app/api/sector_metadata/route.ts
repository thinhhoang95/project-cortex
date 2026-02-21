import { NextRequest, NextResponse } from "next/server";
import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const elementarySectorId = searchParams.get("elementary_sector_id");

  if (!elementarySectorId) {
    return NextResponse.json(
      { error: "elementary_sector_id parameter is required" },
      { status: 400 }
    );
  }

  try {
    const endpoint = `${API_BASE_URL}/sector_metadata?elementary_sector_id=${encodeURIComponent(elementarySectorId)}`;
    const response = await fetch(endpoint, {
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    const payload = await parseUpstreamBody(response);
    if (!response.ok) {
      return NextResponse.json(payload ?? {}, { status: response.status });
    }

    return NextResponse.json(payload ?? {});
  } catch (error) {
    console.error("Error fetching sector metadata:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch sector metadata",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
