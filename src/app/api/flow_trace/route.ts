import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

async function passThroughError(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  }
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: text
      ? { 'Content-Type': contentType || 'text/plain; charset=utf-8' }
      : undefined,
  });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid JSON payload', details: error instanceof Error ? error.message : undefined },
      { status: 400 },
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const rawFlightIds = body.flight_ids;
  if (!Array.isArray(rawFlightIds) || rawFlightIds.length === 0) {
    return NextResponse.json(
      { error: 'flight_ids is required and must be a non-empty array' },
      { status: 400 },
    );
  }
  if (rawFlightIds.some((flightId) => typeof flightId !== 'string')) {
    return NextResponse.json(
      { error: 'flight_ids entries must be strings' },
      { status: 400 },
    );
  }

  const flightIds = Array.from(
    new Set(rawFlightIds.map((flightId) => String(flightId).trim()).filter(Boolean)),
  );
  if (flightIds.length === 0) {
    return NextResponse.json(
      { error: 'flight_ids must contain at least one non-empty string' },
      { status: 400 },
    );
  }

  const scope = String(body.scope ?? 'visited_footprint').trim() || 'visited_footprint';
  if (scope !== 'visited_footprint') {
    return NextResponse.json(
      { error: "scope must be 'visited_footprint'" },
      { status: 400 },
    );
  }

  const payload = {
    flight_ids: flightIds,
    scope,
  };

  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const resp = await fetch(`${backendUrl}/flow_trace`, {
      method: 'POST',
      headers: withAuth(request, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const unauthorized = await maybeHandleUnauthorized(resp);
    if (unauthorized) return unauthorized;

    if (!resp.ok) {
      return passThroughError(resp);
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying flow_trace:', error);
    return NextResponse.json(
      { error: 'Failed to contact backend flow_trace endpoint', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
