import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/app/api/_utils';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const body = await request.json().catch(() => ({}));

    const resp = await fetch(`${backendUrl}/autorate_occupancy`, {
      method: 'POST',
      headers: withAuth(request, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `Backend error: ${resp.status}`, details: text },
        { status: 502 }
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('autorate_occupancy proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy autorate_occupancy', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
