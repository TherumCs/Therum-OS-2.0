'use client';
import { useMemo, useState } from 'react';
import { ContentCard, type ContentCardItem } from './ContentCard';

export interface FilterPill {
  key: string;
  label: string;
  count: number;
}

// Client-side filter/search over an already-fetched item list — mirrors
// 1.9.44's list-page toolbar (therum-list-page.php's .th-lp-pills/.th-lp-search),
// which also filters client-side rather than round-tripping to the server.
export function ListPageToolbar({
  items,
  filters,
  searchPlaceholder,
  emptyTitle = 'Nothing here yet',
  emptySub = '',
}: {
  items: ContentCardItem[];
  filters: FilterPill[];
  searchPlaceholder: string;
  emptyTitle?: string;
  emptySub?: string;
}) {
  const [activeFilter, setActiveFilter] = useState(filters[0]?.key ?? 'all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let out = items;
    if (activeFilter !== 'all') out = out.filter((i) => i.status === activeFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((i) => i.title.toLowerCase().includes(q));
    }
    return out;
  }, [items, activeFilter, query]);

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
          <input className="th-lp-search-input" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {filtered.length ? (
        <div className="th-lp-view-grid">
          {filtered.map((item) => (
            <ContentCard key={item.id} item={item} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">{emptyTitle}</div>
          {emptySub && <div className="th-lp-empty-sub">{emptySub}</div>}
        </div>
      ) : (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No matches</div>
          <div className="th-lp-empty-sub">Adjust filters or clear the search.</div>
        </div>
      )}
    </>
  );
}
