'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { timeAgo } from '../../lib/types';
import { cardGradient } from '../../lib/cardGradient';
import { wordCount } from '../../lib/wordCount';
import { BASE_PATH } from '../../lib/session';
import type { ListView } from './listViews';

export interface ContentCardItem {
  id: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  status: string;
  updatedAt: string;
  body?: unknown;
  bodyFormat?: string;
  meta?: Record<string, unknown> | null;
  // Pre-computed server-side (builderEditUrl() reads the session cookie via
  // next/headers, which only works in a Server Component — this card also
  // renders inside a Client Component's tree via ListPageToolbar, so the URL
  // must arrive as a plain string prop, not be computed in here).
  editUrl: string;
  // Case-study cards get the extra Details editor (client/date/services/
  // outcome stored under meta.caseStudy) — set by the case-studies page only.
  caseStudyDetails?: boolean;
}

interface CaseStudyMeta {
  client?: string;
  projectDate?: string;
  services?: string;
  outcome?: string;
}

function caseStudyMeta(item: ContentCardItem): CaseStudyMeta {
  const m = item.meta && typeof item.meta === 'object' ? (item.meta as Record<string, unknown>).caseStudy : null;
  return m && typeof m === 'object' ? (m as CaseStudyMeta) : {};
}

const STATUS_LABEL: Record<string, string> = { published: 'Published', draft: 'Draft', archived: 'Archived' };
const STATUS_DOT_CLASS: Record<string, string> = { published: 'is-published', draft: 'is-draft', archived: 'is-archived' };

// One card, four layouts — the set Therum_Card_Style::layout() and
// Therum_List_Page's view toggles expose in 1.9.44:
//   card  image up top, title + excerpt + pills, CTA row (the default)
//   hero  the same card at full width with a tall image — one per row
//   list  no image; title, pills and actions on a single row
//   grid  dense multi-column: image, title, status pill, nothing else
// The differences that are purely visual live in globals.css under
// .th-lp-list-<view>; only the parts that change WHICH chrome renders are
// branched here, so all four keep the same kebab menu and actions.
export function ContentCard({ item, variant = 'card', thumbnailSource = 'auto' }: { item: ContentCardItem; variant?: ListView; thumbnailSource?: string }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<CaseStudyMeta>(() => caseStudyMeta(item));
  const menuRef = useRef<HTMLDivElement>(null);

  async function handleSaveDetails() {
    setBusy(true);
    try {
      // meta is replace-on-write server-side — merge from the item's current
      // meta so unrelated keys survive.
      const merged = { ...(item.meta && typeof item.meta === 'object' ? item.meta : {}), caseStudy: details };
      const res = await fetch(`${BASE_PATH}/api/content/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meta: merged }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDetailsOpen(false);
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't save details: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // `?embed=1` is the existing Desktop-Mode bare-render escape hatch
  // (middleware.ts → x-th-embed header → (app)/layout.tsx skips the
  // sidebar/topbar shell) — reused here so a preview isn't wrapped in admin
  // chrome, without a second route group just for this.
  const previewUrl = `${BASE_PATH}/preview/${item.id}?embed=1`;

  async function handleDuplicate() {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/content/${item.id}/duplicate`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't duplicate: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${item.title || '(untitled)'}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/content/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  // Appearance > Lists & cards: 'cover-only' suppresses the generated
  // gradient stand-in, leaving a plain surface when a page has no cover.
  const bg = item.coverImage
    ? { backgroundImage: `url(${item.coverImage})` }
    : thumbnailSource === 'cover-only'
      ? undefined
      : { background: cardGradient(item.id) };

  // List view is a text row — an image band there would just be a coloured
  // stripe on every line. Grid view drops the excerpt so the tiles stay even.
  const showThumb = variant !== 'list';
  const showExcerpt = variant === 'card' || variant === 'hero';

  const kebab = (
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
          <a role="menuitem" className="th-lp-kebab-item" href={previewUrl} target="_blank" rel="noopener" onClick={() => setMenuOpen(false)}>
            Preview
          </a>
          {item.caseStudyDetails && (
            <button
              role="menuitem"
              type="button"
              className="th-lp-kebab-item"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                // Re-seed from the CURRENT prop every open — the card
                // stays mounted across router.refresh(), so mount-time
                // state would show (and re-save) stale values after any
                // out-of-band meta change (audit finding #6).
                setDetails(caseStudyMeta(item));
                setDetailsOpen(true);
              }}
            >
              Details
            </button>
          )}
          <button role="menuitem" type="button" className="th-lp-kebab-item" onClick={handleDuplicate} disabled={busy}>
            Duplicate
          </button>
          <button role="menuitem" type="button" className="th-lp-kebab-item danger" onClick={handleDelete} disabled={busy}>
            Delete
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={`th-lp-card th-lp-card-${variant}`} aria-busy={busy}>
      {showThumb && (
        <div className="th-lp-card-thumb" style={bg}>
          {kebab}
        </div>
      )}
      <div className="th-lp-card-meta">
        <div className="th-lp-card-title">{item.title || '(untitled)'}</div>
        {showExcerpt && item.excerpt && <p className="th-lp-card-excerpt">{item.excerpt}</p>}
        <div className="th-lp-card-pills">
          <span className="th-lp-card-pill">
            <span className={'th-lp-card-pill-dot ' + (STATUS_DOT_CLASS[item.status] ?? '')} />
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
          {item.caseStudyDetails && caseStudyMeta(item).client && <span className="th-lp-card-pill">{caseStudyMeta(item).client}</span>}
          <span className="th-lp-card-pill">{wordCount(item)} words</span>
          <span className="th-lp-card-pill">{timeAgo(item.updatedAt)}</span>
        </div>
        {detailsOpen && (
          <div style={{ display: 'grid', gap: 'var(--th-space-8)', margin: 'var(--th-space-8) 0' }}>
            <label className="field-label">
              Client
              <input value={details.client ?? ''} onChange={(e) => setDetails({ ...details, client: e.target.value })} placeholder="Client or brand" />
            </label>
            <label className="field-label">
              Project date
              <input type="date" value={details.projectDate ?? ''} onChange={(e) => setDetails({ ...details, projectDate: e.target.value })} />
            </label>
            <label className="field-label">
              Services
              <input value={details.services ?? ''} onChange={(e) => setDetails({ ...details, services: e.target.value })} placeholder="Branding, web design, …" />
            </label>
            <label className="field-label">
              Outcome
              <input value={details.outcome ?? ''} onChange={(e) => setDetails({ ...details, outcome: e.target.value })} placeholder="One-line result" />
            </label>
            <div style={{ display: 'flex', gap: 'var(--th-space-8)' }}>
              <button type="button" className="th-btn th-btn-primary" onClick={() => void handleSaveDetails()} disabled={busy}>
                Save details
              </button>
              <button type="button" className="th-btn" onClick={() => setDetailsOpen(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="th-lp-card-actions">
          {item.status === 'published' && (
            <a className="th-lp-view-live" href={previewUrl} target="_blank" rel="noopener">
              View live
            </a>
          )}
          <a className="th-lp-edit" href={item.editUrl} target="_blank" rel="noopener">
            Edit
          </a>
        </div>
        {/* No image band in list view, so the kebab rides at the end of the
            row instead of floating over the thumbnail. */}
        {!showThumb && kebab}
      </div>
    </div>
  );
}
