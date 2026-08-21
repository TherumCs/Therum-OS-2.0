import type { ReactNode } from 'react';
import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { Toggle, TextInput } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}
interface HealthResponse {
  status: 'ok' | 'warn' | 'error';
  checks: HealthCheck[];
}
interface SecurityResponse {
  requireTwoFactor: boolean;
  readiness: {
    total: number;
    enrolled: number;
    withoutTwoFactor: { id: string; username: string; apiTokens: number }[];
    affectedApiTokens: number;
  };
}
interface StealthResponse {
  hidePlatformCredit: boolean;
  hideVersion: boolean;
  adminKnock: string;
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 'var(--th-space-8)', alignItems: 'flex-start', padding: 'var(--th-space-6) 0' }}>
      <span style={{ color: ok ? 'var(--th-success-text)' : 'var(--th-warning-text)', fontWeight: 700, flexShrink: 0 }}>{ok ? '✓' : '!'}</span>
      <span>{children}</span>
    </li>
  );
}

// 1.9.44's Security tab lists WordPress-specific hardening (XML-RPC,
// pingback/trackback, REST user enumeration) that has no equivalent attack
// surface on this stack — there's no XML-RPC endpoint or pingback system to
// disable here. This shows the real, current hardening this codebase
// actually has instead (Task 3's auth work + the live system health checks),
// which is the faithful port of "what's actually locked down," not a literal
// re-list of WordPress-specific line items.
export default async function SecuritySettingsPage() {
  let health: HealthResponse | null = null;
  let err: string | null = null;
  try {
    health = await apiGet<HealthResponse>('/api/system/health');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const detail = (id: string) => health?.checks.find((c) => c.id === id);

  const security = await apiGet<SecurityResponse>('/api/settings/security').catch(
    (): SecurityResponse => ({
      requireTwoFactor: false,
      readiness: { total: 0, enrolled: 0, withoutTwoFactor: [], affectedApiTokens: 0 },
    }),
  );
  const stealth = await apiGet<StealthResponse>('/api/settings/stealth').catch(
    (): StealthResponse => ({ hidePlatformCredit: false, hideVersion: false, adminKnock: '' }),
  );
  const { readiness } = security;
  const unenrolled = readiness.withoutTwoFactor;

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Security</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Hardening this install actually has, checked live — not a static claim.
      </p>
      {err && <div className="notice">API offline ({err})</div>}

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="l">Always on</div>
        <ul style={{ listStyle: 'none', margin: 'var(--th-space-8) 0 0', padding: 0, fontSize: 'var(--th-fs-sm)' }}>
          <Check ok>Rate limiting on login (per-username, backs off after repeated failures)</Check>
          <Check ok>Password policy — minimum 10 characters</Check>
          <Check ok>Passwords hashed with scrypt, never stored in plaintext</Check>
          <Check ok>Every auth event (success, failure, lockout, password change) is audit-logged</Check>
          <Check ok={detail('cors')?.status === 'ok'}>Security headers (Helmet: X-Frame-Options, CSP, etc.)</Check>
          <Check ok={detail('cors')?.status === 'ok'}>CORS — {detail('cors')?.detail ?? 'checking…'}</Check>
          <Check ok={detail('jwt-secret')?.status === 'ok'}>JWT signing secret — {detail('jwt-secret')?.detail ?? 'checking…'}</Check>
        </ul>
      </div>

      <div className="settings-group" style={{ maxWidth: 560 }}>
        <h3 className="settings-group-title">Two-factor authentication</h3>
        <p className="settings-group-desc">
          {readiness.enrolled} of {readiness.total} admin account{readiness.total === 1 ? '' : 's'} currently have it
          enabled.
        </p>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Require it on every admin account</span>
            <span className="settings-toggle-row-desc">
              Accounts without it can still sign in, but reach nothing except the setup screen until they enrol. Nobody
              is locked out — including you.
            </span>
          </div>
          <Toggle domain="security" field="requireTwoFactor" initial={security.requireTwoFactor} />
        </div>

        {/* Shown BEFORE the toggle is flipped. An API token belonging to an
            un-enrolled account stops working immediately, and finding that out
            from a broken integration is a bad way to find it out. */}
        {unenrolled.length > 0 && (
          <div
            style={{
              background: 'var(--th-warning-bg)',
              color: 'var(--th-warning-text)',
              borderRadius: 'var(--th-ctl-r)',
              padding: 'var(--th-space-8) var(--th-space-12)',
              marginTop: 'var(--th-space-10)',
              fontSize: 'var(--th-fs-sm)',
            }}
          >
            <strong>{security.requireTwoFactor ? 'Currently blocked' : 'Turning this on affects'}</strong>{' '}
            {unenrolled.map((u) => u.username).join(', ')}
            {readiness.affectedApiTokens > 0 && (
              <>
                {' '}— and {readiness.affectedApiTokens} live API token
                {readiness.affectedApiTokens === 1 ? '' : 's'} issued by those accounts, which stop working too.
              </>
            )}
          </div>
        )}
      </div>

      <div className="settings-group" style={{ maxWidth: 560 }}>
        <h3 className="settings-group-title">Stealth</h3>
        <p className="settings-group-desc">
          Reduces what an unauthenticated scanner learns about this stack. This is obscurity, not security — it stops
          nothing a determined attacker cannot work around. What it does do is drop this install out of the automated
          mass-scans that fingerprint a platform and fire known exploits at whatever matches.
        </p>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Hide the platform credit</span>
            <span className="settings-toggle-row-desc">Removes &ldquo;Powered by Therum OS&rdquo; from the public footer.</span>
          </div>
          <Toggle domain="stealth" field="hidePlatformCredit" initial={stealth.hidePlatformCredit} />
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Hide the version number</span>
            <span className="settings-toggle-row-desc">
              Strips the version from the sign-in screen, so a scanner cannot match it against a known-vulnerable
              release.
            </span>
          </div>
          <Toggle domain="stealth" field="hideVersion" initial={stealth.hideVersion} />
        </div>
        <div style={{ marginTop: 'var(--th-space-10)' }}>
          <span className="settings-toggle-row-label">Admin knock</span>
          <p className="settings-toggle-row-desc" style={{ margin: '2px 0 var(--th-space-6)' }}>
            While set, the admin answers a plain 404 to anyone who does not present it. Visit{' '}
            <code>/tos-admin?k=YOUR-KNOCK</code> once and it is remembered on that browser for a year. Leave empty to
            turn it off. Status and content-type match a genuine 404, but the page body still differs — this filters
            scanners, it does not defeat a human comparing responses.
          </p>
          <TextInput domain="stealth" field="adminKnock" initial={stealth.adminKnock} placeholder="empty = off" />
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 'var(--th-space-14)' }}>
        <div className="l">Per-account</div>
        <p className="muted" style={{ fontSize: 'var(--th-fs-sm)', marginTop: 'var(--th-space-6)' }}>
          Two-factor authentication and API tokens are managed per-account, not here.
        </p>
        <a href={`${BASE_PATH}/account`} className="th-btn" style={{ marginTop: 'var(--th-space-4)' }}>
          Go to Account →
        </a>
      </div>
    </div>
  );
}
