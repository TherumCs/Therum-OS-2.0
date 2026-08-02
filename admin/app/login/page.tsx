import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginScreen } from './LoginScreen';
import { COOKIE_NAME, verifyJwt } from '../../lib/session';
import { DEFAULT_LOGIN_BRANDING, type LoginBranding } from '../../lib/loginBranding';

const API = process.env.API_URL ?? 'http://localhost:4100';

async function needsSetup(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/api/auth/status`, { cache: 'no-store' });
    if (!res.ok) return false;
    return Boolean((await res.json()).needsSetup);
  } catch {
    return false;
  }
}

async function colorMode(): Promise<'light' | 'dark' | 'system'> {
  try {
    const res = await fetch(`${API}/api/settings/appearance/public`, { cache: 'no-store' });
    if (!res.ok) return 'light';
    const mode = (await res.json())?.colorMode;
    return mode === 'dark' || mode === 'system' ? mode : 'light';
  } catch {
    return 'light';
  }
}

// The .../public variant exists specifically for this — no session exists
// yet on the login screen itself, matching colorMode() above.
async function loginBranding(): Promise<LoginBranding> {
  try {
    const res = await fetch(`${API}/api/settings/login-branding/public`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_LOGIN_BRANDING;
    return (await res.json()) as LoginBranding;
  } catch {
    return DEFAULT_LOGIN_BRANDING;
  }
}

export const dynamic = 'force-dynamic';

// Strict gate, not a default: zero admin accounts → setup form only, no way
// to reach a sign-in form that would just 401. One or more accounts exist →
// sign-in form only, no way to reach setup (the backend refuses it anyway —
// see auth.service.ts's setup() — this just stops the dead end being offered
// in the UI at all).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ from?: string; next?: string }> }) {
  const params = await searchParams;

  /**
   * ALREADY SIGNED IN, and something is waiting for them.
   *
   * A partner sends the merchant to the approval screen; if the cookie is not
   * visible at that moment they are bounced here. Rendering a password form to
   * someone who is already authenticated leaves them staring at a login page
   * with nothing to do and no way to reach the approval — which reads exactly
   * like the connection being broken.
   *
   * Only the approval path is forwarded this way, and only when the session
   * actually verifies. Everything else still gets the form.
   */
  const pending = params.next ?? params.from;
  if (pending && /^\/wc-auth\/v1\/authorize(?:[/?]|$)/.test(pending)) {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (await verifyJwt(token)) {
      // An ABSOLUTE url. Next prefixes a relative redirect with basePath, so
      // redirect('/wc-auth/...') lands on '/tos-admin/wc-auth/...' and 404s —
      // the same trap as the client-side push, on the server side.
      const h = await headers();
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
      const proto = (h.get('x-forwarded-proto') ?? 'https').split(',')[0];
      redirect(host ? `${proto}://${host}${pending}` : pending);
    }
  }

  const [setupNeeded, mode, branding] = await Promise.all([needsSetup(), colorMode(), loginBranding()]);

  // BOTH names. The partner-approval redirect sends `next`; older links send
  // `from`. Reading only one meant a partner connection that required signing
  // in landed on the dashboard with the approval silently discarded.
  return <LoginScreen needsSetup={setupNeeded} from={params.next ?? params.from ?? '/'} colorMode={mode} branding={branding} />;
}
