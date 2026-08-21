'use client';

import { useEffect, useState } from 'react';

// The admin runs under a basePath; API routes are served under it too.
const BP = process.env.NEXT_PUBLIC_BASE_PATH ?? '/tos-admin';

// Assign products to a category (or tag) from the term's side.
//
// Runs in the browser, so every fetch is same-origin — the admin's basePath is
// the only prefix needed. Importing the server-side apiBase() would drag
// next/headers into a client bundle and fail the build.
//
// The product editor already lets you tag a product with categories. This is
// the reverse the user asked for: standing in the category, pull products into
// it. It toggles ONE membership at a time (connect/disconnect), so adding a
// product here never disturbs the categories it already has.

interface Roster {
  id: string;
  name: string;
  image: string | null;
}

export function AssignProducts({ kind, termId, termName }: { kind: 'categories' | 'tags'; termId: string; termName: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<Roster[]>([]);
  const [inTerm, setInTerm] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
            // The full roster and the current membership in parallel — the membership
      // set is what pre-ticks the boxes.
      const [rosterRes, memberRes] = await Promise.all([
        fetch(`${BP}/api/products?limit=500`, { credentials: 'include' }),
        fetch(`${BP}/api/catalog/${kind}/${termId}/products`, { credentials: 'include' }),
      ]);
      const roster = (await rosterRes.json().catch(() => ({}))) as { items?: Roster[] };
      const members = (await memberRes.json().catch(() => [])) as Roster[];
      if (cancelled) return;
      setAll(roster.items ?? []);
      setInTerm(new Set(members.map((m) => m.id)));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [open, loaded, kind, termId]);

  async function toggle(productId: string, on: boolean) {
    // Optimistic: flip the box now, revert only if the server says no. A
    // membership toggle that waits for a round trip feels broken on a list.
    setInTerm((prev) => {
      const next = new Set(prev);
      if (on) next.add(productId); else next.delete(productId);
      return next;
    });
    setBusy(true);
    try {
      const res = await fetch(`${BP}/api/catalog/${kind}/${termId}/products/${productId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ on }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setInTerm((prev) => {
        const next = new Set(prev);
        if (on) next.delete(productId); else next.add(productId);
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  const shown = all.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  if (!open) {
    return (
      <button type="button" className="th-btn th-btn--xs" onClick={() => setOpen(true)}>
        Assign products
      </button>
    );
  }

  return (
    <div className="th-assign">
      <div className="th-assign__head">
        <strong>{termName}</strong>
        <span className="th-hint">{inTerm.size} assigned</span>
        <button type="button" className="th-btn th-btn--xs" onClick={() => setOpen(false)}>Done</button>
      </div>
      <input
        className="th-assign__search"
        placeholder="Search products…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="th-assign__list">
        {!loaded && <p className="th-hint">Loading…</p>}
        {loaded && !shown.length && <p className="th-hint">No products match.</p>}
        {shown.map((p) => {
          const on = inTerm.has(p.id);
          return (
            <label key={p.id} className={'th-assign__row' + (on ? ' on' : '')}>
              <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(p.id, e.target.checked)} />
              {p.image
                ? <img src={p.image} alt="" width={26} height={26} loading="lazy" />
                : <span className="th-assign__noimg" />}
              <span>{p.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
