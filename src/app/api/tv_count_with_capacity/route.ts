import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000'

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
      `${API_BASE_URL}/tv_count_with_capacity?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}`,
      {
        headers: withAuth(request, { 'Content-Type': 'application/json' }),
      }
    );

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching traffic volume data with capacity:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch traffic volume data with capacity',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
