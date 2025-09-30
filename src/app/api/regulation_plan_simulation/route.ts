import { NextRequest, NextResponse } from 'next/server';
import { withAuth, maybeHandleUnauthorized } from '@/app/api/_utils';

// Proxies simulation requests to the backend API `/regulation_plan_simulation`
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || !Array.isArray(body.regulations)) {
      return NextResponse.json(
        {
          error: 'Invalid payload: expected { regulations: [...] }',
          hint: 'Provide a list of regulation strings or objects per the Regulation DSL.',
        },
        { status: 400 }
      );
    }

    const hasInvalidRegulation = body.regulations.some(
      (entry: unknown) => typeof entry !== 'string' && (typeof entry !== 'object' || entry === null)
    );

    if (hasInvalidRegulation) {
      return NextResponse.json(
        {
          error: 'Invalid regulation entry',
          hint: 'Each regulation must be a string (Regulation DSL) or an object with location/rate/time_windows.',
        },
        { status: 400 }
      );
    }

    if (body.regulations.length === 0) {
      return NextResponse.json(
        { error: 'No regulations provided' },
        { status: 400 }
      );
    }

    const sanitizedBody: Record<string, unknown> = { ...body, regulations: body.regulations };

    if (sanitizedBody.include_excess_vector !== undefined) {
      sanitizedBody.include_excess_vector = Boolean(sanitizedBody.include_excess_vector);
    }

    if (sanitizedBody.weights !== undefined && typeof sanitizedBody.weights !== 'object') {
      return NextResponse.json(
        {
          error: 'Invalid weights override',
          hint: 'weights must be an object of numeric overrides for the objective weights.',
        },
        { status: 400 }
      );
    }

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const url = `${backendUrl}/regulation_plan_simulation`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: withAuth(request, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(sanitizedBody),
    });

    const unauthorized = await maybeHandleUnauthorized(resp);
    if (unauthorized) return unauthorized;

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
