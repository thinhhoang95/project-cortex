import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trafficVolumeId = searchParams.get('traffic_volume_id');
  const refTimeStr = searchParams.get('ref_time_str');
  const signParam = (searchParams.get('sign') || 'minus').toLowerCase();
  const deltaMinParam = searchParams.get('delta_min');

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

  const sign = signParam === 'plus' ? 'plus' : 'minus';
  const deltaMin = deltaMinParam !== null ? Number(deltaMinParam) : undefined;

  try {
    const url = new URL(`${API_BASE_URL}/slack_distribution`);
    url.searchParams.set('traffic_volume_id', trafficVolumeId);
    url.searchParams.set('ref_time_str', refTimeStr);
    url.searchParams.set('sign', sign);
    if (typeof deltaMin === 'number' && !Number.isNaN(deltaMin)) {
      url.searchParams.set('delta_min', String(deltaMin));
    }

    const response = await fetch(url.toString(), {
      headers: withAuth(request, { 'Content-Type': 'application/json' }),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching slack distribution:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch slack distribution',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


