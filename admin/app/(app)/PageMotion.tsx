'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Seamless navigation, second attempt — and the first one was wrong in a way
// worth writing down.
//
// This used to wrap navigation in the View Transition API. That API holds a
// SNAPSHOT of the page while its callback promise is pending, which is exactly
// right for a synchronous DOM swap and exactly wrong here: router.push starts a
// server round-trip, measured at ~450ms on this admin. So every click froze the
// old screen for the length of the fetch, then snapped. Capping the wait only
// shortened the freeze — it could not remove it, because blocking IS the
// mechanism that API uses.
//
// The fix is to stop covering the wait at all. The click navigates immediately,
// and the new content animates IN when it arrives. Nothing is ever held, so
// nothing can appear frozen; a slow route now reads as "loading briefly" rather
// than "the UI stopped responding".
//
// Retriggering is done by removing the class, forcing a reflow, and re-adding
// it. Keying <main> by pathname would remount the whole page subtree on every
// navigation, which is a heavy way to restart one animation.

export function PageMotion() {
  // Pathname only, deliberately. useSearchParams would force a Suspense
  // boundary around the whole layout, and a filter or sort change is not a
  // page change — animating those would make every list control feel laggy.
  const pathname = usePathname();
  // Skip the very first run: the page has just loaded and is already visible,
  // so animating it in would fade the screen the user is looking at.
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = document.getElementById('th-content');
    if (!el) return;

    const shell = document.getElementById('th-shell');
    if (shell?.getAttribute('data-motion') === 'off') return;
    if (!shell?.getAttribute('data-page-transition')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    el.classList.remove('th-page-enter');
    // Reading offsetWidth forces a synchronous reflow, which is what makes the
    // browser treat the re-added class as a new animation instead of a no-op.
    void el.offsetWidth;
    el.classList.add('th-page-enter');
  }, [pathname]);

  return null;
}
