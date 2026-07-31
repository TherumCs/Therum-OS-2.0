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

// The longest the old screen may stay frozen waiting for the new one. A view
// transition holds a snapshot of the page while its callback is pending, so
// this is a cap on perceived hang, not a style choice. Roughly one animation
// length: past that the transition is no longer covering a swap, it is just
// stopping the UI from responding.
const MAX_FREEZE_MS = 250;

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
          // WAIT FOR THE CONTENT TO ACTUALLY CHANGE, with a ceiling.
          //
          // This used to resolve after a single requestAnimationFrame, on the
          // theory that one frame was enough for React to commit. It is not:
          // router.push in the App Router kicks off a server round-trip, so a
          // frame later the DOM still holds the OLD page. The transition
          // therefore captured old -> old, animated nothing visible, and the
          // real content snapped in afterwards — while the browser held a
          // frozen snapshot for the whole animation. That is exactly the
          // "everything freezes" symptom.
          //
          // Resolving when #th-content actually mutates makes the animation
          // play on the real new screen. The timeout is the important half:
          // without it a slow route would hold the frozen snapshot for as
          // long as the fetch takes, turning a slow page into a hung one.
          // Past the cap we resolve anyway and let the rest stream in.
          return new Promise<void>((resolve) => {
            const target = document.getElementById('th-content');
            if (!target) { requestAnimationFrame(() => resolve()); return; }
            let done = false;
            const finish = (): void => {
              if (done) return;
              done = true;
              observer.disconnect();
              clearTimeout(timer);
              // One more frame so the mutation is painted, not just applied.
              requestAnimationFrame(() => resolve());
            };
            const observer = new MutationObserver(finish);
            observer.observe(target, { childList: true, subtree: true });
            const timer = setTimeout(finish, MAX_FREEZE_MS);
          });
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
