import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifyJwt } from './lib/session';

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
  if (await verifyJwt(token)) {
    return passThroughWithEmbedHeader(req);
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('from', pathname);
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
