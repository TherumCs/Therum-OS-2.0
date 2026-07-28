'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APPEARANCE_SECTIONS } from '../../../lib/appearanceSections';
import { Icon } from '../icons';

// Deliberately the same markup and class names as SettingsSectionNav — the
// two surfaces should be indistinguishable apart from what is in the rail.
export function AppearanceSectionNav() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sections = q
    ? APPEARANCE_SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    : APPEARANCE_SECTIONS;

  return (
    <div>
      <div className="settings-search">
        <Icon.search width={13} height={13} />
        <input
          type="text"
          placeholder="Search appearance…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search appearance"
        />
      </div>
      <nav className="settings-rail">
        {sections.map((s) => {
          const href = `/appearance/${s.id}`;
          const active = pathname === href;
          const ItemIcon = Icon[s.icon];
          return (
            <Link key={s.id} href={href} className={'settings-rail-item' + (active ? ' active' : '')}>
              <ItemIcon width={15} height={15} />
              <span className="settings-rail-text">
                <span className="settings-rail-label">{s.label}</span>
                <span className="settings-rail-desc">{s.description}</span>
              </span>
            </Link>
          );
        })}
        {sections.length === 0 && <div className="settings-rail-empty">No sections match &ldquo;{query}&rdquo;.</div>}
      </nav>
    </div>
  );
}
