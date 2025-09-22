import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

// Proxies to backend original_flight_contrib_counts endpoint (POST JSON)
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

    const body: Record<string, any> = {
      flight_ids: payload.flight_ids.map((id: unknown) => String(id)),
    };

    if (Array.isArray(payload.traffic_volume_ids) && payload.traffic_volume_ids.length > 0) {
      body.traffic_volume_ids = payload.traffic_volume_ids.map((x: any) => String(x));
    }
    if (typeof payload.from_time_str === 'string' && payload.from_time_str.trim()) {
      body.from_time_str = payload.from_time_str.trim();
    }
    if (typeof payload.to_time_str === 'string' && payload.to_time_str.trim()) {
      body.to_time_str = payload.to_time_str.trim();
    }
    if (typeof payload.rank_by === 'string' && payload.rank_by.trim()) {
      body.rank_by = payload.rank_by.trim();
    }
    if (typeof payload.rolling_hour === 'boolean') {
      body.rolling_hour = payload.rolling_hour;
    }

    const resp = await fetch(`${backendUrl}/original_flight_contrib_counts`, {
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
    console.error('original_flight_contrib_counts proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy original_flight_contrib_counts', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function safeParseJSON(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}


