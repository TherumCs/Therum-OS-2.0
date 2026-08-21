'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

interface MenuItem {
  label: string;
  href: string;
}

// Nav menu editor (Settings → Site). Whole-array saves: a menu is small and
// ordered, so PATCHing the full list on every change is simpler and safer
// than per-row diffs. Empty list saves as null = auto-built nav.
export function MenuEditor({ initial }: { initial: MenuItem[] | null }) {
  const router = useRouter();
  const [items, setItems] = useState<MenuItem[]>(initial ?? []);
  const [label, setLabel] = useState('');
  const [href, setHref] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function persist(next: MenuItem[]): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/settings/site`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ menu: next.length ? next : null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `Save failed (${res.status})`);
        return;
      }
      setItems(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, dir: -1 | 1): void {
    const next = [...items];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as MenuItem, next[i] as MenuItem];
    void persist(next);
  }

  return (
    <div>
      {error && <p style={{ color: 'var(--th-danger, #ef4444)', fontSize: 12 }}>{error}</p>}
      {items.length === 0 && (
        <p className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          No custom menu — the site auto-builds its nav from published pages, Blog, Work, and Shop. Add an item to take control.
        </p>
      )}
      {items.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((m, i) => (
            <li key={`${m.href}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--th-line)', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</span>
              <code className="muted" style={{ fontSize: 11, flex: 1 }}>{m.href}</code>
              <button type="button" className="ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up" style={{ fontSize: 12 }}>↑</button>
              <button type="button" className="ghost" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down" style={{ fontSize: 12 }}>↓</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void persist(items.filter((_, x) => x !== i))} style={{ fontSize: 12, color: 'var(--th-danger, #ef4444)' }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. About)" style={{ maxWidth: 180 }} />
        <input value={href} onChange={(e) => setHref(e.target.value)} placeholder="Link (/about or https://…)" style={{ flex: 1, minWidth: 200 }} />
        <button
          type="button"
          disabled={busy || !label.trim() || !href.trim()}
          onClick={() => {
            void persist([...items, { label: label.trim(), href: href.trim() }]);
            setLabel('');
            setHref('');
          }}
        >
          Add item
        </button>
      </div>
    </div>
  );
}
