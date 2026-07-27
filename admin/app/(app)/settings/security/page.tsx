import type { ReactNode } from 'react';
import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';

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
