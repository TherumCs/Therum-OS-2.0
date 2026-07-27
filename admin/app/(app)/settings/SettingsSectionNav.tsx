'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_SECTIONS } from '../../../lib/settingsSections';
import { Icon } from '../icons';

export function SettingsSectionNav() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sections = q ? SETTINGS_SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : SETTINGS_SECTIONS;

  return (
    <div>
      <div className="settings-search">
        <Icon.search width={13} height={13} />
        <input
          type="text"
          placeholder="Search settings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search settings"
        />
      </div>
      <nav className="settings-rail">
        {sections.map((s) => {
          const href = `/settings/${s.id}`;
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
        {sections.length === 0 && <div className="settings-rail-empty">No settings match &ldquo;{query}&rdquo;.</div>}
      </nav>
    </div>
  );
}
