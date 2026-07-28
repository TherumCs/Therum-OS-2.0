'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type ReactElement } from 'react';
import { DEFAULT_LIST_VIEW, type ListView } from './listViews';

// The four list layouts 1.9.44 exposes (Therum_List_Page's view toggles plus
// Therum_Card_Style::layout()), ported here. Media already had its own switch;
// content lists had none, so Pages/Posts/Case studies could only ever render
// one card shape.
//
// The choice lives in the URL like every other list control (filter, sort,
// search, cursor) rather than in user meta: it stays shareable, survives a
// refresh, and needs no schema change to store a per-user preference.

const LIST_VIEWS: { key: ListView; label: string; icon: ReactElement }[] = [
  {
    key: 'card',
    label: 'Card view',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="14" x2="21" y2="14" />
      </svg>
    ),
  },
  {
    key: 'hero',
    label: 'Hero view',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="11" rx="2" />
        <line x1="3" y1="18" x2="15" y2="18" />
        <line x1="3" y1="21" x2="11" y2="21" />
      </svg>
    ),
  },
  {
    key: 'list',
    label: 'List view',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    key: 'grid',
    label: 'Grid view',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
];

export function ListViewSwitch({ view }: { view: ListView }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pick = (next: ListView): void => {
    const q = new URLSearchParams(params?.toString() ?? '');
    if (next === DEFAULT_LIST_VIEW) q.delete('view');
    else q.set('view', next);
    startTransition(() => router.push(`?${q.toString()}`, { scroll: false }));
  };

  return (
    <div className="th-lp-views" data-pending={pending ? '1' : undefined}>
      {LIST_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          className={'th-lp-view-btn' + (view === v.key ? ' active' : '')}
          title={v.label}
          aria-label={v.label}
          aria-pressed={view === v.key}
          onClick={() => pick(v.key)}
        >
          {v.icon}
        </button>
      ))}
    </div>
  );
}
