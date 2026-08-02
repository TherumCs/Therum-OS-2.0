import { NextResponse } from 'next/server';
import { COOKIE_NAME, sessionCookieDomain } from '../../../../lib/session';

const API = process.env.API_URL ?? 'http://localhost:4100';

// Second step of the 2FA login flow — see login/route.ts's comment on the
// LoginResult union. Unlike the username/password step, these failure modes
// (wrong code vs. expired challenge vs. rate-limited) are all safe and
// meaningful to show as-is: there's no username/password ambiguity to
// protect here, just a code the user just typed.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { challengeToken, code } = (await req.json()) as { challengeToken?: string; code?: string };

    const res = await fetch(`${API}/api/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeToken, code }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return NextResponse.json({ ok: false, error: errBody?.error?.message ?? 'Incorrect code.' }, { status: res.status });
    }
    const { token } = (await res.json()) as { token: string };

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Shared across the apex and www, so a session started on one host is
      // seen by the other — see sessionCookieDomain.
      domain: sessionCookieDomain(req.headers.get('host')),
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach the server. Try again.' }, { status: 502 });
  }
}
