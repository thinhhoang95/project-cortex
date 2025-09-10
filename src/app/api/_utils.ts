import type { NextRequest } from 'next/server';

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

