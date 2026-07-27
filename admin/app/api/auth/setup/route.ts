import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../../lib/session';

const API = process.env.API_URL ?? 'http://localhost:4100';

// One-time — the backend refuses this once any account exists. Plain Route
// Handler, not a Server Action (see login/route.ts for why).
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { username, password, confirmPassword } = (await req.json()) as { username?: string; password?: string; confirmPassword?: string };

    if (password !== confirmPassword) {
      return NextResponse.json({ ok: false, error: 'Passwords do not match.' }, { status: 422 });
    }

    const res = await fetch(`${API}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
      const msg = body?.error?.message;
      return NextResponse.json({ ok: false, error: typeof msg === 'string' && msg ? msg : 'Could not create the account.' }, { status: res.status });
    }
    const { token } = (await res.json()) as { token: string };

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach the server. Try again.' }, { status: 502 });
  }
}
