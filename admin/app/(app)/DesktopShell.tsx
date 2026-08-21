'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NavSection } from '../../lib/nav';
import { BASE_PATH } from '../../lib/session';
import { Icon } from './icons';
import { QuickControlsPanel } from './QuickControlsPanel';
import type { Appearance, Behavior } from '../../lib/appearance';

interface DockItem {
  href: string;
  label: string;
  icon: keyof typeof Icon;
}

interface WinState {
  id: string;
  href: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
}

let nextZ = 10;
let winCounter = 0;

// Built natively — 1.9.44's Desktop Mode depends on a third-party WordPress
// plugin (desktop-mode/desktop-mode.php); this is the actual feature
// (draggable/resizable windows + a left-edge dock, chrome yielding while
// active) with nothing WordPress-specific left to bridge. Each window loads
// its target page through the normal Next.js route (?embed=1 tells
// AppLayout to skip the sidebar/topbar so the window is the only frame).
export function DesktopShell({
  sections,
  username,
  version,
  appearance,
  behavior,
}: {
  sections: NavSection[];
  username: string;
  version: string;
  appearance: Appearance;
  behavior: Behavior;
}) {
  const router = useRouter();
  const [windows, setWindows] = useState<WinState[]>([]);
  const dragRef = useRef<{ id: string; startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);

  const dockItems: DockItem[] = [
    { href: '/', label: 'Dashboard', icon: 'dashboard' },
    ...sections.flatMap((s) => s.items.map((it) => ({ href: it.href, label: it.label, icon: it.icon }))),
  ];

  function openWindow(item: DockItem): void {
    setWindows((prev) => {
      const existing = prev.find((w) => w.href === item.href);
      if (existing) {
        return prev.map((w) => (w.id === existing.id ? { ...w, minimized: false, z: nextZ++ } : w));
      }
      winCounter += 1;
      const offset = (winCounter % 8) * 24;
      const win: WinState = {
        id: `w${winCounter}`,
        href: item.href,
        title: item.label,
        x: 80 + offset,
        y: 60 + offset,
        width: 900,
        height: 600,
        z: nextZ++,
        minimized: false,
      };
      return [...prev, win];
    });
  }

  function closeWindow(id: string): void {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }
  function minimizeWindow(id: string): void {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  }
  function focusWindow(id: string): void {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, z: nextZ++ } : w)));
  }

  function startDrag(e: React.MouseEvent, win: WinState): void {
    focusWindow(win.id);
    dragRef.current = { id: win.id, startX: e.clientX, startY: e.clientY, winX: win.x, winY: win.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }
  function onDrag(e: MouseEvent): void {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setWindows((prev) => prev.map((w) => (w.id === d.id ? { ...w, x: Math.max(0, d.winX + dx), y: Math.max(0, d.winY + dy) } : w)));
  }
  function stopDrag(): void {
    dragRef.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  function startResize(e: React.MouseEvent, win: WinState): void {
    e.stopPropagation();
    focusWindow(win.id);
    resizeRef.current = { id: win.id, startX: e.clientX, startY: e.clientY, startW: win.width, startH: win.height };
    window.addEventListener('mousemove', onResize);
    window.addEventListener('mouseup', stopResize);
  }
  function onResize(e: MouseEvent): void {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    setWindows((prev) =>
      prev.map((w) => (w.id === r.id ? { ...w, width: Math.max(360, r.startW + dx), height: Math.max(240, r.startH + dy) } : w)),
    );
  }
  function stopResize(): void {
    resizeRef.current = null;
    window.removeEventListener('mousemove', onResize);
    window.removeEventListener('mouseup', stopResize);
  }

  async function exitDesktopMode(): Promise<void> {
    await fetch(`${BASE_PATH}/api/desktop-mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    router.refresh();
  }

  return (
    <div id="th-desktop">
      <div className="th-desktop-canvas">
        {windows.map((win) => {
          if (win.minimized) return null;
          return (
            <div
              key={win.id}
              className="th-window"
              style={{ left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.z }}
              onMouseDown={() => focusWindow(win.id)}
            >
              <div className="th-window-titlebar" onMouseDown={(e) => startDrag(e, win)}>
                <span className="th-window-title">{win.title}</span>
                <div className="th-window-controls">
                  <button type="button" onClick={() => minimizeWindow(win.id)} title="Minimize" aria-label="Minimize">
                    –
                  </button>
                  <button type="button" onClick={() => closeWindow(win.id)} title="Close" aria-label="Close">
                    <Icon.x width={11} height={11} />
                  </button>
                </div>
              </div>
              <iframe className="th-window-frame" src={`${BASE_PATH}${win.href}${win.href.includes('?') ? '&' : '?'}embed=1`} title={win.title} />
              <div className="th-window-resize" onMouseDown={(e) => startResize(e, win)} />
            </div>
          );
        })}
      </div>

      <div className="th-dock">
        <div className="th-dock-items">
          {dockItems.map((item) => {
            const ItemIcon = Icon[item.icon];
            const openWin = windows.find((w) => w.href === item.href);
            return (
              <button
                key={item.href}
                type="button"
                className={'th-dock-icon' + (openWin && !openWin.minimized ? ' active' : '')}
                onClick={() => openWindow(item)}
                title={item.label}
              >
                <ItemIcon width={20} height={20} />
                {openWin && <span className="th-dock-dot" />}
              </button>
            );
          })}
        </div>
        <div className="th-dock-footer">
          <QuickControlsPanel appearance={appearance} behavior={behavior} triggerClassName="th-dock-icon" iconSize={18} />
          <button type="button" className="th-dock-icon" onClick={() => void exitDesktopMode()} title="Exit Desktop Mode">
            <Icon.logout width={18} height={18} />
          </button>
          <span className="th-dock-user" title={username}>
            {(username[0] ?? 'T').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="th-desktop-version">Therum CMS v{version} — Desktop Mode</div>
    </div>
  );
}
