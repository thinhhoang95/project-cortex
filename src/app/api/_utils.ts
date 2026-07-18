import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Merge base headers with Authorization bearer from the incoming request
export function withAuth(request: NextRequest, base?: HeadersInit): HeadersInit {
  const merged: Record<string, string> = {};

  // Normalize base headers into a plain object
  if (base instanceof Headers) {
    base.forEach((v, k) => { merged[k] = v as string; });
  } else if (Array.isArray(base)) {
    for (const [k, v] of base) merged[String(k)] = String(v);
  } else if (base && typeof base === 'object') {
    Object.assign(merged, base as Record<string, string>);
  }

  const auth = request.headers.get('authorization');
  if (auth) {
    merged['Authorization'] = auth;
  }
  return merged;
}

// Normalize upstream 401 responses so the client can react (e.g. clear token / redirect)
export async function maybeHandleUnauthorized(
  resp: Response,
  fallbackMessage = 'Unauthorized'
): Promise<NextResponse | null> {
  if (resp.status !== 401) return null;

  let message = fallbackMessage;
  try {
    const raw = await resp.text();
    const text = raw?.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        const detail = parsed?.detail ?? parsed?.error ?? parsed?.message ?? parsed?.msg;
        if (detail) {
          message = String(detail);
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
  } catch {
    // ignore body parsing errors; fall back to generic message
  }

  return NextResponse.json({ error: message }, { status: 401 });
}

// Forward successful JSON responses without buffering and serializing large payloads again.
export function forwardUpstreamJson(resp: Response): NextResponse {
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "x-resource-date", "x-resource-state-id"]) {
    const value = resp.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(resp.body, {
    status: resp.status,
    headers,
  });
}

