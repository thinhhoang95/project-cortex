import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

function parsePositiveInteger(
  value: string | null,
  field: string,
): [number | null, NextResponse | null] {
  if (value === null) {
    return [
      null,
      NextResponse.json(
        { error: `${field} query parameter is required` },
        { status: 400 },
      ),
    ];
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return [
      null,
      NextResponse.json(
        { error: `${field} must be an integer greater than or equal to 1` },
        { status: 400 },
      ),
    ];
  }

  return [parsed, null];
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const runId = requestUrl.searchParams.get('run_id');
  const [solutionRank, solutionRankError] = parsePositiveInteger(
    requestUrl.searchParams.get('solution_rank'),
    'solution_rank',
  );
  if (solutionRankError) return solutionRankError;

  if (!runId || !runId.trim()) {
    return NextResponse.json(
      { error: 'run_id query parameter is required' },
      { status: 400 },
    );
  }

  const upstreamUrl = new URL(`${API_BASE_URL}/agent_sol_details_wholeplan`);
  upstreamUrl.searchParams.set('run_id', runId.trim());
  upstreamUrl.searchParams.set('solution_rank', String(solutionRank));

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
          error: 'Failed to fetch whole-plan agent solution details',
          details: body || `Upstream responded with status ${response.status}`,
        },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching whole-plan agent solution details:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch whole-plan agent solution details',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
