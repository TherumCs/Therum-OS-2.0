'use client';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { BASE_PATH } from '../../../lib/session';
import { filename } from './mediaUtils';
import { MediaCard } from './MediaCard';
import { MediaTable, type MediaItem } from './MediaTable';

interface FilterPill {
  key: string;
  label: string;
  count: number;
}

type ViewMode = 'grid' | 'masonry' | 'metro' | 'table';

const VIEW_BUTTONS: { key: ViewMode; title: string; svg: ReactElement }[] = [
  {
    key: 'grid',
    title: 'Grid view',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    key: 'masonry',
    title: 'Masonry view',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  {
    key: 'metro',
    title: 'Metro tile view',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="11" height="11" />
        <rect x="16" y="3" width="5" height="5" />
        <rect x="16" y="10" width="5" height="11" />
        <rect x="3" y="16" width="11" height="5" />
      </svg>
    ),
  },
  {
    key: 'table',
    title: 'Table view',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
];

// Toolbar + density slider (3-7 cols) + grid/masonry/table view switch, all
// in one place since they share filter/search state and the density control
// visually disables itself outside grid view (see globals.css) — matches
// 1.9.44's Therum_List_Page toolbar + its media-specific density/view patch.
export function MediaLibrary({
  items,
  filters,
  initialViewMode,
  initialDensity,
}: {
  items: MediaItem[];
  filters: FilterPill[];
  initialViewMode: string;
  initialDensity: number;
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>((['grid', 'masonry', 'metro', 'table'] as string[]).includes(initialViewMode) ? (initialViewMode as ViewMode) : 'grid');
  const [density, setDensity] = useState(initialDensity >= 3 && initialDensity <= 7 ? initialDensity : 5);
  const densitySaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filtered = useMemo(() => {
    let out = items;
    if (activeFilter !== 'all') out = out.filter((i) => i.kind === activeFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((i) => filename(i.url).toLowerCase().includes(q) || (i.alt ?? '').toLowerCase().includes(q));
    }
    return out;
  }, [items, activeFilter, query]);

  function changeView(v: ViewMode) {
    setView(v);
    fetch(`${BASE_PATH}/api/me/media-view`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewMode: v }),
    }).catch(() => {});
  }

  function changeDensity(v: number) {
    setDensity(v);
    clearTimeout(densitySaveTimer.current);
    densitySaveTimer.current = setTimeout(() => {
      fetch(`${BASE_PATH}/api/me/media-view`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ density: v }),
      }).catch(() => {});
    }, 400);
  }

  return (
    <>
      <div className="th-lp-toolbar">
        <div className="th-lp-pills">
          {filters.map((f) => (
            <button key={f.key} type="button" className={'th-lp-pill' + (activeFilter === f.key ? ' active' : '')} onClick={() => setActiveFilter(f.key)}>
              {f.label}
              <span className="th-lp-pill-count">{f.count}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="th-lp-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input className="th-lp-search-input" placeholder="Search media…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="th-density-control" data-view={view}>
          <span className="th-density-label">Cols</span>
          <input type="range" min={3} max={7} value={density} className="th-density-slider" onChange={(e) => changeDensity(Number(e.target.value))} />
          <span className="th-density-value">{density}</span>
        </div>

        <div className="th-lp-views">
          {VIEW_BUTTONS.map((v) => (
            <button key={v.key} type="button" className={'th-lp-view-btn' + (view === v.key ? ' active' : '')} title={v.title} onClick={() => changeView(v.key)}>
              {v.svg}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No media yet</div>
          <div className="th-lp-empty-sub">Upload a file to get started.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No matches</div>
          <div className="th-lp-empty-sub">Adjust filters or clear the search.</div>
        </div>
      ) : (
        <>
          <div className={'th-lp-view th-lp-view-grid' + (view === 'grid' ? ' active' : '')} data-density={density}>
            {filtered.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
          <div className={'th-lp-view th-lp-view-masonry' + (view === 'masonry' ? ' active' : '')}>
            {filtered.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
          <div className={'th-lp-view th-lp-view-metro' + (view === 'metro' ? ' active' : '')}>
            {filtered.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
          <div className={'th-lp-view th-lp-view-table' + (view === 'table' ? ' active' : '')}>
            <MediaTable items={filtered} />
          </div>
        </>
      )}
    </>
  );
}
