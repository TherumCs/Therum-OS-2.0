'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
}

export interface OfferRow {
  id: string;
  title: string;
  message: string | null;
  status: string;
  seenAt: string | null;
  claimedAt: string | null;
  createdAt: string;
  customer: { id: string; email: string; name: string | null };
  coupon: { code: string; type: 'percent' | 'fixed'; amount: number };
}

// Table cell styling follows the rest of the admin (settings/redirects et al) —
// inline tokens rather than a shared class, because there isn't one.
const TD: React.CSSProperties = { padding: 'var(--th-space-8) var(--th-space-6)' };
const TH: React.CSSProperties = { ...TD, color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' };

function money(minor: number): string {
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function value(type: 'percent' | 'fixed', amount: number): string {
  return type === 'percent' ? `${amount}% off` : `${money(amount)} off`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
        ? String((body.error as { message: unknown }).message)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export function OffersClient({
  initialOffers,
  coupons,
  customers,
}: {
  initialOffers: OfferRow[];
  /** Coupons come from the Promotions page, which already loaded them. */
  coupons: { id: string; code: string; type: 'percent' | 'fixed'; amount: number; minimumAmount: number | null; expiresAt: string | null; status: string }[];
  customers: CustomerRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [composing, setComposing] = useState(false);
  const [couponId, setCouponId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);

  // Only active coupons can be pushed — the backend refuses the rest, and
  // offering the choice here would just be a form that fails on submit.
  const sendable = useMemo(() => coupons.filter((c) => c.status === 'active'), [coupons]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? customers.filter((c) => `${c.email} ${c.name ?? ''}`.toLowerCase().includes(needle)) : customers),
    [customers, needle],
  );

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const send = async () => {
    setError('');
    setResult('');
    if (!couponId) return setError('Pick a coupon to send.');
    if (!title.trim()) return setError('Give the offer a title — it is what the customer reads first.');
    if (!picked.length) return setError('Pick at least one customer.');
    setSending(true);
    try {
      const r = (await jsonOrThrow(
        await fetch('/tos-admin/api/offers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ couponId, customerIds: picked, title: title.trim(), message: message.trim() || undefined }),
        }),
      )) as { created: number; updated: number; skipped: number };
      // Say exactly what happened per customer — "sent!" hides that an
      // already-claimed offer was deliberately left alone.
      setResult(
        `${r.created} sent, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (already claimed)` : ''}.`,
      );
      setPicked([]);
      setTitle('');
      setMessage('');
      setComposing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that offer');
    }
    setSending(false);
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this offer? This cannot be undone.')) return;
    setError('');
    try {
      await jsonOrThrow(await fetch(`/tos-admin/api/offers/${id}`, { method: 'DELETE' }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke that offer');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {error && <div className="notice">{error}</div>}
      {result && <div className="notice">{result}</div>}

      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        <div className="row-between">
          <strong>Send an offer</strong>
          <button className="th-btn" onClick={() => setComposing((v) => !v)}>
            {composing ? 'Cancel' : '+ New offer'}
          </button>
        </div>

        {composing && (
          <div style={{ display: 'grid', gap: 'var(--th-space-12)', marginTop: 'var(--th-space-14)', maxWidth: 560 }}>
            {sendable.length === 0 ? (
              <p className="th-lp-sub" style={{ margin: 0 }}>
                No active coupons to send. Create one first — an offer is a delivery mechanism, not a discount of
                its own.
              </p>
            ) : (
              <>
                <label className="field-label">
                  Coupon
                  <select value={couponId} onChange={(e) => setCouponId(e.target.value)}>
                    <option value="">Choose a coupon…</option>
                    {sendable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {value(c.type, c.amount)}
                        {c.minimumAmount ? ` (min ${money(c.minimumAmount)})` : ''}
                        {c.expiresAt ? ` · ends ${fmtDate(c.expiresAt)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  Title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="A little something for you"
                    maxLength={120}
                  />
                </label>

                <label className="field-label">
                  Message
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    maxLength={600}
                    placeholder="Optional — the line under the title in their account."
                  />
                </label>

                <div>
                  <div className="row-between" style={{ marginBottom: 'var(--th-space-8)' }}>
                    <span className="field-label" style={{ margin: 0 }}>
                      Customers ({picked.length} selected)
                    </span>
                    <button className="th-btn" onClick={() => setPicked(visible.map((c) => c.id))}>
                      Select all shown
                    </button>
                  </div>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Filter by name or email"
                    style={{ marginBottom: 'var(--th-space-8)' }}
                  />
                  <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--th-line)', borderRadius: 6 }}>
                    {visible.length === 0 ? (
                      <p style={{ padding: 'var(--th-space-12)', margin: 0 }}>No customers match.</p>
                    ) : (
                      visible.map((c) => (
                        <label
                          key={c.id}
                          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', cursor: 'pointer' }}
                        >
                          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                          <span>
                            {c.name ? `${c.name} · ` : ''}
                            {c.email}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <button className="th-btn th-btn-primary" onClick={send} disabled={sending}>
                    {sending ? 'Sending…' : `Send to ${picked.length || 'no one'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        <strong>Sent</strong>
        {initialOffers.length === 0 ? (
          <p className="th-lp-sub" style={{ marginTop: 'var(--th-space-10)' }}>
            Nothing pushed yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)', marginTop: 'var(--th-space-12)' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                {['Customer', 'Offer', 'Coupon', 'Status', 'Sent'].map((h) => (
                  <th key={h} style={TH}>{h}</th>
                ))}
                <th style={TD} />
              </tr>
            </thead>
            <tbody>
              {initialOffers.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--th-line)' }}>
                  <td style={TD}>{o.customer.name ? `${o.customer.name} · ${o.customer.email}` : o.customer.email}</td>
                  <td style={TD}>{o.title}</td>
                  <td style={TD}>
                    {o.coupon.code} · {value(o.coupon.type, o.coupon.amount)}
                  </td>
                  <td style={TD}>
                    {o.status === 'claimed'
                      ? `Claimed ${fmtDate(o.claimedAt)}`
                      : o.status === 'dismissed'
                        ? 'Dismissed'
                        : o.seenAt
                          ? 'Seen'
                          : 'Unseen'}
                  </td>
                  <td style={TD}>{fmtDate(o.createdAt)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    {/* A claimed offer cannot be revoked — the customer already has the code. */}
                    {o.status === 'claimed' ? null : (
                      <button className="th-btn" onClick={() => revoke(o.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
