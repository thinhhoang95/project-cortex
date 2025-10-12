import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const topKParam = requestUrl.searchParams.get('top_k');

  const upstreamUrl = new URL(`${API_BASE_URL}/agent_sol_summary`);
  if (topKParam !== null) {
    const parsed = Number.parseInt(topKParam, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: 'top_k must be an integer greater than or equal to 1' },
        { status: 400 }
      );
    }
    upstreamUrl.searchParams.set('top_k', String(parsed));
  }

  try {
    const response = await fetch(upstreamUrl.toString(), {
      headers: withAuth(request),
    });

    const unauthorized = await maybeHandleUnauthorized(response);
    if (unauthorized) return unauthorized;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return NextResponse.json(
        {
          error: 'Failed to fetch agent solution summary',
          details: body || `Upstream responded with status ${response.status}`,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching agent solution summary:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch agent solution summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

