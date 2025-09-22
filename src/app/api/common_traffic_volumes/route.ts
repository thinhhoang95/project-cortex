import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const payload = await request.json().catch(() => ({}));

    if (!Array.isArray(payload.flight_ids) || payload.flight_ids.length === 0) {
      return NextResponse.json(
        { error: 'flight_ids array is required' },
        { status: 400 }
      );
    }

    const body = {
      flight_ids: payload.flight_ids.map((id: unknown) => String(id)),
    };

    const resp = await fetch(`${backendUrl}/common_traffic_volumes`, {
      method: 'POST',
      headers: withAuth(request, { 'Content-Type': 'application/json' }),
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
    console.error('common_traffic_volumes proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy common_traffic_volumes', details: err instanceof Error ? err.message : 'Unknown error' },
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
