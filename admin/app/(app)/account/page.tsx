import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { TwoFactorPanel } from './TwoFactorPanel';
import { ApiTokensPanel } from './ApiTokensPanel';

export const dynamic = 'force-dynamic';

interface TwoFactorStatus {
  enabled: boolean;
  unusedBackupCodes: number;
}
interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ passwordChanged?: string; passwordError?: string }> }) {
  const [params, twoFactor, tokens] = await Promise.all([
    searchParams,
    apiGet<TwoFactorStatus>('/api/auth/2fa').catch((): TwoFactorStatus => ({ enabled: false, unusedBackupCodes: 0 })),
    apiGet<ApiToken[]>('/api/auth/tokens').catch((): ApiToken[] => []),
  ]);

  return (
    <section>
      <h1>Account</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-16)' }}>
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="l">Change password</div>
          {params.passwordChanged && <div className="notice" style={{ background: 'var(--th-success-bg)', color: 'var(--th-success-text)' }}>Password updated.</div>}
          {params.passwordError && <div className="notice">{params.passwordError}</div>}
          <form action={`${BASE_PATH}/api/change-password`} method="post" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-10)', marginTop: 'var(--th-space-10)' }}>
            <div>
              <div className="field-label">Current password</div>
              <input type="password" name="currentPassword" required style={{ width: '100%', padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-sm)' }} />
            </div>
            <div>
              <div className="field-label">New password</div>
              <input type="password" name="newPassword" required minLength={10} style={{ width: '100%', padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-sm)' }} />
              <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)', marginTop: 'var(--th-space-4)' }}>
                At least 10 characters.
              </div>
            </div>
            <button type="submit" style={{ alignSelf: 'flex-start' }}>
              Update password
            </button>
          </form>
        </div>

        <TwoFactorPanel initialStatus={twoFactor} />
        <ApiTokensPanel initialTokens={tokens} />
      </div>
    </section>
  );
}
