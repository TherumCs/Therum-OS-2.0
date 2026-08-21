'use client';
import { useRef, useState, type ReactElement } from 'react';
import { ListControls, ListPager, type SortOption } from '../ListControls';
import { MediaLightbox } from './MediaLightbox';
import { BASE_PATH } from '../../../lib/session';
import { filename } from './mediaUtils';
import { MediaCard } from './MediaCard';
import { MediaTable, type MediaItem } from './MediaTable';

interface FilterPill {
  key: string;
  label: string;
  count: number;
}

type ViewMode = 'grid' | 'masonry' | 'table';

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
// visually disables itself only in table view (see globals.css) — matches
// 1.9.44's Therum_List_Page toolbar + its media-specific density/view patch.
const MEDIA_SORTS: SortOption[] = [
  { key: 'createdAt:desc', label: 'Newest' },
  { key: 'createdAt:asc', label: 'Oldest' },
  { key: 'url:asc', label: 'Filename A–Z' },
  { key: 'url:desc', label: 'Filename Z–A' },
  { key: 'size:desc', label: 'Largest' },
  { key: 'size:asc', label: 'Smallest' },
  { key: 'kind:asc', label: 'Type' },
];

export function MediaLibrary({
  items,
  filters,
  filtering = false,
  nextCursor = null,
  total = 0,
  initialViewMode,
  initialDensity,
}: {
  items: MediaItem[];
  filters: FilterPill[];
  /** True when a kind filter or search is active — picks the right empty copy. */
  filtering?: boolean;
  nextCursor?: string | null;
  total?: number;
  initialViewMode: string;
  initialDensity: number;
}) {
  const [view, setView] = useState<ViewMode>((['grid', 'masonry', 'table'] as string[]).includes(initialViewMode) ? (initialViewMode as ViewMode) : 'grid');
  // Which asset the lightbox is showing (null = closed). Lives here, not
  // in each card, so arrow-key navigation can walk the whole loaded page.
  const [openId, setOpenId] = useState<string | null>(null);
  const [density, setDensity] = useState(initialDensity >= 3 && initialDensity <= 7 ? initialDensity : 5);
  const densitySaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);


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
      <ListControls
        filters={filters}
        filterParam="kind"
        sorts={MEDIA_SORTS}
        searchPlaceholder="Search media…"
        trailing={
          <>
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
          </>
        }
      />

      {items.length === 0 ? (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">{filtering ? 'No matches' : 'No media yet'}</div>
          <div className="th-lp-empty-sub">{filtering ? 'Adjust filters or clear the search.' : 'Upload a file to get started.'}</div>
        </div>
      ) : (
        <>
          <div className={'th-lp-view th-lp-view-grid' + (view === 'grid' ? ' active' : '')} data-density={density}>
            {items.map((item) => (
              <MediaCard key={item.id} item={item} onOpen={setOpenId} />
            ))}
          </div>
          <div className={'th-lp-view th-lp-view-masonry' + (view === 'masonry' ? ' active' : '')} data-density={density}>
            {items.map((item) => (
              <MediaCard key={item.id} item={item} onOpen={setOpenId} />
            ))}
          </div>
          <div className={'th-lp-view th-lp-view-table' + (view === 'table' ? ' active' : '')}>
            <MediaTable items={items} />
          </div>
        </>
      )}

      <ListPager nextCursor={nextCursor} shown={items.length} total={total} />

      <MediaLightbox items={items} openId={openId} onClose={() => setOpenId(null)} onNavigate={setOpenId} />
    </>
  );
}
