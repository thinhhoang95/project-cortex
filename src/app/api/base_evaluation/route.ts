import { NextRequest, NextResponse } from 'next/server';

// Proxy to backend `/base_evaluation` with JSON POST body
export async function POST(request: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const body = await request.json().catch(() => ({}));

    const resp = await fetch(`${backendUrl}/base_evaluation`, {
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
    console.error('base_evaluation proxy error', err);
    return NextResponse.json(
      { error: 'Failed to proxy base_evaluation', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

