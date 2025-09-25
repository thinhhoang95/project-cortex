import { NextRequest, NextResponse } from "next/server";
import { maybeHandleUnauthorized, withAuth } from "@/app/api/_utils";

const ALLOWED_OPTION_KEYS = ["select", "order_by", "limit", "deduplicate", "flight_ids", "debug"] as const;

type AllowedOptionKey = (typeof ALLOWED_OPTION_KEYS)[number];

function sanitizeFlightIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || item === undefined) continue;
    const id = String(item).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [];
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    const payload = await request.json().catch(() => ({}));
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";

    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const body: Record<string, any> = { prompt };

    if (typeof payload.model === "string" && payload.model.trim().length > 0) {
      body.model = payload.model.trim();
    }

    const optionsPayload = payload.options && typeof payload.options === "object" ? payload.options : undefined;
    if (optionsPayload) {
      const sanitizedOptions: Record<string, any> = {};
      for (const key of ALLOWED_OPTION_KEYS) {
        if (!(key in optionsPayload)) continue;
        const value = (optionsPayload as Record<AllowedOptionKey, any>)[key];
        if (key === "flight_ids") {
          const ids = sanitizeFlightIds(value);
          if (ids && ids.length > 0) {
            sanitizedOptions.flight_ids = ids;
          }
          continue;
        }
        sanitizedOptions[key] = value;
      }
      if (Object.keys(sanitizedOptions).length > 0) {
        body.options = sanitizedOptions;
      }
    }

    const resp = await fetch(`${backendUrl}/flight_query_nlp`, {
      method: "POST",
      headers: withAuth(request, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    const unauthorized = await maybeHandleUnauthorized(resp);
    if (unauthorized) return unauthorized;

    const text = await resp.text();
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Backend error: ${resp.status}`, details: safeParseJSON(text) ?? text },
        { status: resp.status === 404 ? 404 : 502 }
      );
    }

    const data = safeParseJSON(text);
    return NextResponse.json(data ?? {});
  } catch (err) {
    console.error("flight_query_nlp proxy error", err);
    return NextResponse.json(
      { error: "Failed to proxy flight_query_nlp", details: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

function safeParseJSON(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
