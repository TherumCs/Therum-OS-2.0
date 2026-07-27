'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';
import { filename } from './mediaUtils';
import type { MediaItem } from './MediaTable';

// Rename / regenerate-thumbnail / delete, plus the kebab-menu open state —
// identical between MediaCard (grid/masonry) and MediaRow (table), so it
// lives here once instead of twice.
export function useMediaActions(item: MediaItem) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  async function handleRename() {
    setMenuOpen(false);
    const current = filename(item.url).replace(/\.[^.]+$/, '');
    const input = window.prompt('Rename file to:', current);
    if (!input || !input.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/${item.id}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ basename: input.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't rename: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateThumbnail() {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/${item.id}/regenerate-thumbnail`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't regenerate thumbnail: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${item.alt || filename(item.url)}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/media/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      window.alert(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return { menuOpen, setMenuOpen, busy, menuRef, handleRename, handleRegenerateThumbnail, handleDelete };
}
