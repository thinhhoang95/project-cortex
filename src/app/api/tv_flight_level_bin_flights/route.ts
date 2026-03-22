import { NextRequest, NextResponse } from "next/server";
import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const upstreamUrl = `${API_BASE_URL}/tv_flight_level_bin_flights?${request.nextUrl.searchParams.toString()}`;

  try {
    const response = await fetch(upstreamUrl, {
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      if (typeof payload === "string") {
        return new NextResponse(payload || "Failed to fetch TV FL-bin flights", {
          status: response.status,
          headers: contentType ? { "Content-Type": contentType } : undefined,
        });
      }
      return NextResponse.json(
        payload || { error: "Failed to fetch TV FL-bin flights" },
        { status: response.status },
      );
    }

    if (typeof payload === "string") {
      return new NextResponse(payload, {
        status: response.status,
        headers: contentType ? { "Content-Type": contentType } : undefined,
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching TV flight-level-bin flights:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch TV flight-level-bin flights",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
