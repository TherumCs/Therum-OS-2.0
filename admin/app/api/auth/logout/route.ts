import { NextResponse } from 'next/server';
import { COOKIE_NAME, sessionCookieDomain } from '../../../../lib/session';

export async function POST(req: Request): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  // Explicit path: '/' to match login/setup's cookie exactly — kept for
  // clarity, though as of Next 14.2.35 it's not actually load-bearing:
  // ResponseCookies normalizes a missing path to '/' unconditionally
  // (next/dist/compiled/@edge-runtime/cookies's normalizeCookie()), so
  // .delete(COOKIE_NAME) alone would clear the same cookie just as well.
  // The "still logged in after logout" symptom seen live (2026-07-06) was
  // most likely fully explained by middleware.ts's basePath+matcher bug
  // instead — the dashboard root was unauthenticated regardless of cookie
  // state, which looks identical to logout silently no-op'ing. See
  // test/http-auth-e2e.test.mjs for the regression coverage and how this
  // was verified.
  // Deleted with the SAME domain it was written with — a mismatch leaves the
  // shared cookie alive and the merchant still signed in on the other host.
  response.cookies.delete({ name: COOKIE_NAME, path: '/', domain: sessionCookieDomain(req.headers.get('host')) });
  return response;
}
