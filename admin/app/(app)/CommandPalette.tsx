'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';
import { SETTINGS_SECTIONS } from '../../lib/settingsSections';
import { APPEARANCE_SECTIONS } from '../../lib/appearanceSections';

// ⌘K command palette.
//
// The sidebar has advertised "⌘K" since the shell was built and nothing ever
// listened for it — the hint was decoration, and the search box next to it had
// no state or handler either. Appearance > Workspace > "Keyboard shortcuts"
// was equally hollow: it saved, and there was no handler for it to gate.
// This is the handler, and that setting now gates it for real.

interface Item {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: string;
}

const STATIC_ITEMS: Item[] = [
  { id: 'nav:dashboard', label: 'Dashboard', hint: '', href: '/', group: 'Go to' },
  { id: 'nav:pages', label: 'Pages', hint: '', href: '/pages', group: 'Go to' },
  { id: 'nav:posts', label: 'Posts', hint: '', href: '/posts', group: 'Go to' },
  { id: 'nav:media', label: 'Media', hint: '', href: '/media', group: 'Go to' },
  { id: 'nav:case-studies', label: 'Case Studies', hint: '', href: '/case-studies', group: 'Go to' },
  { id: 'nav:products', label: 'Products', hint: '', href: '/products', group: 'Go to' },
  { id: 'nav:orders', label: 'Orders', hint: '', href: '/orders', group: 'Go to' },
  { id: 'nav:users', label: 'Users', hint: '', href: '/users', group: 'Go to' },
  { id: 'nav:import', label: 'Import', hint: '', href: '/import', group: 'Go to' },
  { id: 'nav:bricks', label: 'Bricks Bridge', hint: '', href: '/bricks', group: 'Go to' },
  { id: 'nav:studio', label: 'From the Studio', hint: '', href: '/studio', group: 'Go to' },
  { id: 'nav:milieus', label: 'Milieus', hint: '', href: '/milieus', group: 'Go to' },
  { id: 'nav:clusters', label: 'Cluster', hint: '', href: '/clusters', group: 'Go to' },
  { id: 'nav:extensions', label: 'Plugins', hint: '', href: '/extensions', group: 'Go to' },
  { id: 'nav:account', label: 'Account', hint: '', href: '/account', group: 'Go to' },
  ...APPEARANCE_SECTIONS.map((s) => ({
    id: `ap:${s.id}`, label: `Appearance — ${s.label}`, hint: s.description, href: `/appearance/${s.id}`, group: 'Appearance',
  })),
  ...SETTINGS_SECTIONS.map((s) => ({
    id: `set:${s.id}`, label: `Settings — ${s.label}`, hint: s.description, href: `/settings/${s.id}`, group: 'Settings',
  })),
];

interface ContentHit {
  id: string;
  title: string;
  type: string;
  slug: string;
}

export function CommandPalette({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<ContentHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The sidebar's own search box opens this rather than duplicating it — see
  // Sidebar.tsx, which dispatches this event instead of holding its own state.
  useEffect(() => {
    const onOpen = (): void => setOpen(true);
    window.addEventListener('th:open-palette', onOpen);
    return () => window.removeEventListener('th:open-palette', onOpen);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setHits([]);
      // Focus after paint; the input does not exist until this renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Content search runs against the API so the palette finds real pages and
  // posts, not just the fixed nav. Debounced — one request per pause, not per
  // keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${BASE_PATH}/api/content?q=${encodeURIComponent(q)}&limit=6`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: ContentHit[] }) => setHits(d.items ?? []))
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const statics = q
      ? STATIC_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q))
      : STATIC_ITEMS.slice(0, 8);
    const content: Item[] = hits.map((h) => ({
      id: `c:${h.id}`,
      label: h.title,
      hint: `${h.type} · /${h.slug}`,
      href: h.type === 'post' ? '/posts' : h.type === 'case_study' ? '/case-studies' : '/pages',
      group: 'Content',
    }));
    return [...statics.slice(0, 12), ...content];
  }, [query, hits]);

  const go = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, active, go]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="th-cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" className="th-cmdk-scrim" aria-label="Close" onClick={() => setOpen(false)} />
      <div className="th-cmdk-panel">
        <input
          ref={inputRef}
          className="th-cmdk-input"
          placeholder="Search pages, settings, appearance…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        />
        <div className="th-cmdk-list">
          {results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="th-cmdk-group">{header}</div>}
                <button
                  type="button"
                  className={'th-cmdk-item' + (i === active ? ' active' : '')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                >
                  <span className="th-cmdk-label">{item.label}</span>
                  {item.hint && <span className="th-cmdk-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
          {results.length === 0 && <div className="th-cmdk-empty">No matches.</div>}
        </div>
        <div className="th-cmdk-foot">
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}
