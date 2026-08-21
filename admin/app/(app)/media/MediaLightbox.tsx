'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';
import { filename, formatSize } from './mediaUtils';
import type { MediaItem } from './MediaTable';

// Full-bleed viewer with the controls floating ON the image rather than in a
// panel beside it — the tiles themselves are now bare artwork (no caption box
// under each one), so this is where a file's name, size and every edit action
// live. Each action opens its own screen in the same overlay instead of a
// window.prompt(): rename, alt text, crop, and adjust (rotate/flip).

type Screen = null | 'rename' | 'alt' | 'crop' | 'adjust';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
];

function baseName(url: string): string {
  return filename(url).replace(/\.[^.]+$/, '');
}

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICON = {
  rename: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M4 20h16" />
      <path d="M14.5 4.5 19 9 8 20H3.5v-4.5z" />
    </svg>
  ),
  alt: (
    <svg viewBox="0 0 24 24" {...s}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 15l2.5-6L12 15M8 13h3M15 9v6M15 12h3" />
    </svg>
  ),
  crop: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M6 2v16h16" />
      <path d="M2 6h16v16" />
    </svg>
  ),
  adjust: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  revert: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2A5 5 0 0 0 12.5 4.5l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2A5 5 0 0 0 11.5 19.5l1-1" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  ),
};

