'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { NavSection } from '../../lib/nav';
import { BASE_PATH } from '../../lib/session';
import { Icon } from './icons';

function isActive(pathname: string, href: string): boolean {
  const path = href.split('?')[0]!;
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/');
}

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function Sidebar({
  sections,
  siteName,
  siteHost,
  version,
  database,
}: {
  sections: NavSection[];
  siteName: string;
  siteHost: string;
  version: string;
  database: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NavSection[]>(sections);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const view = editing ? draft : sections;

  function startEditing(): void {
    setDraft(sections.map((s) => ({ ...s, items: [...s.items] })));
    setEditing(true);
  }
  function stopEditing(): void {
    setEditing(false);
    setRenamingId(null);
  }
  function toggleEditing(): void {
    if (editing) stopEditing();
    else startEditing();
  }

  function toggleCollapsed(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function moveSection(index: number, dir: -1 | 1): void {
    setDraft((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }
  function moveItem(sectionIndex: number, itemIndex: number, dir: -1 | 1): void {
    setDraft((prev) => {
      const sec = prev[sectionIndex]!;
      const j = itemIndex + dir;
      if (j < 0 || j >= sec.items.length) return prev;
      const items = [...sec.items];
      [items[itemIndex], items[j]] = [items[j]!, items[itemIndex]!];
      const next = [...prev];
      next[sectionIndex] = { ...sec, items };
      return next;
    });
  }
  function deleteSection(index: number): void {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }
  function addSection(): void {
    const label = window.prompt('Section name')?.trim();
    if (!label) return;
    const id = slugify(label) || `section-${draft.length}`;
    setDraft((prev) => [...prev, { id, label, items: [] }]);
  }
  function startRename(id: string, currentLabel: string): void {
    setRenamingId(id);
    setRenameValue(currentLabel);
  }
  function commitRename(): void {
    const id = renamingId;
    const label = renameValue.trim();
    if (id && label) setDraft((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
    setRenamingId(null);
  }

  async function handleReset(): Promise<void> {
    setBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/sidebar-layout/reset`, { method: 'POST' });
      stopEditing();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function handleSave(): Promise<void> {
    setBusy(true);
    try {
      const payload = {
        sections: draft.map((s) => ({ id: s.id, label: s.label })),
        items: Object.fromEntries(draft.map((s) => [s.id, s.items.map((it) => it.href)])),
      };
      await fetch(`${BASE_PATH}/api/sidebar-layout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      stopEditing();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="th-sb-header">
        <div className="th-logo">T</div>
        <div className="th-site-info">
          <div className="th-site-name">{siteName}</div>
          <div className="th-site-host">{siteHost}</div>
        </div>
      </div>

      <div className="th-sb-search">
        <div className="th-sb-search-box">
          <Icon.search width={14} height={14} />
          {/* Read-only on purpose: this box is the palette's entry point, not a
              second search implementation. It had no state or handler at all
              before — typing in it did nothing. */}
          <input
            type="text"
            placeholder="Search…"
            aria-label="Search admin"
            readOnly
            onFocus={(e) => { e.currentTarget.blur(); window.dispatchEvent(new Event('th:open-palette')); }}
            onClick={() => window.dispatchEvent(new Event('th:open-palette'))}
          />
          <span className="th-sb-search-kbd">⌘K</span>
        </div>
      </div>

      <nav className="th-sb-nav">
        <Link href="/" className={'th-sb-item' + (isActive(pathname, '/') ? ' active' : '')}>
          <Icon.dashboard />
          <span>Dashboard</span>
        </Link>

        {view.map((section, sIdx) => {
          const isCollapsed = collapsed.has(section.id);
          return (
            <div key={section.id} className="th-sb-section" data-section-id={section.id}>
              <div className="th-sb-section-label">
                {editing && (
                  <span className="th-sb-arrows">
                    <button type="button" className="th-sb-arrow" disabled={sIdx === 0} onClick={() => moveSection(sIdx, -1)} title="Move section up">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="th-sb-arrow"
                      disabled={sIdx === view.length - 1}
                      onClick={() => moveSection(sIdx, 1)}
                      title="Move section down"
                    >
                      ↓
                    </button>
                  </span>
                )}
                {renamingId === section.id ? (
                  <input
                    className="th-sb-section-rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="th-sb-section-toggle" onClick={() => toggleCollapsed(section.id)}>
                    <span className="th-sb-section-name">{section.label.toUpperCase()}</span>
                    <span className={'chev' + (isCollapsed ? ' collapsed' : '')}>
                      <Icon.chevron width={12} height={12} />
                    </span>
                  </span>
                )}
                {editing && (
                  <>
                    <button
                      type="button"
                      className="th-sb-section-rename"
                      title="Rename section"
                      aria-label="Rename section"
                      onClick={() => startRename(section.id, section.label)}
                    >
                      <Icon.edit2 width={13} height={13} />
                    </button>
                    <button
                      type="button"
                      className="th-sb-section-x"
                      title="Delete section"
                      aria-label="Delete section"
                      onClick={() => deleteSection(sIdx)}
                    >
                      <Icon.x width={13} height={13} />
                    </button>
                  </>
                )}
              </div>
              {!isCollapsed && (
                <div className="th-sb-section-items">
                  {section.items.map((item, iIdx) => {
                    const ItemIcon = Icon[item.icon];
                    return (
                      <div key={item.href} className="th-sb-itemwrap" data-item-id={item.href}>
                        {editing && (
                          <span className="th-sb-arrows">
                            <button
                              type="button"
                              className="th-sb-arrow"
                              disabled={iIdx === 0}
                              onClick={() => moveItem(sIdx, iIdx, -1)}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="th-sb-arrow"
                              disabled={iIdx === section.items.length - 1}
                              onClick={() => moveItem(sIdx, iIdx, 1)}
                              title="Move down"
                            >
                              ↓
                            </button>
                          </span>
                        )}
                        <Link href={item.href} className={'th-sb-item' + (isActive(pathname, item.href) ? ' active' : '')}>
                          <ItemIcon />
                          <span>{item.label}</span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {editing && (
          <button type="button" className="th-add-section" onClick={addSection}>
            <Icon.plus width={14} height={14} />
            <span>Add section</span>
          </button>
        )}
      </nav>

      <div className="th-sb-edit-toggle">
        <button type="button" id="th-edit-sb-btn" className="th-sb-edit-btn" onClick={toggleEditing} title="Edit sidebar">
          <Icon.edit2 width={13} height={13} />
          <span>{editing ? 'Editing…' : 'Edit sidebar'}</span>
        </button>
        {/* 2.0 has no public-frontend app yet (admin + builder only — see
            deploy/nginx.conf) — this points at the bare origin, matching
            home_url('/')'s "site root, not admin" semantics, and starts
            resolving the moment that app exists. Plain <a>, not next/link:
            basePath must NOT apply here, this is deliberately outside it. */}
        <a href="/" target="_blank" rel="noopener" className="th-sb-edit-btn th-sb-view-site" title="View frontend">
          <Icon.externalLink width={14} height={14} />
          <span>View frontend</span>
        </a>
      </div>
      {editing && (
        <div className="th-sb-edit-bar">
          <button type="button" className="th-sb-reset" onClick={() => void handleReset()} disabled={busy}>
            Reset
          </button>
          <button type="button" className="th-sb-done" onClick={() => void handleSave()} disabled={busy}>
            <Icon.check width={14} height={14} /> Save
          </button>
        </div>
      )}

      <div className="th-sb-footer">
        <span className="ok-dot" />
        <span>v{version}</span>
        <span className="spacer" />
        <span>{database}</span>
      </div>
    </>
  );
}
