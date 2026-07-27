import { NextResponse } from 'next/server';
import { apiSend } from '../../../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../../../lib/session';

// The OAuth provider redirects the browser here with ?code&state — this
// route has the admin's real session cookie (same origin), so it's the
// only place that can bridge cookie-auth to a bearer-authenticated backend
// call. redirectUri must be byte-identical to what /oauth/start sent (both
// now built via redirectUrl(), not req.url — audit finding #13).
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const redirectUri = redirectUrl(req, `${BASE_PATH}/api/connections/${provider}/oauth/callback`).toString();

  // Restore the category tab the admin started from (set by /oauth/start).
  const cookieTab = req.headers.get('cookie')?.match(/(?:^|;\s*)nexus-return-tab=([a-z]+)/)?.[1] ?? '';
  const tabSuffix = cookieTab ? `&tab=${encodeURIComponent(cookieTab)}` : '';
  const done = (query: string) => {
    const res = NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/settings/connections?${query}${tabSuffix}`));
    if (cookieTab) res.cookies.set('nexus-return-tab', '', { maxAge: 0, path: `${BASE_PATH}/api/connections` });
    return res;
  };

  if (!code || !state) {
    return done('oauthError=Missing+code+or+state');
  }

  try {
    await apiSend('POST', `/api/connections/${provider}/oauth/callback`, { code, state, redirectUri });
    return done(`oauthConnected=${encodeURIComponent(provider)}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'OAuth exchange failed.';
    return done(`oauthError=${encodeURIComponent(message)}`);
  }
}
