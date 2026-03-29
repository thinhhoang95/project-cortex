import { NextRequest, NextResponse } from "next/server";

import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const API_BASE_URL = process.env.BACKEND_URL || "http://localhost:8000";
const SUPPORTED_FIELDS = new Set(["Airway", "From", "To", "Point/Airspace", "Utilization"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = String(searchParams.get("search") ?? "").trim();
  const rawFields = searchParams.getAll("fields");
  const fields = rawFields.flatMap((value) =>
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const exactMatchRaw = searchParams.get("exact_match");
  const limitRaw = searchParams.get("limit");

  if (!search) {
    return NextResponse.json({ error: "search parameter is required" }, { status: 400 });
  }

  if (!fields.length) {
    return NextResponse.json({ error: "fields parameter is required" }, { status: 400 });
  }

  const unsupportedFields = fields.filter((field) => !SUPPORTED_FIELDS.has(field));
  if (unsupportedFields.length > 0) {
    return NextResponse.json(
      { error: `Unsupported fields: ${unsupportedFields.join(", ")}` },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({ search });
  for (const field of fields) {
    params.append("fields", field);
  }

  if (exactMatchRaw !== null) {
    const normalizedExactMatch = String(exactMatchRaw).trim().toLowerCase();
    if (normalizedExactMatch !== "true" && normalizedExactMatch !== "false") {
      return NextResponse.json(
        { error: "exact_match must be true or false" },
        { status: 400 },
      );
    }
    params.set("exact_match", normalizedExactMatch);
  }

  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 250) {
      return NextResponse.json(
        { error: "limit must be an integer between 1 and 250" },
        { status: 400 },
      );
    }
    params.set("limit", String(parsed));
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/preview_rads_search?${params.toString()}`, {
      method: "GET",
      headers: withAuth(request, { "Content-Type": "application/json" }),
    });

    const unauthorized = await maybeHandleUnauthorized(upstream, "Unauthorized");
    if (unauthorized) return unauthorized;

    const raw = await upstream.text();
    const payload = raw ? JSON.parse(raw) : {};

    if (!upstream.ok) {
      const message =
        payload?.detail || payload?.error || `Failed to search RAD previews (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error fetching preview_rads_search:", error);
    return NextResponse.json({ error: "Failed to search RAD previews" }, { status: 500 });
  }
}
