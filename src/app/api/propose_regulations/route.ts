import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

function parsePositiveInteger(value: unknown, name: string): number | null | NextResponse {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NextResponse.json(
      { error: `${name} must be a positive integer when provided` },
      { status: 400 }
    );
  }
  return Math.floor(parsed);
}

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
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 }
    );
  }

  const trafficVolumeId = body.traffic_volume_id;
  const timeWindow = body.time_window;
  const topKRaw = body.top_k_regulations;
  const minFlights = parsePositiveInteger(body.min_flights, 'min_flights');
  const vpfMaxFlows = parsePositiveInteger(body.vpf_max_flows, 'vpf_max_flows');

  if (!trafficVolumeId || !timeWindow) {
    return NextResponse.json(
      { error: 'Missing required fields: traffic_volume_id and time_window' },
      { status: 400 }
    );
  }
  if (minFlights instanceof NextResponse) return minFlights;
  if (vpfMaxFlows instanceof NextResponse) return vpfMaxFlows;

  const payload: Record<string, unknown> = {
    traffic_volume_id: String(trafficVolumeId),
    time_window: String(timeWindow),
    extractor: 'vpf',
  };

  if (topKRaw !== undefined) {
    const topK = Number(topKRaw);
    if (!Number.isFinite(topK) || topK <= 0) {
      return NextResponse.json(
        { error: 'top_k_regulations must be a positive number when provided' },
        { status: 400 }
      );
    }
    payload.top_k_regulations = Math.floor(topK);
  }

  if (minFlights !== null) payload.min_flights = minFlights;
  if (vpfMaxFlows !== null) payload.vpf_max_flows = vpfMaxFlows;

  try {
    const endpoint = `${API_BASE_URL}/propose_regulations`;
    const resp = await fetch(endpoint, {
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
    console.error('Error proxying propose_regulations:', error);
    return NextResponse.json(
      { error: 'Failed to contact backend propose_regulations endpoint', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
