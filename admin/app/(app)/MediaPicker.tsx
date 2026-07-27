'use client';
import { useEffect, useState } from 'react';
import { BASE_PATH } from '../../lib/session';

interface MediaAsset {
  id: string;
  url: string;
  alt: string | null;
  kind: string;
}

// Reusable media picker (pre-Sidemoney punch list): modal grid over the real
// Media library; select → onPick(url). Consumers: product editor (primary
// image + gallery), content cover images later. Upload stays on the Media
// page — this is a picker, not a second uploader.
export function MediaPicker({ open, onPick, onClose, kind }: { open: boolean; onPick: (asset: { url: string; alt: string | null }) => void; onClose: () => void; kind?: 'image' | 'video' }) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAssets(null);
    setError('');
    void fetch(`${BASE_PATH}/api/media?limit=100${kind ? `&kind=${kind}` : ''}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Media list failed (${r.status})`);
        const body = (await r.json()) as { items: MediaAsset[] };
        setAssets(body.items);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load media'));
  }, [open, kind]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 70 }} />
      <div style={{ position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)', width: 'min(720px, 94vw)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--th-surface)', border: '1px solid var(--th-line)', borderRadius: 14, zIndex: 71, padding: 20, boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>Pick from Media</strong>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        {error && <p style={{ color: 'var(--th-danger, #ef4444)', fontSize: 12 }}>{error}</p>}
        {!assets && !error && <p className="muted">Loading…</p>}
        {assets && assets.length === 0 && (
          <p className="muted">
            Nothing in the library yet — upload on the <a href={`${BASE_PATH}/media`} style={{ color: 'var(--th-accent)' }}>Media page</a> first.
          </p>
        )}
        {assets && assets.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {assets.map((a) => (
              <button key={a.id} type="button" onClick={() => onPick({ url: a.url, alt: a.alt })} style={{ padding: 0, border: '1px solid var(--th-line)', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: 'var(--th-surface)', aspectRatio: '1' }}>
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
      </div>
    </>
  );
}
