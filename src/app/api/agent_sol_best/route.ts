import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const runId = requestUrl.searchParams.get('run_id');

  if (!runId || !runId.trim()) {
    return NextResponse.json(
      { error: 'run_id query parameter is required' },
      { status: 400 }
    );
  }

  const upstreamUrl = new URL(`${API_BASE_URL}/agent_sol_best`);
  upstreamUrl.searchParams.set('run_id', runId.trim());

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
          error: 'Failed to fetch agent solution best data',
          details: body || `Upstream responded with status ${response.status}`,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching agent solution best data:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch agent solution best data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
