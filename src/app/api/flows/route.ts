import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

// Proxies to backend flows endpoint
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tvs = (searchParams.get('tvs') || '').trim();
  const fromTimeStr = (searchParams.get('from_time_str') || '').trim();
  const toTimeStr = (searchParams.get('to_time_str') || '').trim();
  const threshold = (searchParams.get('threshold') || '').trim();
  const resolution = (searchParams.get('resolution') || '').trim();

  // Basic validation mirroring backend contract
  if (!tvs) {
    return NextResponse.json(
      { error: 'tvs parameter is required' },
      { status: 400 }
    );
  }

  // Validate time string params (expected format HHMMSS as zero-padded digits)
  const isValidTimeStr = (s: string) => {
    if (!s || s.length !== 6 || /[^0-9]/.test(s)) return false;
    const hh = Number(s.slice(0,2));
    const mm = Number(s.slice(2,4));
    const ss = Number(s.slice(4,6));
    return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59;
  };

  if ((fromTimeStr && !toTimeStr) || (!fromTimeStr && toTimeStr)) {
    return NextResponse.json(
      { error: 'both from_time_str and to_time_str must be provided together' },
      { status: 400 }
    );
  }

  if (fromTimeStr && toTimeStr) {
    if (!isValidTimeStr(fromTimeStr) || !isValidTimeStr(toTimeStr)) {
      return NextResponse.json(
        { error: 'from_time_str and to_time_str must be in HHMMSS format' },
        { status: 400 }
      );
    }
  }

  if (threshold) {
    const v = Number(threshold);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return NextResponse.json(
        { error: 'threshold must be a float in [0,1]' },
        { status: 400 }
      );
    }
  }

  if (resolution) {
    const v = Number(resolution);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json(
        { error: 'resolution must be a positive float' },
        { status: 400 }
      );
    }
  }

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const params = new URLSearchParams();
    params.set('tvs', tvs);
    if (fromTimeStr) params.set('from_time_str', fromTimeStr);
    if (toTimeStr) params.set('to_time_str', toTimeStr);
    if (threshold) params.set('threshold', threshold);
    if (resolution) params.set('resolution', resolution);

    const url = `${backendUrl}/flows?${params.toString()}`;
    const resp = await fetch(url, { headers: withAuth(request, { 'Content-Type': 'application/json' }) });

    const unauthorized = await maybeHandleUnauthorized(resp);
    if (unauthorized) return unauthorized;

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Backend error: ${resp.status}`, details: text },
        { status: 502 }
      );
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('flows proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy flows request', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
