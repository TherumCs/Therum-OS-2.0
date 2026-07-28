'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { filename, formatSize } from './mediaUtils';
import { useMediaActions } from './useMediaActions';
import type { MediaItem } from './MediaTable';

const KIND_LABEL: Record<string, string> = { video: 'VID', audio: 'AUD', file: 'DOC' };

// Grid / masonry tile — the artwork and nothing else.
//
// This used to be a content-style card: cover-cropped square thumb with a
// caption box bolted underneath. Two things were wrong with that. The caption
// box made a library of images read like a list of blog posts, and `cover`
// crops — so a wide banner or a logo showed as an unidentifiable centre slice.
// Now the image is shown whole (`contain` in grid, true aspect in masonry),
// the name rides in on hover, and everything else moved into the lightbox.
// The table view is still the place to see metadata for every row at once.
export function MediaCard({ item, onOpen }: { item: MediaItem; onOpen?: (id: string) => void }) {
  const { menuOpen, setMenuOpen, busy, menuRef, handleRename, handleRegenerateThumbnail, handleDelete } = useMediaActions(item);
  const [hover, setHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const thumbUrl = item.kind === 'image' ? item.meta?.thumbnailUrl ?? item.url : null;
  const aspect = item.width && item.height ? item.width / item.height : 1;
  const date = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Motion is hover-only, never on load. A page holds 48 tiles: autoplaying
  // all of them is a CPU fire and makes the library impossible to scan. The
  // still thumbnail is what's painted until you point at something.
  const isAnimated = item.meta?.animated === true;
  const isVideo = item.kind === 'video';
  const canMove = isAnimated || isVideo;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hover) {
      void v.play().catch(() => {});
    } else {
      v.pause();
      // Back to the first frame, so leaving and returning always starts over
      // rather than resuming from a random point.
      v.currentTime = 0;
    }
  }, [hover]);

  // Respect the OS "reduce motion" setting — no hover playback at all there.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const playing = hover && canMove && !reduceMotion;

  return (
    <div
      className="th-lp-card th-lp-card-media"
      aria-busy={busy}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="th-lp-card-link"
        aria-label={`Open ${item.alt || filename(item.url)}`}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => onOpen?.(item.id)}
      >
        <div className="th-lp-card-thumb th-lp-card-thumb-square" style={{ '--th-aspect': aspect } as CSSProperties}>
          {isVideo ? (
            // preload="metadata" keeps a wall of tiles cheap — only the first
            // frame and duration come down until something is hovered.
            <video
              ref={videoRef}
              src={item.url}
              poster={item.meta?.thumbnailUrl}
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : thumbUrl ? (
            // A real <img> rather than a background so `contain` can letterbox
            // it without cropping, and so the browser handles srcset/decoding.
            // On hover an animated file swaps to the full source: the
            // thumbnail is a deliberate single frame (see imagePipeline), so
            // this is what actually makes a GIF move.
            <img src={playing ? item.url : thumbUrl} alt="" loading="lazy" />
          ) : (
            <span className="th-media-kind">{KIND_LABEL[item.kind] ?? 'DOC'}</span>
          )}
          {canMove && !playing && <span className="th-media-motion">{isVideo ? '▶' : 'GIF'}</span>}
        </div>
        {/* Hover caption — the only text on a tile, and only when pointed at. */}
        <div className="th-media-caption">
          <span className="th-media-caption-name">{item.alt || filename(item.url)}</span>
          <span className="th-media-caption-sub">
            {formatSize(item.size)} · {date}
          </span>
        </div>
      </button>
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
            <button role="menuitem" type="button" className="th-lp-kebab-item" onClick={() => { setMenuOpen(false); onOpen?.(item.id); }}>
              Open
            </button>
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
