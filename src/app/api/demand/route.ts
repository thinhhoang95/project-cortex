import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    // Forward all search params
    const queryString = searchParams.toString();

    try {
        const response = await fetch(
            `${API_BASE_URL}/demand?${queryString}`,
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
        console.error('Error fetching demand data:', error);

        return NextResponse.json(
            {
                error: 'Failed to fetch demand data',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
