'use client';
import { useMemo, useState, type ReactNode } from 'react';
import type { SortOption } from './ListControls';

// Search + sort for the small, unpaged collections (admin users, clusters,
// milieus). Their APIs return the COMPLETE set in one array — there is no
// cursor and no row cap — so filtering here sees every row and can't lie the
// way the old capped content lists did. The paged lists (content, media,
// products, orders) use ListControls and let the database do this instead.

export interface ClientColumn<T> {
  key: string;
  label: string;
  /** Value used for sorting and searching. */
  value: (row: T) => string | number;
  /** Cell contents; defaults to the raw value. */
  render?: (row: T) => ReactNode;
  className?: string;
}

export function ClientTable<T extends { id: string }>({
  rows,
  columns,
  sorts,
  searchPlaceholder,
  emptyLabel = 'Nothing here yet.',
}: {
  rows: T[];
  columns: ClientColumn<T>[];
  sorts: SortOption[];
  searchPlaceholder: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(sorts[0]?.key ?? '');

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter((r) => columns.some((c) => String(c.value(r)).toLowerCase().includes(q)));
    }
    const [field, dir] = sortKey.split(':');
    const col = columns.find((c) => c.key === field);
    if (col) {
      const sign = dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
        return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * sign;
      });
    }
    return out;
  }, [rows, columns, query, sortKey]);

  return (
    <>
      <div className="th-lp-toolbar">
        <div className="th-lp-pills">
          <span className="th-lp-pager-note">
            {view.length === rows.length ? `${rows.length} total` : `${view.length} of ${rows.length}`}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {sorts.length > 0 && (
          <label className="th-lp-sort">
            <span className="th-lp-sort-label">Sort</span>
            <select className="th-lp-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="th-lp-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="th-lp-search-input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="th-lp-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render ? c.render(row) : c.value(row)}
                </td>
              ))}
            </tr>
          ))}
          {view.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="muted">
                {query ? 'No matches — adjust or clear the search.' : emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

// Presentational search + sort bar for lists that already own their own row
// rendering and interactions (Cluster, Milieus). Same markup as the tables
// above so every list in the admin reads identically.
export function LocalFilterBar({
  query,
  onQuery,
  sortKey,
  onSort,
  sorts,
  searchPlaceholder,
  shown,
  total,
}: {
  query: string;
  onQuery: (v: string) => void;
  sortKey: string;
  onSort: (v: string) => void;
  sorts: SortOption[];
  searchPlaceholder: string;
  shown: number;
  total: number;
}) {
  return (
    <div className="th-lp-toolbar" style={{ marginTop: 'var(--th-space-12)' }}>
      <span className="th-lp-pager-note">{shown === total ? `${total} total` : `${shown} of ${total}`}</span>
      <div style={{ flex: 1 }} />
      {sorts.length > 0 && (
        <label className="th-lp-sort">
          <span className="th-lp-sort-label">Sort</span>
          <select className="th-lp-sort-select" value={sortKey} onChange={(e) => onSort(e.target.value)}>
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="th-lp-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input className="th-lp-search-input" placeholder={searchPlaceholder} value={query} onChange={(e) => onQuery(e.target.value)} />
        {query && (
          <button type="button" className="th-lp-search-clear" aria-label="Clear search" onClick={() => onQuery('')}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Sort a fully-loaded array by "field:dir", using a per-field accessor. */
export function sortRows<T>(rows: T[], sortKey: string, accessors: Record<string, (r: T) => string | number>): T[] {
  const [field, dir] = sortKey.split(':');
  const get = field ? accessors[field] : undefined;
  if (!get) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * sign;
  });
}
