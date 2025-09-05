import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const body = await request.json().catch(() => ({}));

    const resp = await fetch(`${backendUrl}/automatic_rate_adjustment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    console.error('automatic_rate_adjustment proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy automatic_rate_adjustment', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

