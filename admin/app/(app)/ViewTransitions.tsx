'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';

// Seamless navigation.
//
// The admin already navigates client-side, so nothing actually reloads — but
// it LOOKED like it did, because the old screen vanished and the new one
// appeared with no relationship between them. That instant swap is what reads
// as a page load.
//
// This wraps navigation in the browser's View Transition API: the old and new
// screens are captured and animated between, so one becomes the other. The
// style is chosen in Appearance and applied by CSS (see the view-transition
// block in globals.css) — this file only decides WHEN a transition happens,
// never what it looks like.
//
// Why not GSAP: this is the same class of motion, done by the compositor
// rather than JavaScript, so it stays smooth under load and costs no bundle.
// GSAP earns its place for timeline choreography; a screen becoming another
// screen is exactly what view transitions are for.

// lib.dom already declares startViewTransition, so this only asks whether the
// running browser HAS it — redeclaring the shape conflicts with the built-in.
type StartViewTransition = (cb: () => void | Promise<void>) => unknown;

export function ViewTransitions() {
  const router = useRouter();

  useEffect(() => {
    // No support (Firefox at time of writing) means ordinary navigation, not a
    // broken one — every branch below falls through to the browser default.
    const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
    if (typeof start !== 'function') return;

    const onClick = (e: MouseEvent): void => {
      // Let the browser handle anything that is not a plain left click on a
      // same-tab, same-origin link: modified clicks open tabs, and hijacking
      // those is the fastest way to make navigation feel broken rather than
      // smooth.
      //
      // NOTE there is no defaultPrevented check. This runs in the CAPTURE
      // phase, before next/link's own handler, precisely because that handler
      // calls preventDefault — a bubble-phase listener that skips prevented
      // events therefore never fired on a single admin link.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;

      const shell = document.getElementById('th-shell');
      const style = shell?.getAttribute('data-page-transition');
      // Motion off, or transitions off, means the browser's own navigation.
      if (!style || shell?.getAttribute('data-motion') === 'off') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      // NO stopPropagation. Blocking next/link's own handler means that if
      // anything below fails, the click does nothing at all — a dead admin in
      // exchange for an animation. preventDefault alone is enough to stop the
      // browser's native navigation; letting the event continue is harmless
      // because the route change below is the same one Link would perform.
      e.preventDefault();

      // STRIP THE BASE PATH. router.push prepends it itself, so passing the
      // browser's pathname — which already contains it — produced
      // /tos-admin/tos-admin/orders, a 404, and a full page reload. The
      // transition was the least of it: every link in the admin was doing a
      // hard navigation.
      const internal = url.pathname.startsWith(BASE_PATH)
        ? url.pathname.slice(BASE_PATH.length) || '/'
        : url.pathname;
      const go = (): void => { router.push(internal + url.search); };
      try {
        start.call(document, () => {
          go();
          // Resolving on the next frame lets React commit before the captured
          // "new" state is taken; without it the transition snapshots the old
          // screen twice and nothing appears to move.
          return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
      } catch {
        // Transition unavailable or refused — navigate anyway. Motion is the
        // optional part; getting to the page is not.
        go();
      }
    };

    // Capture phase: see the note in onClick.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return null;
}
