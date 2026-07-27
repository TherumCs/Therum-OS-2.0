'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

export interface RedirectRule {
  id: string;
  from: string;
  to: string;
  code: number;
  isRegex: boolean;
  enabled: boolean;
  hits: number;
  createdAt: string;
}

export function RedirectsClient({ initial }: { initial: RedirectRule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [code, setCode] = useState('301');
  const [isRegex, setIsRegex] = useState(false);
  const [busy, setBusy] = useState(false);

  async function addRule(): Promise<void> {
    if (!from.trim() || !to.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/redirects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: from.trim(), to: to.trim(), code: Number(code), isRegex }),
      });
      const rule = (await res.json()) as RedirectRule;
      setRules((prev) => [rule, ...prev]);
      setFrom('');
      setTo('');
      setIsRegex(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(id: string): Promise<void> {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    await fetch(`${BASE_PATH}/api/redirects/${id}/toggle`, { method: 'POST' });
    router.refresh();
  }

  async function deleteRule(id: string): Promise<void> {
    setRules((prev) => prev.filter((r) => r.id !== id));
    await fetch(`${BASE_PATH}/api/redirects/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--th-space-8)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--th-space-16)' }}>
        <input className="settings-text-input" style={{ maxWidth: 200 }} placeholder="/old-path (or regex)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="settings-text-input" style={{ maxWidth: 240 }} placeholder="/new-path or https://…" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="settings-select" style={{ minWidth: 140 }} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="301">301 Permanent</option>
          <option value="302">302 Temporary</option>
          <option value="307">307 Temporary</option>
          <option value="308">308 Permanent</option>
          <option value="410">410 Gone</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--th-space-6)', fontSize: 'var(--th-fs-sm)' }}>
          <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} />
          regex
        </label>
        <button type="button" onClick={() => void addRule()} disabled={busy}>
          Add
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="settings-empty-state">No redirect rules yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
              <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>From</th>
              <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>To</th>
              <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Code</th>
              <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Hits</th>
              <th style={{ padding: 'var(--th-space-8) var(--th-space-6)' }} />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--th-line)', opacity: r.enabled ? 1 : 0.5 }}>
                <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', fontFamily: 'var(--th-font-mono)', fontSize: 'var(--th-fs-xs)' }}>{r.from}</td>
                <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', fontFamily: 'var(--th-font-mono)', fontSize: 'var(--th-fs-xs)' }}>{r.to}</td>
                <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{r.code}</td>
                <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{r.hits}</td>
                <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', display: 'flex', gap: 'var(--th-space-6)' }}>
                  <button type="button" className="ghost" onClick={() => void toggleRule(r.id)}>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="ghost" onClick={() => void deleteRule(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
