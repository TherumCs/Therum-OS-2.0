import { apiGet } from '../../../../lib/api';
import { timeAgo } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

interface AuthEvent {
  id: string;
  type: string;
  username: string;
  ip: string | null;
  detail: string | null;
  createdAt: string;
}
interface ActivityResponse {
  events: AuthEvent[];
  total: number;
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
};

// 1.9.44's Activity section is a general content-change audit trail; this
// stack's real equivalent so far is the auth event log (login/logout/lockout/
// 2FA/password changes) — scoped honestly to what's actually tracked, not a
// broader "who edited what" history that doesn't exist yet.
export default async function ActivitySettingsPage() {
  const data = await apiGet<ActivityResponse>('/api/settings/activity').catch((): ActivityResponse => ({ events: [], total: 0 }));

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Activity</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Audit trail of changes.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Recent activity</h3>
        <p className="settings-group-desc">
          {data.total} event{data.total === 1 ? '' : 's'} recorded — login, logout, lockouts, 2FA, and password changes. Content-edit history isn&apos;t
          tracked yet.
        </p>
        {data.events.length === 0 ? (
          <div className="settings-empty-state">No activity recorded yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>When</th>
                <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>User</th>
                <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Action</th>
                <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
                  <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', whiteSpace: 'nowrap' }}>{timeAgo(e.createdAt)}</td>
                  <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{e.username}</td>
                  <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{TYPE_LABEL[e.type] ?? e.type}</td>
                  <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>{e.detail ?? e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
