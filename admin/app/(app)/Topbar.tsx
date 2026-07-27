'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { NavSection } from '../../lib/nav';
import { BASE_PATH } from '../../lib/session';
import { Icon } from './icons';
import { QuickControlsPanel } from './QuickControlsPanel';
import type { Appearance, Behavior } from '../../lib/appearance';

function pageTitle(pathname: string, sections: NavSection[]): string {
  if (pathname === '/') return 'Dashboard';
  for (const section of sections) {
    for (const item of section.items) {
      if (pathname.startsWith(item.href.split('?')[0]!)) return item.label;
    }
  }
  return 'Therum Admin';
}

export function Topbar({
  sections,
  colorMode,
  username,
  desktopModeEnabled,
  appearance,
  behavior,
}: {
  sections: NavSection[];
  colorMode: 'light' | 'dark' | 'system';
  username: string;
  desktopModeEnabled: boolean;
  appearance: Appearance;
  behavior: Behavior;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleColorMode(): Promise<void> {
    setBusy(true);
    try {
      const next = colorMode === 'dark' ? 'light' : 'dark';
      await fetch(`${BASE_PATH}/api/settings/color-mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ colorMode: next }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Built natively — 1.9.44's version depends on a third-party plugin
  // (Automattic's desktop-mode/desktop-mode.php); this toggles the real,
  // native windowing shell (see DesktopShell.tsx), no plugin involved.
  async function toggleDesktopMode(): Promise<void> {
    setBusy(true);
    try {
      await fetch(`${BASE_PATH}/api/desktop-mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !desktopModeEnabled }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await fetch(`${BASE_PATH}/api/auth/logout`, { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header id="th-top">
      <div className="th-top-title">{pageTitle(pathname, sections)}</div>
      <div className="th-top-actions">
        <QuickControlsPanel appearance={appearance} behavior={behavior} />
        <button className="th-top-btn" type="button" onClick={() => void toggleColorMode()} disabled={busy} title="Toggle light/dark">
          <Icon.sun width={16} height={16} />
        </button>
        <button
          className={'th-top-btn' + (desktopModeEnabled ? ' is-active' : '')}
          type="button"
          onClick={() => void toggleDesktopMode()}
          disabled={busy}
          title="Desktop Mode"
          aria-label="Toggle Desktop Mode"
        >
          <Icon.monitor width={16} height={16} />
        </button>
        <a className="th-top-btn" href="/" target="_blank" rel="noopener" title="View site">
          <Icon.externalLink width={14} height={14} />
        </a>
        <div style={{ position: 'relative' }}>
          <button className="th-top-avatar" type="button" onClick={() => setMenuOpen((v) => !v)}>
            {(username[0] ?? 'T').toUpperCase()}
          </button>
          {menuOpen && (
            <div className="th-top-menu" onMouseLeave={() => setMenuOpen(false)}>
              <a href={`${BASE_PATH}/account`}>
                <Icon.account width={14} height={14} /> Account
              </a>
              <button type="button" onClick={() => void handleLogout()}>
                <Icon.logout width={14} height={14} /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
