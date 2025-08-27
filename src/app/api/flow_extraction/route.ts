import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');
  const refTimeStr = searchParams.get('ref_time_str');
  const threshold = searchParams.get('threshold');
  const resolution = searchParams.get('resolution');
  const seed = searchParams.get('seed');
  const limit = searchParams.get('limit');
  const flightIds = searchParams.get('flight_ids'); // optional, comma-separated

  if (!trafficVolumeId || !refTimeStr) {
    return NextResponse.json(
      { error: 'traffic_volume_id and ref_time_str parameters are required' },
      { status: 400 }
    );
  }

  try {
    const params = new URLSearchParams();
    params.set('traffic_volume_id', trafficVolumeId);
    params.set('ref_time_str', refTimeStr);
    if (threshold) params.set('threshold', threshold);
    if (resolution) params.set('resolution', resolution);
    if (seed) params.set('seed', seed);
    if (limit) params.set('limit', limit);
    if (flightIds) params.set('flight_ids', flightIds);

    const endpoint = `${API_BASE_URL}/flow_extraction?${params.toString()}`;
    const response = await fetch(endpoint, { headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
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


