'use client';
import { useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';
import type { LoginBranding } from '../../lib/loginBranding';

// Everything a successful login is allowed to land on. `from` arrives via a
// query param that this app doesn't control the origin of — Local by
// Flywheel's own stale "WP Admin" launcher, a browser bookmark from the old
// WordPress install, or anything else pointed at a path this app never
// registered. Trusting it past "starts with /" was the actual bug: it let a
// dead path like /wp-admin round-trip straight through a successful login
// into this app's own 404, right when the user should be landing on real
// data. Only ever redirect somewhere this app actually serves.
const KNOWN_ROUTES = ['/', '/products', '/orders', '/content', '/media', '/studio', '/extensions', '/import'];
function safeRedirectTarget(from: string): string {
  return KNOWN_ROUTES.includes(from) ? from : '/';
}

function ThIcon(): ReactNode {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <rect x="1" y="1" width="54" height="54" rx="14" fill="var(--th-accent)" />
      <text x="14" y="39" fontSize="30" fontWeight="700" fill="#fff" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        T
      </text>
      <text x="34" y="37" fontSize="17" fontWeight="600" fill="#fff" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        h
      </text>
    </svg>
  );
}

function Field({ label, name, type = 'text', hint, autoFocus }: { label: string; name: string; type?: string; hint?: string; autoFocus?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-4)', marginBottom: 'var(--th-space-12)', fontSize: 12, textAlign: 'left' }}>
      <span style={{ fontWeight: 600, color: 'var(--th-ink-2)' }}>{label}</span>
      <input
        type={type}
        name={name}
        autoFocus={autoFocus}
        required
        minLength={type === 'password' ? 8 : undefined}
        style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 13 }}
      />
      {hint && (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

// Defense-in-depth: whatever the response actually contains, this can never
// hand a non-string to React's child renderer (the concrete crash this fixes:
// "Objects are not valid as a React child (found: object with keys {code, message})").
function asErrorString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice" style={{ padding: 'var(--th-space-8) var(--th-space-10)', fontSize: 12, marginBottom: 'var(--th-space-12)', textAlign: 'left' }}>
      {message}
    </div>
  );
}

// 'theme' (the default — matches the pre-existing var(--th-bg) look exactly,
// so an install that's never touched Settings > Login renders identically to
// before this was wired up) needs no extra layer at all; solid/image/video
// are the genuinely new, settings-driven looks.
function backgroundStyle(branding: LoginBranding): CSSProperties {
  if (branding.bgType === 'solid') return { background: branding.bgColor };
  if (branding.bgType === 'image' && branding.bgImage) {
    return { backgroundImage: `url(${branding.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: 'var(--th-bg)' };
}

// Plain fetch() to Route Handlers (app/api/auth/*), not Server Actions — a
// Server Action's ID is a content hash baked into the loaded page's bundle,
// so it goes stale across a dev-server restart ("Invalid Server Actions
// request"). A Route Handler is an ordinary HTTP endpoint; no such coupling.
export function LoginScreen({
  needsSetup,
  from,
  colorMode,
  branding,
}: {
  needsSetup: boolean;
  from: string;
  colorMode: 'light' | 'dark' | 'system';
  branding: LoginBranding;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the password step succeeds on a 2FA-enabled account — the
  // challengeToken proves "password was correct" without granting a real
  // session (see auth.service.ts's signChallenge). Non-null switches the
  // form to the code-entry step below.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  function cancelTwoFactor(): void {
    setChallengeToken(null);
    setError(null);
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; needsTwoFactor?: boolean; challengeToken?: string } | null;
      if (!body?.ok) {
        setError(asErrorString(body?.error, 'Incorrect username or password.'));
        return;
      }
      if (body.needsTwoFactor && body.challengeToken) {
        setChallengeToken(body.challengeToken);
        return;
      }
      router.push(safeRedirectTarget(from));
    } catch {
      setError('Could not reach the server. Check that the API is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeToken, code: fd.get('code') }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!body?.ok) {
        setError(asErrorString(body?.error, 'Incorrect code.'));
        return;
      }
      router.push(safeRedirectTarget(from));
    } catch {
      setError('Could not reach the server. Check that the API is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetup(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), confirmPassword: fd.get('confirmPassword') }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      if (!body?.ok) {
        setError(asErrorString(body?.error, 'Could not create the account.'));
        return;
      }
      // Straight into the post-setup wizard, not the dashboard — see
      // admin/app/(app)/onboarding/page.tsx. Ignores `from`/safeRedirectTarget
      // deliberately: those exist to send an already-existing session back
      // to whatever page it was on, which doesn't apply to a brand-new account.
      router.push('/onboarding');
    } catch {
      setError('Could not reach the server. Check that the API is running and try again.');
    } finally {
      setBusy(false);
    }
  }

  const showOverlay = branding.bgOverlay && (branding.bgType === 'image' || (branding.bgType === 'video' && branding.bgVideo));

  return (
    <div
      data-color-mode={colorMode === 'light' ? undefined : colorMode}
      style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...backgroundStyle(branding) }}
    >
      {branding.bgType === 'video' && branding.bgVideo && (
        <video
          src={branding.bgVideo}
          autoPlay
          muted
          loop
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {showOverlay && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.4)' }} />}

      <div className="card" style={{ position: 'relative', width: 360, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 'var(--th-space-16)' }}>
          <ThIcon />
          <div className="brand" style={{ color: 'var(--th-ink)', marginTop: 'var(--th-space-10)', marginBottom: 'var(--th-space-2)' }}>
            Therum<span>OS</span>
          </div>
          {challengeToken ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Enter the 6-digit code from your authenticator app.
            </p>
          ) : needsSetup ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Create an account to finish setup.
            </p>
          ) : (
            <>
              {branding.heading && (
                <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--th-ink)' }}>{branding.heading}</p>
              )}
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                {branding.subhead || 'Sign in to continue.'}
              </p>
            </>
          )}
        </div>

        {challengeToken ? (
          <form onSubmit={(e) => void handleVerifyCode(e)}>
            <Field label="Authentication code" name="code" type="text" autoFocus hint="Or one of your 8 backup codes." />
            {error && <ErrorNotice message={error} />}
            <button type="submit" disabled={busy} style={{ width: '100%', marginBottom: 'var(--th-space-8)' }}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button type="button" className="ghost" onClick={cancelTwoFactor} style={{ width: '100%' }}>
              Use a different account
            </button>
          </form>
        ) : needsSetup ? (
          <form onSubmit={(e) => void handleSetup(e)}>
            <Field label="Username" name="username" autoFocus />
            <Field label="Password" name="password" type="password" hint="At least 8 characters." />
            <Field label="Confirm password" name="confirmPassword" type="password" />
            {error && <ErrorNotice message={error} />}
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Creating account…' : 'Create account & sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleLogin(e)}>
            <Field label="Username" name="username" autoFocus />
            <Field label="Password" name="password" type="password" />
            {error && <ErrorNotice message={error} />}
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>

      {branding.showVersion && (
        <p
          className="muted"
          style={{ position: 'absolute', bottom: 'var(--th-space-20)', left: 0, right: 0, textAlign: 'center', margin: 0, fontSize: 11 }}
        >
          Therum CMS · v2.0.0
        </p>
      )}
    </div>
  );
}
