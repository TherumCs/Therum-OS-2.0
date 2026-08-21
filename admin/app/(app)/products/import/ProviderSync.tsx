'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

// Sync the catalogue from a connected provider.
//
// Provider-agnostic: this lists whatever catalogSync.ts registers, so a new
// integration appears here without touching this file. Separate from the file
// importer below it because it is a different act — that one reads a file you
// supply and asks what its columns mean, this one already knows.

interface Provider {
  id: string;
  label: string;
  connected: boolean;
}

interface SyncResult {
  provider: string;
  created: number;
  updated: number;
  variants: number;
  skipped: { name: string; reason: string }[];
}

export function ProviderSync() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${BASE_PATH}/api/counter/sync/providers`)
      .then((r) => r.json())
      .then((d: { providers: Provider[] }) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  async function run(id: string): Promise<void> {
    setBusy(id);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/counter/sync/${encodeURIComponent(id)}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.text()) || `Sync failed (${res.status})`);
      setResult((await res.json()) as SyncResult);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (providers.length === 0) return null;

  return (
    <div className="th-card" style={{ padding: 16, marginBottom: 20 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 'var(--th-fs-md)' }}>Sync from a provider</h2>
      <p className="th-hint" style={{ marginTop: 0, maxWidth: '68ch' }}>
        Pulls products, variants, prices and images from a connected provider. Safe to re-run — products are matched
        on the provider&apos;s own ids, so nothing duplicates. Descriptions, categories and tags you edit here are
        left alone; only name, image, price and stock follow the provider.
      </p>

      <div style={{ display: 'flex', gap: 'var(--th-space-8)', flexWrap: 'wrap' }}>
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            className="th-btn-primary"
            onClick={() => void run(p.id)}
            disabled={busy !== null || !p.connected}
            title={p.connected ? undefined : `${p.label} is not connected — add it under Connections`}
          >
            {busy === p.id ? `Syncing ${p.label}…` : `Sync ${p.label}`}
          </button>
        ))}
      </div>

      {providers.some((p) => !p.connected) && (
        <p className="th-hint" style={{ marginBottom: 0 }}>
          Greyed out means not connected yet — add it under Connections.
        </p>
      )}

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
