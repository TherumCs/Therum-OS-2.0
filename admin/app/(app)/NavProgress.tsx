'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Feedback on the CLICK. PageMotion animates the new screen in when it
// arrives; this covers the gap before that, which is where "it feels frozen"
// actually came from.
//
// Measured on this admin: a warm navigation takes 740-1000ms, and there is no
// loading.tsx anywhere, so for that whole second the old page sits there
// unchanged with no acknowledgement that anything was clicked. Removing the
// View Transition stopped the browser holding a frozen snapshot, but it could
// not fix this — nothing was responding to the click in the first place.
//
// Two things happen immediately, both purely visual:
//   1. a slim progress bar starts at the top of the shell
//   2. the clicked sidebar item takes the active style right away
//
// The second matters more than it looks. Active state is derived from
// usePathname, which only updates once the navigation COMMITS — so the sidebar
// highlight lagged a full second behind the click. React overwrites this
// optimistic class on the next render, which is exactly what should happen: if
// the navigation fails, the highlight corrects itself.

export function NavProgress() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clearTimers = (): void => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    const bar = document.createElement('div');
    bar.className = 'th-navbar';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    barRef.current = bar;

    const start = (): void => {
      clearTimers();
      bar.classList.remove('is-done');
      bar.classList.add('is-loading');
      // Creeps toward 80% and waits there. Never reaching the end on its own is
      // deliberate: the bar must not claim the page is ready before it is.
      bar.style.transform = 'scaleX(0)';
      void bar.offsetWidth;
      bar.style.transform = 'scaleX(0.8)';
    };

    const onClick = (e: MouseEvent): void => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      // Same page — no navigation is coming, so a progress bar would just
      // flash for nothing.
      if (url.pathname === location.pathname) return;

      start();

      // Optimistic active state on the rail.
      const item = anchor.closest('.th-sb-item');
      if (item) {
        document.querySelectorAll('.th-sb-item.is-pending').forEach((el) => el.classList.remove('is-pending'));
        item.classList.add('is-pending');
      }
    };

    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimers();
      bar.remove();
      barRef.current = null;
    };
  }, []);

  // Navigation committed: run the bar out and clear the optimistic highlight.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !bar.classList.contains('is-loading')) return;
    bar.style.transform = 'scaleX(1)';
    bar.classList.add('is-done');
    const t = window.setTimeout(() => {
      bar.classList.remove('is-loading', 'is-done');
      bar.style.transform = 'scaleX(0)';
    }, 240);
    timers.current.push(t);
    document.querySelectorAll('.th-sb-item.is-pending').forEach((el) => el.classList.remove('is-pending'));
  }, [pathname]);

  return null;
}
