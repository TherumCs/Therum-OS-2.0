'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../../lib/session';

interface MediaAsset {
  id: string;
  url: string;
  alt: string | null;
  kind: string;
}

// Reusable media picker (product editor primary/gallery/variant images, content
// covers). It is the REAL library: it pages through every asset via the list
// endpoint's cursor (not a silent 100-cap that hid most of a 1000-item library),
// searches with ?q=, and uploads a brand-new file through the same
// /api/media/upload the Media page uses — applying it immediately. Upload +
// search + full pagination are the three things a "pick from a stub" modal was
// missing.
export function MediaPicker({ open, onPick, onClose, kind }: { open: boolean; onPick: (asset: { url: string; alt: string | null }) => void; onClose: () => void; kind?: 'image' | 'video' }) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (reset: boolean, after: string | null, term: string) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (kind) params.set('kind', kind);
        if (term.trim()) params.set('q', term.trim());
        if (!reset && after) params.set('cursor', after);
        const r = await fetch(`${BASE_PATH}/api/media?${params}`);
        if (!r.ok) throw new Error(`Media list failed (${r.status})`);
        const body = (await r.json()) as { items: MediaAsset[]; nextCursor: string | null; total?: number };
        setItems((prev) => (reset || !prev ? body.items : [...prev, ...body.items]));
        setCursor(body.nextCursor);
        if (typeof body.total === 'number') setTotal(body.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load media');
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  // (Re)load page one whenever opened, the kind changes, or the search settles.
  // Debounce the search so typing does not fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { setItems(null); setCursor(null); void load(true, null, q); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, q, load]);

  // Clear the search box on each fresh open.
  useEffect(() => { if (open) setQ(''); }, [open]);

  async function uploadFile(file: File): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE_PATH}/api/media/upload`, { method: 'POST', body: form });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(b?.error?.message ?? `Upload failed (${res.status})`);
      }
      const asset = (await res.json()) as MediaAsset;
      onPick({ url: asset.url, alt: asset.alt }); // apply the new image immediately
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (!open) return null;
  const count = items?.length ?? 0;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70 }} />
      <div style={{ position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)', width: 'min(760px, 94vw)', maxHeight: '82vh', overflowY: 'auto', background: 'var(--th-surface)', border: '1px solid var(--th-line)', borderRadius: 14, zIndex: 71, padding: 20, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>Media library{total !== null ? ` — ${count} of ${total}` : ''}</strong>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the whole library…"
            aria-label="Search media"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1px solid var(--th-line)', borderRadius: 8, background: 'var(--th-surface)', color: 'inherit' }}
          />
          <input ref={inputRef} type="file" accept={kind === 'video' ? 'video/*' : 'image/*'} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
          <button type="button" className="th-btn th-btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload new'}
          </button>
        </div>

        {error && <p style={{ color: 'var(--th-danger, #ef4444)', fontSize: 12 }}>{error}</p>}
        {!items && loading && <p className="muted">Loading…</p>}
        {items && items.length === 0 && !loading && (
          <p className="muted">
            {q.trim() ? 'No media matches that search.' : <>Nothing in the library yet — use <strong>Upload new</strong> above.</>}
          </p>
        )}
        {items && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
            {items.map((a) => (
              <button key={a.id} type="button" onClick={() => { onPick({ url: a.url, alt: a.alt }); onClose(); }} title={a.alt ?? ''} style={{ padding: 0, border: '1px solid var(--th-line)', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'var(--th-surface)', aspectRatio: '1' }}>
                {a.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.alt ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: 'var(--th-muted)' }}>{a.kind}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {cursor && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
            <button type="button" className="th-btn" disabled={loading} onClick={() => void load(false, cursor, q)}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
