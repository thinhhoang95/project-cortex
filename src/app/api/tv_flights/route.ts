import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');
  const refTimeStr = searchParams.get('ref_time_str');

  if (!trafficVolumeId) {
    return NextResponse.json(
      { error: 'traffic_volume_id parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Use the new ordered endpoint if ref_time_str is provided, otherwise fall back to legacy
    const endpoint = refTimeStr 
      ? `${API_BASE_URL}/tv_flights_ordered?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}&ref_time_str=${encodeURIComponent(refTimeStr)}`
      : `${API_BASE_URL}/tv_flights?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}`;
    
    const response = await fetch(endpoint, {
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
    console.error('Error fetching flight identifiers data:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch flight identifiers data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}