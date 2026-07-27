'use client';

import { useRef } from 'react';

// Corner-drag resize for dashboard bento cards, replacing the old xs/sm/md/lg
// chip row. Dragging previews the card live at the nearest size tier; release
// persists via the same /api/dashboard-layout/resize Route Handler the chips
// used — tiers still exist under the hood (the grid is 12 columns; snapping
// keeps layouts sane), only the control surface changed.
const SPANS = [
  { size: 'xs', span: 3 },
  { size: 'sm', span: 6 },
  { size: 'md', span: 9 },
  { size: 'lg', span: 12 },
] as const;

export function CardResizeHandle({ basePath, cardId, layoutJson, current }: { basePath: string; cardId: string; layoutJson: string; current: string }) {
  const ref = useRef<HTMLButtonElement | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const handle = ref.current;
    const card = handle?.closest<HTMLElement>('.dash-card');
    const grid = card?.parentElement;
    if (!handle || !card || !grid) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);

    const colWidth = grid.getBoundingClientRect().width / 12;
    const startWidth = card.getBoundingClientRect().width;
    const startX = e.clientX;
    let preview = current;

    const nearest = (px: number) => {
      const cols = px / colWidth;
      let best: (typeof SPANS)[number] = SPANS[0];
      for (const s of SPANS) {
        if (Math.abs(s.span - cols) < Math.abs(best.span - cols)) best = s;
      }
      return best;
    };

    const onMove = (ev: PointerEvent) => {
      const t = nearest(startWidth + (ev.clientX - startX));
      if (t.size !== preview) {
        preview = t.size;
        card.style.gridColumn = `span ${t.span}`;
        card.setAttribute('data-size', t.size);
      }
    };

    const cleanup = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    };

    // pointercancel (touch hijacked by scroll, prompt mid-drag, rotation)
    // must tear down like pointerup — otherwise onMove stays attached and
    // plain hover keeps resizing with stale math (audit finding #4). Revert
    // the preview since nothing was saved.
    const onCancel = () => {
      cleanup();
      card.style.gridColumn = '';
      card.setAttribute('data-size', current);
    };

    const onUp = () => {
      cleanup();
      if (preview === current) return;
      const body = new FormData();
      body.set('layout', layoutJson);
      body.set('cardId', cardId);
      body.set('size', preview);
      fetch(`${basePath}/api/dashboard-layout/resize`, { method: 'POST', body })
        .then(() => location.reload())
        .catch(() => {
          // Save failed — revert the visual preview so the card doesn't lie.
          card.style.gridColumn = '';
          card.setAttribute('data-size', current);
        });
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  };

  return (
    <button
      ref={ref}
      type="button"
      className="dash-card-resize"
      title="Drag to resize"
      aria-label="Resize card (drag corner)"
      onPointerDown={onPointerDown}
    />
  );
}
