import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

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

  if (!trafficVolumeId || !timeWindow) {
    return NextResponse.json(
      { error: 'Missing required fields: traffic_volume_id and time_window' },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    traffic_volume_id: String(trafficVolumeId),
    time_window: String(timeWindow),
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
      const text = await resp.text();
      return NextResponse.json(
        { error: `Backend error: ${resp.status}`, details: text || undefined },
        { status: resp.status }
      );
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
