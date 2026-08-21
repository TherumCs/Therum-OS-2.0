'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';
import { filename, formatSize } from './mediaUtils';
import { useMediaActions } from './useMediaActions';
import type { MediaItem } from './MediaTable';

export function MediaRow({ item }: { item: MediaItem }) {
  const router = useRouter();
  const [alt, setAlt] = useState(item.alt ?? '');
  const { menuOpen, setMenuOpen, busy, menuRef, handleRename, handleRegenerateThumbnail, handleDelete } = useMediaActions(item);

  async function saveAlt() {
    if (alt === (item.alt ?? '')) return;
    await fetch(`${BASE_PATH}/api/media/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alt: alt || null }),
    }).catch(() => {});
    router.refresh();
  }

  const thumbUrl = item.kind === 'image' ? item.meta?.thumbnailUrl ?? item.url : null;

  return (
    <tr aria-busy={busy}>
      <td>
        <div className="th-media-file-cell">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="th-media-thumb" src={thumbUrl} alt="" />
          ) : (
            <div className="th-media-thumb" />
          )}
          <span>{filename(item.url)}</span>
        </div>
      </td>
      <td>
        <input
          className="th-media-alt-input"
          value={alt}
          placeholder="Add alt text…"
          onChange={(e) => setAlt(e.target.value)}
          onBlur={saveAlt}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
      <td className="muted" style={{ textTransform: 'capitalize' }}>
        {item.kind}
      </td>
      <td className="muted">{formatSize(item.size)}</td>
      <td className="muted">{new Date(item.createdAt).toLocaleDateString()}</td>
      <td className="actions">
        <div className="th-media-kebab-wrap" ref={menuRef}>
          <button type="button" className="th-lp-kebab-btn" aria-label="More actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <div className="th-lp-kebab-menu" role="menu">
              <button role="menuitem" type="button" className="th-lp-kebab-item" onClick={handleRename} disabled={busy}>
                Rename
              </button>
              {item.kind === 'image' && (
                <button role="menuitem" type="button" className="th-lp-kebab-item" onClick={handleRegenerateThumbnail} disabled={busy}>
                  Regenerate thumbnail
                </button>
              )}
              <button role="menuitem" type="button" className="th-lp-kebab-item danger" onClick={handleDelete} disabled={busy}>
                Delete
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
