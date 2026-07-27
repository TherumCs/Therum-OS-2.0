'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

export interface NotFoundHit {
  id: string;
  path: string;
  method: string;
  referer: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function NotFoundMonitorClient({ initial }: { initial: NotFoundHit[] }) {
  const router = useRouter();
  const [hits, setHits] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  // Creates a basic 301 → "/" rule and clears the 404 entry — a sensible
  // one-click default (matches the "click to fix" pattern this kind of
  // report is for), not a final answer; the new rule shows up in the table
  // above ready to have its real destination filled in.
  async function createRedirect(hit: NotFoundHit): Promise<void> {
    setBusy(hit.id);
    try {
      await fetch(`${BASE_PATH}/api/redirects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: hit.path, to: '/', code: 301 }),
      });
      await fetch(`${BASE_PATH}/api/redirects/not-found/${hit.id}`, { method: 'DELETE' });
      setHits((prev) => prev.filter((h) => h.id !== hit.id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string): Promise<void> {
    setHits((prev) => prev.filter((h) => h.id !== id));
    await fetch(`${BASE_PATH}/api/redirects/not-found/${id}`, { method: 'DELETE' });
  }

  async function clearAll(): Promise<void> {
    if (!window.confirm('Clear the entire 404 log? This only removes the log — nothing it points at is affected.')) return;
    setHits([]);
    await fetch(`${BASE_PATH}/api/redirects/not-found/clear`, { method: 'POST' });
    router.refresh();
  }

  if (hits.length === 0) {
    return <div className="settings-empty-state">No unmatched paths logged yet.</div>;
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
            <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Path</th>
            <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Method</th>
            <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Hits</th>
            <th style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Last seen</th>
            <th style={{ padding: 'var(--th-space-8) var(--th-space-6)' }} />
          </tr>
        </thead>
        <tbody>
          {hits.map((h) => (
            <tr key={h.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
              <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', fontFamily: 'var(--th-font-mono)', fontSize: 'var(--th-fs-xs)' }}>{h.path}</td>
              <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>{h.method}</td>
              <td style={{ padding: 'var(--th-space-8) var(--th-space-6)' }}>{h.count}</td>
              <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', color: 'var(--th-muted)' }}>{new Date(h.lastSeenAt).toLocaleString()}</td>
              <td style={{ padding: 'var(--th-space-8) var(--th-space-6)', display: 'flex', gap: 'var(--th-space-6)' }}>
                <button type="button" className="ghost" onClick={() => void createRedirect(h)} disabled={busy === h.id}>
                  Create redirect
                </button>
                <button type="button" className="ghost" onClick={() => void dismiss(h.id)}>
                  Dismiss
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={() => void clearAll()} style={{ marginTop: 'var(--th-space-12)' }}>
        Clear log
      </button>
    </div>
  );
}
