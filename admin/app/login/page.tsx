import { LoginScreen } from './LoginScreen';
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
  const [setupNeeded, mode, branding] = await Promise.all([needsSetup(), colorMode(), loginBranding()]);

  // BOTH names. The partner-approval redirect sends `next`; older links send
  // `from`. Reading only one meant a partner connection that required signing
  // in landed on the dashboard with the approval silently discarded.
  return <LoginScreen needsSetup={setupNeeded} from={params.next ?? params.from ?? '/'} colorMode={mode} branding={branding} />;
}
