import { NextRequest, NextResponse } from 'next/server';

// Proxies simulation requests to the backend API `/regulation_plan_simulation`
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || !Array.isArray(body.regulations)) {
      return NextResponse.json(
        { error: 'Invalid payload: expected { regulations: [...] }' },
        { status: 400 }
      );
    }

    if (body.regulations.length === 0) {
      return NextResponse.json(
        { error: 'No regulations provided' },
        { status: 400 }
      );
    }

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const url = `${backendUrl}/regulation_plan_simulation`;

    const resp = await fetch(url, {
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
    console.error('regulation_plan_simulation error', err);
    return NextResponse.json(
      { error: 'Failed to process simulation request', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}


