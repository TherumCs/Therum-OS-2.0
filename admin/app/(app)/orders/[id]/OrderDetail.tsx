'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

export interface FullOrder {
  id: string;
  number: string;
  status: string;
  total: number;
  shippingTotal: number;
  taxTotal: number;
  shippingMethod: string | null;
  currency: string;
  discountAmount: number;
  discountLabel: string | null;
  refundedTotal: number;
  guestEmail: string | null;
  createdAt: string;
  shipAddress: Record<string, string> | null;
  customer: { id: string; email: string; name: string | null } | null;
  payment: { status: string; method: string; amount: number; txnId: string | null } | null;
  items: {
    id: string;
    quantity: number;
    priceAtTime: number;
    productionStatus?: string | null;
    variant: {
      id: string; sku: string | null; color: string | null; size: string | null;
      product: { id: string; name: string; slug: string; image: string | null } | null;
    } | null;
  }[];
}

// Which states an order can move to from where it is. Offering every status
// unconditionally is how an order gets marked delivered before it shipped.
// Mirrors the server's TRANSITIONS exactly (order.service.ts). 'refunded' is NOT
// an order status — refunding is a separate action (the Refund control below),
// not a transition; the old delivered→'refunded' + failed→'pending' entries
// 422'd on the server and made the button do nothing (audit R6).
const NEXT: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['cancelled'],
  failed: [],
  cancelled: [],
};

