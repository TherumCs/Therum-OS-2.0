import { NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_TTL_SECONDS, sessionCookieDomain } from '../../../../lib/session';

const API = process.env.API_URL ?? 'http://localhost:4100';

// A plain Route Handler, not a Server Action — Server Actions are keyed to a
// content-hashed action ID baked into the client bundle at compile time, so a
// dev-server restart (which this project's had a lot of) invalidates any
// already-loaded page's action references ("Invalid Server Actions request").
// A Route Handler is just an ordinary HTTP endpoint; no such coupling exists.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { username, password } = (await req.json()) as { username?: string; password?: string };

    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'Incorrect username or password.' }, { status: 401 });
    }
    // authService.login()'s real return type is a union — either a full
    // session token, or (2FA-enabled accounts) a short-lived challengeToken
    // with no session token at all. Reading `token` unconditionally here used
    // to set a cookie containing the literal string "undefined" for any 2FA
    // account, while still reporting {ok:true} — login appeared to succeed
    // and silently left the user with a broken session.
    const body = (await res.json()) as { token: string } | { needsTwoFactor: true; challengeToken: string };
    if ('needsTwoFactor' in body) {
      return NextResponse.json({ ok: true, needsTwoFactor: true, challengeToken: body.challengeToken });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, body.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Shared across the apex and www, so a session started on one host is
      // seen by the other — see sessionCookieDomain.
      domain: sessionCookieDomain(req.headers.get('host')),
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    // Backend unreachable, malformed request body, etc. — always a clean,
    // guaranteed-string JSON error, never Next's own generic 500 shape.
    return NextResponse.json({ ok: false, error: 'Could not reach the server. Try again.' }, { status: 502 });
  }
}
