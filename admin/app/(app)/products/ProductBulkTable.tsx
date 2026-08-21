'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';
import { money, type Product } from '../../../lib/types';
import { bulkProducts, trashProduct, duplicateProduct, restoreProduct, purgeProduct, type BulkResult } from '../../actions';

// The list view with row selection + a bulk-action bar. The page stays a
// server component and hands the already-fetched page of products down; only
// the selection layer is client-side. Selection covers the visible page — the
// checkboxes act on what you can see, never a hidden "all 900 matching".
export function ProductBulkTable({ items, trashView }: { items: Product[]; trashView: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const allOn = items.length > 0 && sel.size === items.length;
  const someOn = sel.size > 0 && !allOn;

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSel(allOn ? new Set() : new Set(items.map((p) => p.id)));
  }

  function run(label: string, fn: () => Promise<BulkResult>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        setMsg(r.failed.length ? `${label}: ${r.ok} done, ${r.failed.length} failed` : `${label}: ${r.ok} product${r.ok === 1 ? '' : 's'}`);
        setSel(new Set());
        router.refresh();
      } catch (e) {
        setMsg(`${label} failed — ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  const ids = () => [...sel];

  return (
    <>
      {sel.size > 0 && (
        <div className="th-bulkbar" role="region" aria-label="Bulk actions">
          <span className="th-bulkbar__count">{sel.size} selected</span>
          <div className="th-bulkbar__actions">
            {trashView ? (
              <>
                <button type="button" className="th-btn th-btn--xs" disabled={pending}
                  onClick={() => run('Restored', () => bulkProducts(ids(), 'restore'))}>Restore</button>
                <button type="button" className="th-btn th-btn--xs th-btn--danger" disabled={pending}
                  onClick={() => run('Deleted', () => bulkProducts(ids(), 'purge'), `Delete ${sel.size} product(s) forever? This cannot be undone.`)}>Delete forever</button>
              </>
            ) : (
              <>
                <button type="button" className="th-btn th-btn--xs" disabled={pending}
                  onClick={() => run('Published', () => bulkProducts(ids(), 'status', { status: 'active' }))}>Publish</button>
                <button type="button" className="th-btn th-btn--xs" disabled={pending}
                  onClick={() => run('Unpublished', () => bulkProducts(ids(), 'status', { status: 'draft' }))}>Unpublish</button>
                <button type="button" className="th-btn th-btn--xs" disabled={pending}
                  onClick={() => run('Archived', () => bulkProducts(ids(), 'status', { status: 'archived' }))}>Archive</button>
                <button type="button" className="th-btn th-btn--xs th-btn--danger" disabled={pending}
                  onClick={() => run('Trashed', () => bulkProducts(ids(), 'trash'), `Move ${sel.size} product(s) to the trash?`)}>Trash</button>
              </>
            )}
          </div>
          <button type="button" className="th-bulkbar__clear" onClick={() => setSel(new Set())} disabled={pending}>Clear</button>
          {msg && <span className="th-bulkbar__msg" aria-live="polite">{msg}</span>}
        </div>
      )}

      <table className="th-ptable">
        <thead>
          <tr>
            <th className="th-ptable__cbcell">
              <input type="checkbox" aria-label="Select all" checked={allOn}
                ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll} />
            </th>
            <th>Product</th>
            <th>Status</th>
            <th>Variants</th>
            <th>From</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className={sel.has(p.id) ? 'is-selected' : ''}>
              <td className="th-ptable__cbcell">
                <input type="checkbox" aria-label={`Select ${p.name}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
              </td>
              <td>
                <span className="th-ptable__thumb">{p.image ? <img src={p.image} alt="" loading="lazy" /> : null}</span>
                <a href={`${BASE_PATH}/products/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</a>
                <div className="sub">{p.slug}</div>
              </td>
              <td><span className={'pill pill-' + p.status}>{p.status}</span></td>
              <td>{p.variants.length}</td>
              <td>{p.variants.length ? money(Math.min(...p.variants.map((v) => v.price))) : '—'}</td>
              <td className="th-rowactions">
                {trashView ? (
                  <>
                    <form action={restoreProduct.bind(null, p.id)}><button type="submit" className="th-btn th-btn--xs">Restore</button></form>
                    <form action={purgeProduct.bind(null, p.id)}><button type="submit" className="th-btn th-btn--xs th-btn--danger">Delete forever</button></form>
                  </>
                ) : (
                  <>
                    <a className="th-btn th-btn--xs" href={`${BASE_PATH}/products/${p.id}`}>Edit</a>
                    <a className="th-btn th-btn--xs" href={`/product/${p.slug}`} target="_blank" rel="noreferrer">View ↗</a>
                    <form action={duplicateProduct.bind(null, p.id)}><button type="submit" className="th-btn th-btn--xs">Duplicate</button></form>
                    <form action={trashProduct.bind(null, p.id)}><button type="submit" className="th-btn th-btn--xs th-btn--danger">Trash</button></form>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
