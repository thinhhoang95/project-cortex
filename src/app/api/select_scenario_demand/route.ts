import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const response = await fetch(
            `${API_BASE_URL}/select_scenario_demand`,
            {
                method: 'POST',
                headers: withAuth(request, { 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
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
        console.error('Error selecting scenario demand:', error);

        return NextResponse.json(
            {
                error: 'Failed to select scenario demand',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
