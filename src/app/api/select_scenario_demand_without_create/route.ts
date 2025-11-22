import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json(
                { error: 'Missing id parameter' },
                { status: 400 }
            );
        }

        const response = await fetch(
            `${API_BASE_URL}/select_scenario_demand_without_create?id=${id}`,
            {
                method: 'GET',
                headers: withAuth(request),
            }
        );

        const unauthorized = await maybeHandleUnauthorized(response);
        if (unauthorized) return unauthorized;

        if (!response.ok) {
            // Forward the status code from the backend
            return NextResponse.json(
                { error: `API responded with status: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error selecting scenario demand without create:', error);

        return NextResponse.json(
            {
                error: 'Failed to select scenario demand',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
