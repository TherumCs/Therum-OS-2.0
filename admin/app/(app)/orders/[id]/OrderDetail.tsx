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
    variant: {
      id: string; sku: string | null; color: string | null; size: string | null;
      product: { id: string; name: string; slug: string; image: string | null } | null;
    } | null;
  }[];
}

// Which states an order can move to from where it is. Offering every status
// unconditionally is how an order gets marked delivered before it shipped.
const NEXT: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
  failed: ['pending'],
};

export function OrderDetail({ order }: { order: FullOrder }) {
  const router = useRouter();
  const [o, setO] = useState(order);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
          <div className="th-studio__group-head"><span>Items</span></div>
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Line</th></tr></thead>
            <tbody>
              {o.items.map((i) => {
                const p = i.variant?.product;
                const variantLabel = [i.variant?.color, i.variant?.size].filter(Boolean).join(' / ');
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
