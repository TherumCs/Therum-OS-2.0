import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BASE_PATH, COOKIE_NAME, redirectUrl } from '../../../lib/session';

const API = process.env.API_URL ?? 'http://localhost:4100';

// A raw fetch here, not apiSend() — same reason as login/setup's Route
// Handlers: apiSend()'s generic error message is a whole raw response body
// dumped into one string, not something fit to put in a redirect query
// param; this parses the backend's actual {error:{message}} shape instead.
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  const res = await fetch(`${API}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      currentPassword: String(form.get('currentPassword') ?? ''),
      newPassword: String(form.get('newPassword') ?? ''),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    const msg = body?.error?.message;
    return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/account?passwordError=${encodeURIComponent(typeof msg === 'string' && msg ? msg : 'Could not change password.')}`));
  }
  return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/account?passwordChanged=1`));
}
