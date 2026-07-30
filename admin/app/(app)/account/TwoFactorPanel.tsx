'use client';
import { useState } from 'react';
import { BASE_PATH } from '../../../lib/session';

interface Status {
  enabled: boolean;
  unusedBackupCodes: number;
}

type Stage = 'idle' | 'enrolling' | 'showing-backup-codes';

async function asJson(res: Response): Promise<{ ok: boolean; body: unknown }> {
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

export function TwoFactorPanel({
  initialStatus,
  // Set by the enforcement gate, which is rendered INSTEAD of the admin and
  // therefore cannot notice that enrolment just succeeded — the decision was
  // made on the server, before this component existed. A reload re-runs it.
  reloadWhenDone = false,
}: {
  initialStatus: Status;
  reloadWhenDone?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [stage, setStage] = useState<Stage>('idle');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startEnroll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/2fa/enroll`, { method: 'POST' });
      const { ok, body } = await asJson(res);
      if (!ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'Could not start enrollment.');
      setSecret((body as { secretFormatted: string }).secretFormatted);
      setStage('enrolling');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/2fa/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const { ok, body } = await asJson(res);
      if (!ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'Incorrect code.');
      setBackupCodes((body as { backupCodes: string[] }).backupCodes);
      setStage('showing-backup-codes');
      setStatus({ enabled: true, unusedBackupCodes: 8 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    if (!confirm('Turn off two-factor authentication?')) return;
    setBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/2fa/disable`, { method: 'POST' });
      setStatus({ enabled: false, unusedBackupCodes: 0 });
      setStage('idle');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'showing-backup-codes') {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="l">Save your backup codes</div>
        <p className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          Each works once, if you lose access to your authenticator. This is the only time they&apos;re shown.
        </p>
        <div className="settings-radio-group" style={{ fontFamily: 'monospace', fontSize: 'var(--th-fs-md)' }}>
          {backupCodes.map((c) => (
            <span key={c} className="chip" style={{ fontSize: 13, padding: 'var(--th-space-6) var(--th-space-10)' }}>
              {c}
            </span>
          ))}
        </div>
        <button
          style={{ marginTop: 'var(--th-space-14)' }}
          onClick={() => (reloadWhenDone ? window.location.reload() : setStage('idle'))}
        >
          {reloadWhenDone ? "Done — I've saved these, continue" : "Done — I've saved these"}
        </button>
      </div>
    );
  }

  if (stage === 'enrolling') {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="l">Enter this secret into your authenticator app</div>
        <div className="chip" style={{ fontFamily: 'monospace', fontSize: 15, padding: 'var(--th-space-10) var(--th-space-14)', margin: 'var(--th-space-10) 0', display: 'inline-block' }}>
          {secret}
        </div>
        <p className="muted" style={{ fontSize: 'var(--th-fs-2xs)', marginTop: -4 }}>
          These codes never contain the digit 0 or 1 — if a character looks like one, it&apos;s the letter O or I.
        </p>
        <p className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>Then enter the 6-digit code it shows to confirm.</p>
        {error && <div className="notice">{error}</div>}
        <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" maxLength={6} style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-sm)', width: 100 }} />
          <button disabled={busy || code.length !== 6} onClick={() => void confirmEnroll()}>
            Confirm
          </button>
          <button className="ghost" onClick={() => setStage('idle')}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="row-between">
        <div>
          <div className="l">Two-factor authentication</div>
          <div className="n" style={{ fontSize: 16 }}>
            {status.enabled ? `Enabled — ${status.unusedBackupCodes} backup codes left` : 'Not enabled'}
          </div>
        </div>
        {status.enabled ? (
          <button className="ghost" disabled={busy} onClick={() => void disable()}>
            Disable
          </button>
        ) : (
          <button disabled={busy} onClick={() => void startEnroll()}>
            Enable
          </button>
        )}
      </div>
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