// One toolbar button: icon over label so every target is the same size and
// the row scans as a toolbar rather than as a sentence of pills. Renders as
// an <a> when given an href (Download must be a real link to download).
function ToolButton({
  label,
  icon,
  onClick,
  href,
  danger,
  disabled,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const cls = 'th-lbx-btn' + (danger ? ' danger' : '');
  const inner = (
    <>
      <span className="th-lbx-btn-icon">{icon}</span>
      <span className="th-lbx-btn-label">{label}</span>
    </>
  );
  if (href) {
    return (
      <a className={cls} href={href} download title={title ?? label}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title ?? label}>
      {inner}
    </button>
  );
}

export function MediaLightbox({
  items,
  openId,
  onClose,
  onNavigate,
}: {
  items: MediaItem[];
  openId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const router = useRouter();
  const index = items.findIndex((i) => i.id === openId);
  const item = index >= 0 ? items[index] : null;

  const [screen, setScreen] = useState<Screen>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [altDraft, setAltDraft] = useState('');
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [rotate, setRotate] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Every draft is per-item: reopening on a different file must not inherit
  // the last one's half-typed name or an unapplied crop.
  const resetDrafts = useCallback(() => {
    setScreen(null);
    setError(null);
    setCrop(null);
    setAspect(null);
    setRotate(0);
    setFlipX(false);
    setFlipY(false);
  }, []);

  useEffect(() => {
    if (!item) return;
    setNameDraft(baseName(item.url));
    setAltDraft(item.alt ?? '');
    resetDrafts();
  }, [item?.id, resetDrafts, item]);

  const go = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = items[(index + delta + items.length) % items.length];
      if (next) onNavigate(next.id);
    },
    [index, items, onNavigate],
  );

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape backs out of a screen first, then closes — otherwise a
        // half-finished crop would drop you all the way out of the viewer.
        if (screen) setScreen(null);
        else onClose();
        return;
      }
      // Arrows are for moving the crop selection while that screen is open.
      if (screen) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under a full-screen overlay.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openId, screen, go, onClose]);

  if (!item) return null;

  const isImage = item.kind === 'image';
  const hasOriginal = typeof item.meta?.originalUrl === 'string';

  async function send(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/${item!.id}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAlt() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/${item!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alt: altDraft.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      router.refresh();
      setScreen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Drag a selection over the displayed image. Coordinates are kept as 0–1
  // fractions of the rendered image box, which is exactly what the transform
  // endpoint wants — no scaling maths at either end, and it stays correct
  // whatever size the viewport renders the image at.
  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const img = imgRef.current;
    if (!img || screen !== 'crop') return;
    const box = img.getBoundingClientRect();
    const startX = (e.clientX - box.left) / box.width;
    const startY = (e.clientY - box.top) / box.height;
    if (startX < 0 || startX > 1 || startY < 0 || startY > 1) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const onMove = (ev: PointerEvent) => {
      const curX = clamp((ev.clientX - box.left) / box.width);
      let curY = clamp((ev.clientY - box.top) / box.height);
      // With an aspect lock the pointer only drives width; height follows, so
      // the ratio holds no matter how the drag wanders.
      if (aspect) {
        const w = Math.abs(curX - startX);
        const h = (w * box.width) / aspect / box.height;
        curY = startY + Math.sign(curY - startY || 1) * h;
        curY = clamp(curY);
      }
      setCrop({
        x: Math.min(startX, curX),
        y: Math.min(startY, curY),
        width: Math.abs(curX - startX),
        height: Math.abs(curY - startY),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  const previewTransform = [
    rotate ? `rotate(${rotate}deg)` : '',
    flipX ? 'scaleX(-1)' : '',
    flipY ? 'scaleY(-1)' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const dirty = Boolean(crop) || rotate !== 0 || flipX || flipY;

  return (
    <div className="th-lbx" role="dialog" aria-modal="true" aria-label={item.alt || filename(item.url)}>
      {/* A plain div, not a button: a full-screen <button> inherits the
          admin's global button styling (accent fill, border) and announces
          itself to screen readers as a giant control. Escape and the ✕ in the
          top bar are the accessible ways out. */}
      <div className="th-lbx-scrim" onClick={onClose} />

      <div className="th-lbx-top">
        <div className="th-lbx-name">{item.alt || filename(item.url)}</div>
        <div className="th-lbx-count">
          {index + 1} / {items.length}
        </div>
        <button type="button" className="th-lbx-icon" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {items.length > 1 && (
        <>
          <button type="button" className="th-lbx-nav prev" onClick={() => go(-1)} aria-label="Previous">
            ‹
          </button>
          <button type="button" className="th-lbx-nav next" onClick={() => go(1)} aria-label="Next">
            ›
          </button>
        </>
      )}

      <div
        ref={stageRef}
        className={'th-lbx-stage' + (screen === 'crop' ? ' cropping' : '')}
        onPointerDown={onStagePointerDown}
      >
        {/* The frame shrinks to the media's own box inside the (larger) stage,
            so the crop rectangle's percentages are relative to the image and
            not to the letterboxing around it. */}
        <div className="th-lbx-frame">
        {isImage ? (
          <img ref={imgRef} src={item.url} alt={item.alt ?? ''} style={previewTransform ? { transform: previewTransform } : undefined} />
        ) : item.kind === 'video' ? (
          <video src={item.url} controls />
        ) : item.kind === 'audio' ? (
          <audio src={item.url} controls />
        ) : (
          <div className="th-lbx-file">
            <div className="th-lbx-file-ext">{filename(item.url).split('.').pop()?.toUpperCase()}</div>
            <div className="th-lbx-file-name">{filename(item.url)}</div>
          </div>
        )}

        {screen === 'crop' && crop && (
          <div
            className="th-lbx-crop"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            }}
          />
        )}
        </div>
      </div>

      {/* Toolbar + screens ride over the image on a translucent panel. */}
      <div className="th-lbx-bar">
        {screen === null && (
          <>
            {/* One row, grouped by what the buttons do to the file: edit,
                then take-a-copy, then destructive — separated by rules so the
                grouping is visible rather than a wall of equal-weight pills.
                Icon over label keeps every hit target the same size. */}
            <div className="th-lbx-tools" role="toolbar" aria-label="Image actions">
              <div className="th-lbx-file-id">
                <span className="th-lbx-file-title">{filename(item.url)}</span>
                <span className="th-lbx-file-facts">
                  {item.width && item.height ? `${item.width} × ${item.height}` : item.kind.toUpperCase()}
                  <i />
                  {formatSize(item.size)}
                  {hasOriginal && (
                    <>
                      <i />
                      <span className="th-lbx-badge">Edited</span>
                    </>
                  )}
                </span>
              </div>

              <span className="th-lbx-sep" />

              <div className="th-lbx-group">
                <ToolButton label="Rename" onClick={() => setScreen('rename')} icon={ICON.rename} />
                <ToolButton label="Alt text" onClick={() => setScreen('alt')} icon={ICON.alt} />
                {isImage && <ToolButton label="Crop" onClick={() => setScreen('crop')} icon={ICON.crop} />}
                {isImage && <ToolButton label="Adjust" onClick={() => setScreen('adjust')} icon={ICON.adjust} />}
                {hasOriginal && (
                  <ToolButton
                    label="Revert"
                    title="Restore the file exactly as it was uploaded"
                    disabled={busy}
                    onClick={() => void send('/revert')}
                    icon={ICON.revert}
                  />
                )}
              </div>

              <span className="th-lbx-sep" />

              <div className="th-lbx-group">
                <ToolButton label="Download" href={item.url} icon={ICON.download} />
                <ToolButton
                  label={copied ? 'Copied' : 'Copy URL'}
                  onClick={async () => {
                    await navigator.clipboard?.writeText(new URL(item.url, location.origin).href);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  icon={copied ? ICON.check : ICON.link}
                />
              </div>

              <span className="th-lbx-spacer" />

              <ToolButton
                label="Delete"
                danger
                disabled={busy}
                icon={ICON.trash}
                onClick={async () => {
                  if (!window.confirm(`Delete "${filename(item.url)}"? This can't be undone.`)) return;
                  setBusy(true);
                  const res = await fetch(`${BASE_PATH}/api/media/${item.id}`, { method: 'DELETE' });
                  setBusy(false);
                  if (res.ok) {
                    onClose();
                    router.refresh();
                  } else setError(await res.text());
                }}
              />
            </div>
          </>
        )}

        {screen === 'rename' && (
          <form
            className="th-lbx-screen"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nameDraft.trim()) return;
              if (await send('/rename', { basename: nameDraft.trim() })) setScreen(null);
            }}
          >
            <label className="th-lbx-field">
              <span>File name</span>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
            </label>
            <div className="th-lbx-screen-actions">
              <button type="button" className="th-lbx-tool" onClick={() => setScreen(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="th-lbx-tool primary" disabled={busy || !nameDraft.trim()}>
                {busy ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </form>
        )}

        {screen === 'alt' && (
          <form
            className="th-lbx-screen"
            onSubmit={(e) => {
              e.preventDefault();
              void saveAlt();
            }}
          >
            <label className="th-lbx-field">
              <span>Alt text — what this image shows, for screen readers and search</span>
              <input value={altDraft} onChange={(e) => setAltDraft(e.target.value)} autoFocus placeholder="Describe the image" />
            </label>
            <div className="th-lbx-screen-actions">
              <button type="button" className="th-lbx-tool" onClick={() => setScreen(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="th-lbx-tool primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save alt text'}
              </button>
            </div>
          </form>
        )}

        {screen === 'crop' && (
          <div className="th-lbx-screen">
            <div className="th-lbx-screen-title">
              Drag on the image to select the area to keep.
              {crop ? ` Selection ${Math.round(crop.width * 100)}% × ${Math.round(crop.height * 100)}%.` : ''}
            </div>
            <div className="th-lbx-chips">
              {ASPECTS.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={'th-lbx-chip' + (aspect === a.ratio ? ' active' : '')}
                  onClick={() => setAspect(a.ratio)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="th-lbx-screen-actions">
              <button type="button" className="th-lbx-tool" onClick={() => setCrop(null)} disabled={busy || !crop}>
                Clear
              </button>
              <button type="button" className="th-lbx-tool" onClick={() => setScreen(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="th-lbx-tool primary"
                disabled={busy || !crop}
                onClick={async () => {
                  if (!crop) return;
                  if (await send('/transform', { crop, rotate: 0, flipX: false, flipY: false })) {
                    resetDrafts();
                  }
                }}
              >
                {busy ? 'Applying…' : 'Apply crop'}
              </button>
            </div>
          </div>
        )}

        {screen === 'adjust' && (
          <div className="th-lbx-screen">
            <div className="th-lbx-screen-title">Rotate and flip. The preview above shows the result before you save.</div>
            <div className="th-lbx-chips">
              <button type="button" className="th-lbx-chip" onClick={() => setRotate((r) => (r + 270) % 360)}>
                ⟲ Rotate left
              </button>
              <button type="button" className="th-lbx-chip" onClick={() => setRotate((r) => (r + 90) % 360)}>
                ⟳ Rotate right
              </button>
              <button type="button" className={'th-lbx-chip' + (flipX ? ' active' : '')} onClick={() => setFlipX((v) => !v)}>
                ⇄ Flip horizontal
              </button>
              <button type="button" className={'th-lbx-chip' + (flipY ? ' active' : '')} onClick={() => setFlipY((v) => !v)}>
                ⇅ Flip vertical
              </button>
            </div>
            <div className="th-lbx-screen-actions">
              {/* Reset clears the pending rotation/flip but stays on this
                  screen; Cancel backs out of the screen entirely. */}
              <button
                type="button"
                className="th-lbx-tool"
                disabled={busy || !dirty}
                onClick={() => {
                  setRotate(0);
                  setFlipX(false);
                  setFlipY(false);
                }}
              >
                Reset
              </button>
              <button type="button" className="th-lbx-tool" onClick={resetDrafts} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="th-lbx-tool primary"
                disabled={busy || !dirty}
                onClick={async () => {
                  if (await send('/transform', { rotate, flipX, flipY })) resetDrafts();
                }}
              >
                {busy ? 'Applying…' : 'Apply changes'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="th-lbx-error">{error}</div>}
      </div>
    </div>
  );
}
