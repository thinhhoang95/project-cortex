import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    let username = '';
    let password = '';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      username = String(body?.username || body?.email || '');
      password = String(body?.password || '');
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const form = await request.formData().catch(() => null);
      if (form) {
        username = String(form.get('username') || form.get('email') || '');
        password = String(form.get('password') || '');
      }
    } else {
      // Try best-effort formData parse for unknown content types
      const form = await request.formData().catch(() => null);
      if (form) {
        username = String(form.get('username') || form.get('email') || '');
        password = String(form.get('password') || '');
      }
    }

    if (!username || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const url = `${backendUrl.replace(/\/$/, '')}/token`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ username, password }).toString(),
    });

    const raw = await upstream.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore JSON parse errors */ }

    if (!upstream.ok) {
      const message = data?.detail || data?.error || `Login failed (${upstream.status})`;
      return NextResponse.json({ error: message }, { status: upstream.status });
    }

    // Expected shape: { access_token, token_type }
    return NextResponse.json(data);
  } catch (err) {
    console.error('Error in /api/token:', err);
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
  }
}

