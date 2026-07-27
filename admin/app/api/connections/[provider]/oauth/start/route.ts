import { NextResponse } from 'next/server';
import { apiGet } from '../../../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../../../lib/session';

// Real 302 to the provider's own authorize page — this route (not the
// backend) is what the browser hits, since it needs the admin's real
// session cookie to build a bearer-authenticated backend call first.
// URLs are built with redirectUrl() (Host/X-Forwarded-Proto), NOT req.url —
// req.url is the internal dev-server bind (localhost:3100), and a provider
// redirect_uri built from it would bypass the nginx front door entirely
// (audit finding #13).
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await params;
  const tab = new URL(req.url).searchParams.get('tab') ?? '';
  const redirectUri = redirectUrl(req, `${BASE_PATH}/api/connections/${provider}/oauth/callback`).toString();
  try {
    const { url } = await apiGet<{ url: string }>(`/api/connections/${provider}/oauth/start-url?redirectUri=${encodeURIComponent(redirectUri)}`);
    const res = NextResponse.redirect(url);
    // Remember which category tab the admin was on — the provider round-trip
    // is a fresh document load, so client state won't survive it.
    if (tab) res.cookies.set('nexus-return-tab', tab, { maxAge: 600, path: `${BASE_PATH}/api/connections`, httpOnly: true, sameSite: 'lax' });
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not start OAuth.';
    return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/settings/connections?oauthError=${encodeURIComponent(message)}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`));
  }
}
