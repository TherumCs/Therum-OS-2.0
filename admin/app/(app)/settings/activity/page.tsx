import Link from 'next/link';
import { apiGet } from '../../../../lib/api';
import { timeAgo } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

interface AuthEvent {
  id: string;
  type: string;
  username: string;
  scope: string;
  ip: string | null;
  detail: string | null;
  createdAt: string;
}
interface ActivityResponse {
  events: AuthEvent[];
  total: number;
  counts: { admin: number; customer: number };
  failures: { admin: number; customer: number; distinctCustomerSubjects: number };
}

const TYPE_LABEL: Record<string, string> = {
  login_success: 'Login',
  login_failure: 'Failed login',
  login_locked: 'Login locked out',
  setup: 'Account created',
  logout: 'Logout',
  '2fa_enabled': '2FA enabled',
  '2fa_disabled': '2FA disabled',
  '2fa_challenge_failed': '2FA challenge failed',
  password_changed: 'Password changed',
  customer_registered: 'Account created',
  customer_login_success: 'Login',
  customer_login_failure: 'Failed login',
  customer_login_throttled: 'Rate limited',
  customer_code_requested: 'Code sent',
  customer_code_failure: 'Failed code',
  customer_oauth_login: 'Social login',
  customer_oauth_registered: 'Social account created',
  customer_logout: 'Logout',
  customer_identity_unlinked: 'Sign-in method removed',
};

// Types that mean "someone tried and did not get in". Highlighted because a
// run of them is the only thing on this page that ever needs acting on.
const FAILURE_TYPES = new Set([
  'login_failure',
  'login_locked',
  '2fa_challenge_failed',
  'customer_login_failure',
  'customer_login_throttled',
  'customer_code_failure',
]);

const TABS = [
  { key: '', label: 'All' },
  { key: 'admin', label: 'Admin' },
  { key: 'customer', label: 'Customers' },
] as const;

const cell = { padding: 'var(--th-space-8) var(--th-space-6)' } as const;
const th = { ...cell, color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' } as const;

// 1.9.44's Activity section is a general content-change audit trail; this
// stack's real equivalent so far is the auth event log — now covering BOTH
// login surfaces. Storefront accounts were previously unaudited entirely,
// which meant a slow credential-stuffing run against customers left no trace.
// Scoped honestly to what's actually tracked, not a broader "who edited what"
// history that doesn't exist yet.
export default async function ActivitySettingsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const raw = (await searchParams).scope;
  const scope = raw === 'admin' || raw === 'customer' ? raw : '';
  const empty: ActivityResponse = {
    events: [],
    total: 0,
    counts: { admin: 0, customer: 0 },
    failures: { admin: 0, customer: 0, distinctCustomerSubjects: 0 },
  };
  const data = await apiGet<ActivityResponse>(
    `/api/settings/activity${scope ? `?scope=${scope}` : ''}`,
  ).catch((): ActivityResponse => empty);

  const failing = data.failures.admin + data.failures.customer;
  // Failures spread across many accounts is stuffing; concentrated on one is a
  // targeted guess. The wording changes because the response does.
  const spread = data.failures.distinctCustomerSubjects;

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Activity</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Audit trail of sign-in activity, for both the admin and the storefront.
      </p>

      {failing > 0 && (
        <div
          style={{
            background: 'var(--th-warning-bg)',
            color: 'var(--th-warning-text)',
            border: '1px solid var(--th-line)',
            borderRadius: 'var(--th-ctl-r)',
            padding: 'var(--th-space-8) var(--th-space-12)',
            margin: 'var(--th-space-16) 0',
            fontSize: 'var(--th-fs-sm)',
            display: 'flex',
            gap: 'var(--th-space-8)',
            flexWrap: 'wrap',
            alignItems: 'baseline',
          }}
        >
          <strong>Last hour</strong>
          <span>
            {data.failures.admin} failed admin attempt{data.failures.admin === 1 ? '' : 's'} ·{' '}
            {data.failures.customer} failed customer attempt{data.failures.customer === 1 ? '' : 's'}
            {spread > 1 && ` across ${spread} different accounts`}
            {spread > 1 ? ' — spread like this usually means credential stuffing, not a forgotten password.' : '.'}
          </span>
        </div>
      )}

      {/* Same segmented control as Appearance, so this reads as one system.
          Links rather than buttons because the scope is in the URL and should
          survive a refresh or a bookmark. */}
      <div className="th-seg" role="group" aria-label="Activity scope" style={{ margin: 'var(--th-space-16) 0' }}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/settings/activity?scope=${t.key}` : '/settings/activity'}
            className={'th-seg-btn' + (scope === t.key ? ' active' : '')}
            style={{ textDecoration: 'none', display: 'inline-block' }}
          >
            {t.label}
            {t.key === 'admin' && ` (${data.counts.admin})`}
            {t.key === 'customer' && ` (${data.counts.customer})`}
          </Link>
        ))}
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Recent activity</h3>
        <p className="settings-group-desc">
          {data.total} event{data.total === 1 ? '' : 's'}
          {scope === 'admin' && ' on the admin'}
          {scope === 'customer' && ' on storefront accounts'}
          {/* Explicit, because JSX drops the whitespace around a `false` branch
              and the dash ends up glued to the word before it. */}
          {' — '}
          logins, failures, lockouts, 2FA, password changes, and sign-in methods added or removed. Content-edit history
          isn&apos;t tracked yet.
        </p>
        {data.events.length === 0 ? (
          <div className="settings-empty-state">No activity recorded yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                <th style={th}>When</th>
                {!scope && <th style={th}>Where</th>}
                <th style={th}>Account</th>
                <th style={th}>Action</th>
                <th style={th}>IP</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
                  <td style={{ ...cell, color: 'var(--th-muted)', whiteSpace: 'nowrap' }}>{timeAgo(e.createdAt)}</td>
                  {!scope && (
                    <td style={{ ...cell, color: 'var(--th-muted)' }}>{e.scope === 'customer' ? 'Storefront' : 'Admin'}</td>
                  )}
                  <td style={{ ...cell, wordBreak: 'break-all' }}>{e.username}</td>
                  <td style={{ ...cell, ...(FAILURE_TYPES.has(e.type) ? { color: 'var(--th-danger-text)' } : {}) }}>
                    {TYPE_LABEL[e.type] ?? e.type}
                  </td>
                  <td style={{ ...cell, color: 'var(--th-muted)', whiteSpace: 'nowrap' }}>{e.ip ?? '—'}</td>
                  <td style={{ ...cell, color: 'var(--th-muted)' }}>{e.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
