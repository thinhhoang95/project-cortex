import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000'

function parsePositiveInteger(value: string | null, name: string): number | null | NextResponse {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NextResponse.json({ error: `${name} must be a positive integer` }, { status: 400 });
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');
  const refTimeStr = searchParams.get('ref_time_str');
  const windowMinutes = parsePositiveInteger(searchParams.get('window_minutes'), 'window_minutes');
  const minFlights = parsePositiveInteger(searchParams.get('min_flights'), 'min_flights');
  const vpfMaxFlows = parsePositiveInteger(searchParams.get('vpf_max_flows'), 'vpf_max_flows');

  if (!trafficVolumeId || !refTimeStr) {
    return NextResponse.json(
      { error: 'traffic_volume_id and ref_time_str parameters are required' },
      { status: 400 }
    );
  }
  if (windowMinutes instanceof NextResponse) return windowMinutes;
  if (minFlights instanceof NextResponse) return minFlights;
  if (vpfMaxFlows instanceof NextResponse) return vpfMaxFlows;

  try {
    const params = new URLSearchParams();
    params.set('traffic_volume_id', trafficVolumeId);
    params.set('ref_time_str', refTimeStr);
    params.set('extractor', 'vpf');
    if (windowMinutes !== null) params.set('window_minutes', String(windowMinutes));
    if (minFlights !== null) params.set('min_flights', String(minFlights));
    if (vpfMaxFlows !== null) params.set('vpf_max_flows', String(vpfMaxFlows));

    const endpoint = `${API_BASE_URL}/flow_extraction?${params.toString()}`;
    const response = await fetch(endpoint, { headers: withAuth(request, { 'Content-Type': 'application/json' }) });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      return passThroughError(response);
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching flow extraction data:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch flow extraction data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

