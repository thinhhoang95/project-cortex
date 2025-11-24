import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const trafficVolumeId = searchParams.get('traffic_volume_id');
    const fromTime = searchParams.get('from_time');
    const toTime = searchParams.get('to_time');

    if (!trafficVolumeId || !fromTime || !toTime) {
        return NextResponse.json(
            { error: 'traffic_volume_id, from_time, and to_time parameters are required' },
            { status: 400 }
        );
    }

    try {
        const endpoint = `${API_BASE_URL}/demand_flight_list?traffic_volume_id=${encodeURIComponent(trafficVolumeId)}&from_time=${encodeURIComponent(fromTime)}&to_time=${encodeURIComponent(toTime)}`;

        const response = await fetch(endpoint, {
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
        console.error('Error fetching demand flight list:', error);

        return NextResponse.json(
            {
                error: 'Failed to fetch demand flight list',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
