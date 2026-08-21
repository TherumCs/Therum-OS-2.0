'use client';
import { useState } from 'react';
import { BASE_PATH } from '../../../lib/session';

interface Token {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

async function asJson(res: Response): Promise<{ ok: boolean; body: unknown }> {
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

export function ApiTokensPanel({ initialTokens }: { initialTokens: Token[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue(): Promise<void> {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, scope, expiresInDays: null }) });
      const { ok, body } = await asJson(res);
      if (!ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'Could not create token.');
      const { token, id } = body as { token: string; id: string };
      setNewToken(token);
      setTokens((prev) => [{ id, name, prefix: token.slice(0, 10), scope, createdAt: new Date().toISOString(), expiresAt: null, lastUsedAt: null, revokedAt: null }, ...prev]);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm('Revoke this token? Anything using it will stop working immediately.')) return;
    await fetch(`${BASE_PATH}/api/tokens/${id}`, { method: 'DELETE' });
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t)));
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="l">API tokens</div>
      <p className="muted" style={{ fontSize: 'var(--th-fs-sm)', marginTop: 'var(--th-space-4)' }}>
        For scripts, CI, or external tools — an alternative to sharing your password. Read tokens can&apos;t make changes.
      </p>

      {newToken && (
        <div className="notice" style={{ background: 'var(--th-success-bg)', color: 'var(--th-success-text)' }}>
          <strong>{newToken}</strong> — copy it now, it won&apos;t be shown again.
        </div>
      )}
      {error && <div className="notice">{error}</div>}

      <div className="row-form" style={{ marginTop: 'var(--th-space-10)' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name (e.g. CI deploy)" style={{ flex: 1 }} />
        <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')} style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-sm)' }}>
          <option value="read">Read only</option>
          <option value="write">Read + write</option>
        </select>
        <button disabled={busy || !name.trim()} onClick={() => void issue()}>
          Create
        </button>
      </div>

      <table style={{ marginTop: 'var(--th-space-14)' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Token</th>
            <th>Scope</th>
            <th>Last used</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id} style={t.revokedAt ? { opacity: 0.45 } : undefined}>
              <td>{t.name}</td>
              <td className="muted">{t.prefix}••••</td>
              <td>
                <span className="pill">{t.scope}</span>
              </td>
              <td className="muted">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'Never'}</td>
              <td className="actions">
                {t.revokedAt ? <span className="muted">Revoked</span> : <button className="ghost" onClick={() => void revoke(t.id)}>Revoke</button>}
              </td>
            </tr>
          ))}
          {!tokens.length && (
            <tr>
              <td colSpan={5} className="muted">
                No tokens yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
