import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

function parsePositiveInteger(value: string, name: string): number | null | NextResponse {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NextResponse.json({ error: `${name} must be a positive integer` }, { status: 400 });
  }
  return Math.floor(parsed);
}

// Proxies to backend flows endpoint
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tvs = (searchParams.get('tvs') || '').trim();
  const timebinsRaw = (searchParams.get('timebins') || '').trim();
  const fromTimeStr = (searchParams.get('from_time_str') || '').trim();
  const toTimeStr = (searchParams.get('to_time_str') || '').trim();
  const minFlights = parsePositiveInteger((searchParams.get('min_flights') || '').trim(), 'min_flights');
  const vpfMaxFlows = parsePositiveInteger((searchParams.get('vpf_max_flows') || '').trim(), 'vpf_max_flows');
  let parsedTimebins: number[] | null = null;

  // Basic validation mirroring backend contract
  if (!tvs) {
    return NextResponse.json(
      { error: 'tvs parameter is required' },
      { status: 400 }
    );
  }
  const tvTokens = tvs.split(',').map((token) => token.trim()).filter(Boolean);
  if (tvTokens.length !== 1) {
    return NextResponse.json(
      { error: 'VPF flow extraction requires exactly one primary tvs value' },
      { status: 400 }
    );
  }
  if (minFlights instanceof NextResponse) return minFlights;
  if (vpfMaxFlows instanceof NextResponse) return vpfMaxFlows;

  if (timebinsRaw) {
    const tokens = timebinsRaw.split(',').map((token) => token.trim());
    if (tokens.length === 0 || tokens.some((token) => !/^-?\d+$/.test(token))) {
      return NextResponse.json(
        { error: 'timebins must be a comma-separated list of integers' },
        { status: 400 }
      );
    }
    parsedTimebins = tokens.map((token) => Number.parseInt(token, 10));
    if (parsedTimebins.some((value) => !Number.isInteger(value) || value < 0)) {
      return NextResponse.json(
        { error: 'timebins must contain non-negative integers' },
        { status: 400 }
      );
    }
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

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const params = new URLSearchParams();
    params.set('tvs', tvTokens[0]);
    params.set('extractor', 'vpf');
    if (parsedTimebins && parsedTimebins.length > 0) params.set('timebins', parsedTimebins.join(','));
    if (fromTimeStr) params.set('from_time_str', fromTimeStr);
    if (toTimeStr) params.set('to_time_str', toTimeStr);
    if (minFlights !== null) params.set('min_flights', String(minFlights));
    if (vpfMaxFlows !== null) params.set('vpf_max_flows', String(vpfMaxFlows));

    const url = `${backendUrl}/flows?${params.toString()}`;
    const resp = await fetch(url, { headers: withAuth(request, { 'Content-Type': 'application/json' }) });

    const unauthorized = await maybeHandleUnauthorized(resp);
    if (unauthorized) return unauthorized;

    if (!resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.toLowerCase().includes('application/json')) {
        const data = await resp.json();
        return NextResponse.json(data, { status: resp.status });
      }

      const text = await resp.text();
      return new NextResponse(text, {
        status: resp.status,
        headers: text
          ? { 'Content-Type': contentType || 'text/plain; charset=utf-8' }
          : undefined,
      });
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
