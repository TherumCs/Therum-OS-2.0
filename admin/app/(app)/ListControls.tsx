'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';

// URL-driven list controls: filter pills, search, sort, and paging.
//
// These used to be client-side state filtering an already-fetched array, which
// broke in two ways once a list got real: the fetch was capped at 100 rows, so
// anything past that was invisible to filters AND to the eye, and there was no
// sorting at all. Everything here writes to the query string instead, the page
// re-fetches server-side, and the database does the work — so a filter counts
// every matching row, not just the ones that fit in the first page.

export interface FilterPill {
  key: string;
  label: string;
  count?: number;
}

export interface SortOption {
  key: string; // "field:order", e.g. "updatedAt:desc"
  label: string;
}

function useQueryWriter() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const write = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(params?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    // Any filter/search/sort change invalidates the cursor we were holding.
    if (!('cursor' in patch)) next.delete('cursor');
    startTransition(() => router.push(`?${next.toString()}`, { scroll: false }));
  };

  return { params, write, pending };
}

export function ListControls({
  filters,
  filterParam = 'status',
  sorts,
  searchPlaceholder,
  trailing,
}: {
  filters: FilterPill[];
  filterParam?: string;
  sorts: SortOption[];
  searchPlaceholder: string;
  /** Extra controls for the same toolbar row (media's density + view switch). */
  trailing?: ReactNode;
}) {
  const { params, write, pending } = useQueryWriter();
  const activeFilter = params?.get(filterParam) ?? 'all';
  const activeSort = `${params?.get('sort') ?? sorts[0]?.key.split(':')[0] ?? ''}:${params?.get('order') ?? sorts[0]?.key.split(':')[1] ?? 'desc'}`;

  // Local mirror so typing stays responsive; the URL catches up on a debounce.
  const urlQuery = params?.get('q') ?? '';
  const [text, setText] = useState(urlQuery);
  useEffect(() => setText(urlQuery), [urlQuery]);
  useEffect(() => {
    if (text === urlQuery) return;
    const t = setTimeout(() => write({ q: text || null }), 300);
    return () => clearTimeout(t);
    // `write` is recreated each render; depending on it would re-arm the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, urlQuery]);

  return (
    <div className="th-lp-toolbar" data-pending={pending ? '1' : undefined}>
      {filters.length > 0 && (
        <div className="th-lp-pills">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={'th-lp-pill' + (activeFilter === f.key ? ' active' : '')}
              onClick={() => write({ [filterParam]: f.key === 'all' ? null : f.key })}
            >
              {f.label}
              {typeof f.count === 'number' && <span className="th-lp-pill-count">{f.count}</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {sorts.length > 0 && (
        <label className="th-lp-sort">
          <span className="th-lp-sort-label">Sort</span>
          <select
            className="th-lp-sort-select"
            value={activeSort}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(':');
              write({ sort: sort ?? null, order: order ?? null });
            }}
          >
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
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {text && (
          <button type="button" className="th-lp-search-clear" aria-label="Clear search" onClick={() => setText('')}>
            ×
          </button>
        )}
      </div>

      {trailing}
    </div>
  );
}

// Cursor paging. Cursors only move forward, so "Back" walks a trail kept in
// the URL rather than trying to invert the cursor.
export function ListPager({
  nextCursor,
  shown,
  total,
}: {
  nextCursor: string | null;
  shown: number;
  total: number;
}) {
  const { params, write } = useQueryWriter();
  const trail = (params?.get('trail') ?? '').split(',').filter(Boolean);
  const hasPrev = trail.length > 0;

  if (!nextCursor && !hasPrev) {
    return total > 0 ? <div className="th-lp-pager-note">{total} total</div> : null;
  }

  const goNext = (): void => {
    const cursor = params?.get('cursor');
    write({ cursor: nextCursor, trail: [...trail, cursor ?? ''].join(',') });
  };
  const goPrev = (): void => {
    const prev = trail[trail.length - 1] ?? '';
    write({ cursor: prev || null, trail: trail.slice(0, -1).join(',') || null });
  };

  return (
    <div className="th-lp-pager">
      <button type="button" className="th-btn" onClick={goPrev} disabled={!hasPrev}>
        ← Previous
      </button>
      <span className="th-lp-pager-note">
        {shown} of {total}
      </span>
      <button type="button" className="th-btn" onClick={goNext} disabled={!nextCursor}>
        Next →
      </button>
    </div>
  );
}
