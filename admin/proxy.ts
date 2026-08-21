import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, SESSION_TTL_SECONDS, inspectSession, sessionCookieDomain, shouldRenew, signSession } from './lib/session';

// Gates the whole admin app behind a real login (username+password against a
// real AdminUser, backend-verified — see lib/session.ts). /api/auth/* must
// stay reachable without a session — that's how a session gets created.
const PUBLIC_PATHS = ['/login', '/api/auth'];

// Desktop Mode opens existing pages inside draggable windows via an iframe
// (see (app)/DesktopShell.tsx) — `?embed=1` on that iframe's src is how the
// page tells AppLayout (a shared layout.tsx, which can't read searchParams
// directly — only page.tsx can) to skip the sidebar/topbar chrome and render
// bare content, so the window itself is the only frame, not a frame nested
// inside another full shell. Forwarded as a REQUEST header (via
// NextResponse.next({ request })), the documented way to pass a value
// forward to a Server Component's next/headers() read — setting it on the
// response instead would only reach the browser, not the render pipeline.
function passThroughWithEmbedHeader(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  if (req.nextUrl.searchParams.get('embed') === '1') {
    headers.set('x-th-embed', '1');
  }
  return NextResponse.next({ request: { headers } });
}

// Next 16 renamed the middleware.ts file convention to proxy.ts (same
// mechanism, same matcher/config shape — "middleware" was overloaded/
// confusable with Express middleware). Function renamed to match.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return passThroughWithEmbedHeader(req);
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await inspectSession(token);
  if (session.user) {
    const res = passThroughWithEmbedHeader(req);
    // RENEW an active session. Without this the token simply ran out mid-use
    // and the next click was the login screen.
    if (token && shouldRenew(token)) {
      res.cookies.set(COOKIE_NAME, await signSession(session.user.sub, session.user.role), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        // Same domain login/setup/verify-2fa/logout write. Without it renewal
        // minted a HOST-ONLY th_session next to the Domain=apex one login set:
        // two cookies, same name, and the reader picks whichever comes first —
        // often the stale one, which reads as "logged out despite a valid
        // session" and survives logout (logout only deletes the Domain one).
        domain: sessionCookieDomain(req.headers.get('host')),
        maxAge: SESSION_TTL_SECONDS,
      });
    }
    return res;
  }
  // Says WHY, on the one line that matters. "Logged out again" has several
  // different causes that all look identical from the browser.
  // eslint-disable-next-line no-console
  console.warn(
    `[admin auth] redirecting ${pathname} to /login — ${session.verdict}` +
      (session.detail ? ` (${session.detail})` : '') +
      ` | cookies seen: ${req.cookies.getAll().map((c) => c.name).join(',') || 'none'}`,
  );
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('from', pathname);
  // Carried in the URL because this server's stdout is not attached to any
  // terminal — a console line would go nowhere anyone can read. It names the
  // cause ("expired", "no-cookie", "bad-signature") so "it logged me out
  // again" can be diagnosed from the address bar instead of guessed at.
  url.searchParams.set('why', session.verdict);
  return NextResponse.redirect(url);
}

export const config = {
  // Next.js prepends basePath to matcher patterns before testing them. The
  // negative-lookahead pattern below requires a "/" right after the basePath
  // ("/tos-admin/...") to match at all — the bare basePath root
  // ("/tos-admin", nothing after it — i.e. the dashboard itself) satisfies
  // neither the exclusion nor the capture group, so it silently never ran
  // this check at all and the whole dashboard was unauthenticated.
  // Confirmed live: bare /tos-admin returned 200 with zero cookies sent,
  // while /tos-admin/products correctly redirected to login. The explicit
  // '/' entry below is what actually covers that exact root case.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
