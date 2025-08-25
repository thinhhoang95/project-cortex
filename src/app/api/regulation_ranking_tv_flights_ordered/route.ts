import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');
  const refTimeStr = searchParams.get('ref_time_str');
  const seedFlightIds = searchParams.get('seed_flight_ids');
  const durationMin = searchParams.get('duration_min');
  const topK = searchParams.get('top_k');

  if (!trafficVolumeId) {
    return NextResponse.json(
      { error: 'traffic_volume_id parameter is required' },
      { status: 400 }
    );
  }
  if (!refTimeStr) {
    return NextResponse.json(
      { error: 'ref_time_str parameter is required' },
      { status: 400 }
    );
  }
  // Accept empty seed list, but require the parameter to exist
  if (seedFlightIds === null) {
    return NextResponse.json(
      { error: 'seed_flight_ids parameter is required (can be empty)' },
      { status: 400 }
    );
  }

  try {
    const url = new URL(`${API_BASE_URL}/regulation_ranking_tv_flights_ordered`);
    url.searchParams.set('traffic_volume_id', trafficVolumeId);
    url.searchParams.set('ref_time_str', refTimeStr);
    url.searchParams.set('seed_flight_ids', seedFlightIds);
    if (durationMin) url.searchParams.set('duration_min', durationMin);
    if (topK) url.searchParams.set('top_k', topK);

    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching regulation ranking:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch regulation ranking',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


