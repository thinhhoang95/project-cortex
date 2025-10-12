import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const upstreamUrl = `${API_BASE_URL}/agent_sol_ls`;

  try {
    const response = await fetch(upstreamUrl, {
      headers: withAuth(request, { 'Content-Type': 'application/json' }),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return NextResponse.json(
        {
          error: 'Failed to fetch agent solution list',
          details: body || `Upstream responded with status ${response.status}`,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching agent solution list:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch agent solution list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
