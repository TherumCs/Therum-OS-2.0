'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

// Pull the catalogue from Printful.
//
// Separate from the file importer above it because it is a different act: that
// one reads a file you supply and asks what its columns mean, this one talks to
// a connected provider and already knows. Re-running is safe and expected —
// matching is by Printful's own product id.

interface SyncResult {
  created: number;
  updated: number;
  variants: number;
  skipped: { name: string; reason: string }[];
}

export function PrintfulSync() {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/counter/sync/printful/status`)
      .then((r) => r.json())
      .then((d: { available: boolean }) => setAvailable(d.available))
      .catch(() => setAvailable(false));
  }, []);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/counter/sync/printful`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.text()) || `Sync failed (${res.status})`);
      setResult((await res.json()) as SyncResult);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="th-card" style={{ padding: 16, marginBottom: 20 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 'var(--th-fs-md)' }}>Sync from Printful</h2>
      <p className="th-hint" style={{ marginTop: 0, maxWidth: '68ch' }}>
        Pulls every product in your Printful store, with its variants, prices and images. Safe to re-run — products
        are matched on Printful&apos;s own id, so nothing duplicates. Descriptions, categories and tags you edit here
        are left alone; only name, image, price and stock follow Printful.
      </p>

      {available === false && (
        <p className="th-hint" style={{ maxWidth: '68ch' }}>
          Printful is not connected yet. Add it under Connections, then come back.
        </p>
      )}

      <button type="button" className="th-btn-primary" onClick={() => void run()} disabled={busy || available !== true}>
        {busy ? 'Syncing…' : 'Sync now'}
      </button>

      {error && <p className="th-agent__error" style={{ marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--th-fs-sm)' }}>
            <strong>{result.created}</strong> created · <strong>{result.updated}</strong> updated ·{' '}
            <strong>{result.variants}</strong> variants
          </p>
          {/* Skipped products are listed with a reason rather than folded into
              a count — "3 skipped" tells you nothing you can act on. */}
          {result.skipped.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="th-hint">{result.skipped.length} not imported</summary>
              <ul className="th-hint" style={{ marginTop: 6 }}>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <strong>{s.name}</strong> — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
