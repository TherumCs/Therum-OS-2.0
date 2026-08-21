import { TwoFactorPanel } from './account/TwoFactorPanel';
import { appearanceDataAttrs, appearanceInlineVars, type Appearance } from '../../lib/appearance';

// Shown in place of the entire admin when this site requires two-factor
// authentication and this account has not enrolled.
//
// Deliberately has NO sidebar and no navigation. Anything it linked to would
// 403 — the API enforces the same rule (see middleware/auth.ts) — and a nav
// full of dead links reads as a broken app rather than as one thing left to
// do. The only ways out are: enrol, or sign out.
export function TwoFactorGate({
  username,
  status,
  appearance,
}: {
  username: string;
  status: { enabled: boolean; unusedBackupCodes: number };
  appearance: Appearance;
}) {
  return (
    <div
      {...appearanceDataAttrs(appearance)}
      style={{
        ...appearanceInlineVars(appearance),
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--th-space-16)',
        background: 'var(--th-bg)',
        color: 'var(--th-ink)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ fontSize: 'var(--th-fs-lg)', margin: 0 }}>Two-factor authentication required</h1>
        <p className="muted" style={{ marginTop: 'var(--th-space-6)' }}>
          Signed in as <strong>{username}</strong>. This site requires every admin account to hold a second factor, so
          the rest of the admin stays locked until you set one up.
        </p>
        <div className="card" style={{ marginTop: 'var(--th-space-14)' }}>
          <TwoFactorPanel initialStatus={status} reloadWhenDone />
        </div>
        <p className="muted" style={{ fontSize: 'var(--th-fs-sm)', marginTop: 'var(--th-space-12)' }}>
          Save the backup codes you are shown — they are displayed once, and they are the only way back in if you lose
          the authenticator.
        </p>
      </div>
    </div>
  );
}
