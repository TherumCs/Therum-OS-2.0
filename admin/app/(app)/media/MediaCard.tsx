'use client';
import type { CSSProperties } from 'react';
import { filename, formatSize } from './mediaUtils';
import { useMediaActions } from './useMediaActions';
import type { MediaItem } from './MediaTable';

const KIND_LABEL: Record<string, string> = { video: 'VID', audio: 'AUD', file: 'DOC' };

// Grid + masonry share this card (same as 1.9.44's Therum_Media_Page::render_card(),
// used unchanged in both the grid and masonry panes) — square thumb in grid, real
// aspect-ratio in masonry via the --th-aspect custom property (see globals.css'
// `.th-lp-view-masonry .th-lp-card-thumb` override, which naturally wins on
// specificity so this component doesn't need to know which pane it's in).
export function MediaCard({ item }: { item: MediaItem }) {
  const { menuOpen, setMenuOpen, busy, menuRef, handleRename, handleRegenerateThumbnail, handleDelete } = useMediaActions(item);

  const thumbUrl = item.kind === 'image' ? item.meta?.thumbnailUrl ?? item.url : null;
  const aspect = item.width && item.height ? item.width / item.height : 1;
  const date = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="th-lp-card th-lp-card-media" aria-busy={busy}>
      <a className="th-lp-card-link" href={item.url} target="_blank" rel="noopener">
        <div
          className="th-lp-card-thumb th-lp-card-thumb-square"
          style={
            {
              '--th-aspect': aspect,
              ...(thumbUrl ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
            } as CSSProperties
          }
        >
          {!thumbUrl && <span>{KIND_LABEL[item.kind] ?? 'DOC'}</span>}
        </div>
        <div className="th-lp-card-meta">
          <div className="th-lp-card-title">{item.alt || filename(item.url)}</div>
          <div className="th-lp-card-sub">
            {formatSize(item.size)} · {date}
          </div>
        </div>
      </a>
      <div className="th-lp-card-kebab-wrap" ref={menuRef}>
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
    </div>
  );
}
