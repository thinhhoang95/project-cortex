import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const flightIdentifier = searchParams.get('flight_identifier');

  if (!flightIdentifier || !flightIdentifier.trim()) {
    return NextResponse.json(
      { error: "'flight_identifier' must be a non-empty string" },
      { status: 400 }
    );
  }

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/predict_single_flight?flight_identifier=${encodeURIComponent(flightIdentifier)}`,
      {
        headers: withAuth(request),
        cache: 'no-store',
      }
    );

    const unauthorized = await maybeHandleUnauthorized(upstream);
    if (unauthorized) {
      return unauthorized;
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Upstream error ${upstream.status}`,
          detail: detail || upstream.statusText,
        },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Error fetching alternative routes:', err);
    return NextResponse.json(
      { error: 'Failed to fetch alternative routes' },
      { status: 500 }
    );
  }
}