// Per-LINE production stage machine (multi-vendor: each product advances alone).
const PROD_NEXT: Record<string, string[]> = {
  pending: ['in_production', 'shipped'],
  in_production: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
const PROD_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_production: 'In production',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function OrderDetail({ order }: { order: FullOrder }) {
  const router = useRouter();
  const [o, setO] = useState(order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');

  const money = (m: number): string =>
    (m / 100).toLocaleString('en-US', { style: 'currency', currency: o.currency || 'USD' });

  async function transition(status: string): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${o.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body as { error?: { message?: string } } | null)?.error?.message ?? `Could not move to ${status}`);
        return;
      }
      setO({ ...o, status });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  // Advance the production stage of specific lines (or all of them). Entering
  // 'in_production' auto-emails the customer server-side (once per line).
  async function production(status: string, itemIds?: string[]): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/orders/${o.id}/production`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, ...(itemIds ? { itemIds } : {}) }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body as { error?: { message?: string } } | null)?.error?.message ?? `Could not set ${status}`);
        return;
      }
      const targets = new Set(itemIds ?? o.items.map((i) => i.id));
      setO({ ...o, items: o.items.map((i) => (targets.has(i.id) ? { ...i, productionStatus: status } : i)) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  // Issue a REAL refund (PSP refund + restock + coupon release + email), server-
  // side. Blank amount = full refund of the remaining balance. A client
  // idempotencyKey means a double-click never refunds twice (audit R6 wired the
  // long-built refund service that had zero callers).
  async function refund(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const raw = refundAmt.trim();
      const amt = raw ? Math.round(Number(raw) * 100) : undefined;
      if (raw && (!Number.isFinite(amt) || (amt as number) < 1)) { setError('Enter a valid refund amount.'); return; }
      const res = await fetch(`${BASE_PATH}/api/orders/${o.id}/refund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(amt ? { amount: amt } : {}), idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `rf_${o.id}_${Date.now()}` }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) { setError((body as { error?: { message?: string } } | null)?.error?.message ?? 'Refund failed'); return; }
      setRefundOpen(false);
      setRefundAmt('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  const itemsTotal = o.items.reduce((n, i) => n + i.priceAtTime * i.quantity, 0);
  const ship = o.shipAddress ?? {};
  const shipLines = ['line1', 'line2', 'city', 'region', 'postalCode', 'country']
    .map((k) => ship[k])
    .filter((v): v is string => Boolean(v && v.trim()));

  return (
    <section>
      <a href={`${BASE_PATH}/orders`} className="th-hint">← Orders</a>
      <div className="th-studio__title">
        <h1 style={{ margin: 0 }}>{o.number}</h1>
        <span className={'pill pill-' + o.status}>{o.status}</span>
        {busy && <span className="th-studio__save is-busy">Working…</span>}
      </div>
      <p className="th-hint" style={{ marginTop: 4 }}>
        Placed {new Date(o.createdAt).toLocaleString()}
        {o.customer?.email || o.guestEmail ? ` · ${o.customer?.email ?? o.guestEmail}` : ''}
        {!o.customer && o.guestEmail ? ' (guest)' : ''}
      </p>
      {error && <div className="notice">{error}</div>}

      <div className="th-order__cols">
        <div>
          <div className="th-studio__group-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Items</span>
            {/* Bulk per-ORDER stage control: advance EVERY line to the next stage
                at once (the common single-vendor case). Each stage the order can
                move to shows its own button; the customer is emailed per line for
                whatever actually moves. Per-line control is in each row for
                multi-vendor orders on their own timelines. */}
            {(() => {
              const st = o.items.map((i) => i.productionStatus ?? 'pending');
              const bulk = [
                { s: 'in_production', label: 'All in production', show: st.some((x) => x === 'pending') },
                { s: 'shipped', label: 'All shipped', show: st.some((x) => x === 'in_production') },
                { s: 'delivered', label: 'All delivered', show: st.some((x) => x === 'shipped') },
              ].filter((b) => b.show);
              return bulk.length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {bulk.map((b) => (
                    <button key={b.s} type="button" className="th-btn th-btn--sm" disabled={busy} onClick={() => void production(b.s)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
          <table>
            <thead><tr><th>Product</th><th>Production</th><th>Qty</th><th>Price</th><th>Line</th></tr></thead>
            <tbody>
              {o.items.map((i) => {
                const p = i.variant?.product;
                const variantLabel = [i.variant?.color, i.variant?.size].filter(Boolean).join(' / ');
                const ps = i.productionStatus ?? 'pending';
                return (
                  <tr key={i.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p?.image && <img src={p.image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />}
                        <div>
                          {/* Every line links BOTH ways: to the editor and to
                              the live page. An order line naming a product you
                              cannot open is the same dead end as the list. */}
                          {p ? <a href={`${BASE_PATH}/products/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</a> : <span>Item removed</span>}
                          <div className="sub">
                            {variantLabel || i.variant?.sku || ''}
                            {p && <> · <a href={`/product/${p.slug}`} target="_blank" rel="noreferrer">View ↗</a></>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* PER-LINE production stage + advance controls. A multi-vendor
                        order has each product on its own timeline; entering
                        'in_production' emails the customer about THIS item. */}
                    <td>
                      <span className={'pill pill-' + ps}>{PROD_LABEL[ps] ?? ps}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {(PROD_NEXT[ps] ?? []).map((ns) => (
                          <button key={ns} type="button" className="th-btn th-btn--sm" disabled={busy} onClick={() => void production(ns, [i.id])}>
                            {PROD_LABEL[ns] ?? ns}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>{i.quantity}</td>
                    {/* priceAtTime, not the product's price today — an order is
                        a record of what was charged, not a live quote. */}
                    <td>{money(i.priceAtTime)}</td>
                    <td>{money(i.priceAtTime * i.quantity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="th-order__side">
          <div className="th-studio__group-head"><span>Totals</span></div>
          <div className="th-order__row"><span>Items</span><span>{money(itemsTotal)}</span></div>
          {o.discountAmount > 0 && (
            <div className="th-order__row"><span>{o.discountLabel || 'Discount'}</span><span>−{money(o.discountAmount)}</span></div>
          )}
          {/* Shipping and tax are part of what was charged. Without them the
              Items row and the Total row do not reconcile, and whoever is
              looking at this order cannot tell why. */}
          <div className="th-order__row">
            <span>Shipping{o.shippingMethod ? ` · ${o.shippingMethod}` : ''}</span>
            <span>{o.shippingTotal > 0 ? money(o.shippingTotal) : 'Free'}</span>
          </div>
          {o.taxTotal > 0 && (
            <div className="th-order__row"><span>Tax</span><span>{money(o.taxTotal)}</span></div>
          )}
          {o.refundedTotal > 0 && (
            <div className="th-order__row"><span>Refunded</span><span>−{money(o.refundedTotal)}</span></div>
          )}
          <div className="th-order__row th-order__row--total"><span>Total</span><span>{money(o.total)}</span></div>

          <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Payment</span></div>
          {o.payment ? (
            <>
              <div className="th-order__row"><span>{o.payment.method}</span><span className={'pill pill-' + o.payment.status}>{o.payment.status}</span></div>
              {o.payment.txnId && <p className="th-hint" style={{ wordBreak: 'break-all' }}>{o.payment.txnId}</p>}
            </>
          ) : <p className="th-hint">No payment recorded.</p>}

          {/* REAL refund — PSP refund + restock + coupon release + email, server
              side. Shown while there's a payment with a balance left to return. */}
          {o.payment && o.refundedTotal < o.total && (
            <>
              <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Refund</span></div>
              {!refundOpen ? (
                <button type="button" className="th-btn" disabled={busy} onClick={() => { setError(''); setRefundOpen(true); }}>Refund…</button>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <input
                      value={refundAmt}
                      onChange={(e) => setRefundAmt(e.target.value)}
                      inputMode="decimal"
                      placeholder={`Full (${money(o.total - o.refundedTotal)})`}
                      style={{ width: 130, padding: '6px 8px', border: '1px solid var(--th-line)', borderRadius: 6 }}
                    />
                    <button type="button" className="th-btn" disabled={busy} onClick={() => void refund()}>Send refund</button>
                    <button type="button" className="th-btn th-btn--sm" disabled={busy} onClick={() => { setRefundOpen(false); setRefundAmt(''); }}>Cancel</button>
                  </div>
                  <p className="th-hint" style={{ marginTop: 4 }}>Blank = full refund of the remaining {money(o.total - o.refundedTotal)}.</p>
                </>
              )}
            </>
          )}

          <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Customer</span></div>
          {/* Name / email / phone — who this order is for and how to reach them,
              which the card never showed (only the header carried the email). */}
          {(() => {
            const cname = ship.name || o.customer?.name || '';
            const cemail = o.customer?.email || o.guestEmail || '';
            const cphone = ship.phone || '';
            return (
              <p className="th-hint">
                {cname && <span style={{ display: 'block', fontWeight: 600 }}>{cname}</span>}
                {cemail && <span style={{ display: 'block' }}><a href={`mailto:${cemail}`}>{cemail}</a>{!o.customer && o.guestEmail ? ' (guest)' : ''}</span>}
                {cphone ? <span style={{ display: 'block' }}><a href={`tel:${cphone}`}>{cphone}</a></span> : <span style={{ display: 'block', opacity: 0.6 }}>No phone on file</span>}
              </p>
            );
          })()}

          {/* Fulfilment at a glance: the distinct per-line production stages on
              this order (e.g. "In production" + "Shipped" on a split order). */}
          <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Fulfilment</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...new Set(o.items.map((i) => i.productionStatus ?? 'pending'))].map((s) => (
              <span key={s} className={'pill pill-' + s}>{PROD_LABEL[s] ?? s}</span>
            ))}
          </div>

          <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Ship to</span></div>
          {shipLines.length ? (
            <p className="th-hint">{shipLines.map((l) => <span key={l} style={{ display: 'block' }}>{l}</span>)}</p>
          ) : <p className="th-hint">No shipping address.</p>}

          <div className="th-studio__group-head" style={{ marginTop: 18 }}><span>Move this order</span></div>
          {(NEXT[o.status] ?? []).length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(NEXT[o.status] ?? []).map((s) => (
                <button key={s} type="button" className="th-btn" disabled={busy} onClick={() => void transition(s)}>
                  Mark {s}
                </button>
              ))}
            </div>
          ) : <p className="th-hint">{o.status} is a final state.</p>}
        </aside>
      </div>
    </section>
  );
}
