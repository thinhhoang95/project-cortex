import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');

  if (!trafficVolumeId) {
    return NextResponse.json(
      { error: 'traffic_volume_id parameter is required' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/tv_flights?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

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