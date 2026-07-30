'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

export interface CouponRow {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  amount: number;
  minimumAmount: number | null;
  maximumAmount: number | null;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  usageCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  status: string;
  description: string | null;
  milieuId: string | null;
  milieu: { id: string; name: string } | null;
  _count: { redemptions: number };
}

export interface MilieuOption {
  id: string;
  name: string;
}

const TD: React.CSSProperties = { padding: 'var(--th-space-8) var(--th-space-6)' };
const TH: React.CSSProperties = { ...TD, color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' };

const EMPTY = {
  code: '',
  type: 'percent' as 'percent' | 'fixed',
  // Percent is 1–100; fixed is MINOR UNITS. The form takes dollars for fixed
  // and converts on the way out — asking a merchant to type 2500 for $25 is
  // how a 100x discount happens.
  amount: 10,
  minimumAmount: '',
  usageLimit: '',
  usageLimitPerUser: '',
  expiresAt: '',
  status: 'active' as 'active' | 'inactive',
  description: '',
  milieuId: '',
};
type Form = typeof EMPTY;

function money(minor: number): string {
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function value(c: CouponRow): string {
  return c.type === 'percent' ? `${c.amount}% off` : `${money(c.amount)} off`;
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
function expired(c: CouponRow): boolean {
  return Boolean(c.expiresAt && new Date(c.expiresAt) <= new Date());
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

function formFrom(c: CouponRow): Form {
  return {
    code: c.code,
    type: c.type,
    amount: c.type === 'percent' ? c.amount : c.amount / 100,
    minimumAmount: c.minimumAmount === null ? '' : String(c.minimumAmount / 100),
    usageLimit: c.usageLimit === null ? '' : String(c.usageLimit),
    usageLimitPerUser: c.usageLimitPerUser === null ? '' : String(c.usageLimitPerUser),
    expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
    status: c.status === 'inactive' ? 'inactive' : 'active',
    description: c.description ?? '',
    milieuId: c.milieuId ?? '',
  };
}

function payloadFrom(f: Form) {
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
  const cents = (v: string): number | null => {
    const n = num(v);
    return n === null ? null : Math.round(n * 100);
  };
  return {
    code: f.code.trim(),
    type: f.type,
    // The one place the percent/minor-units split is resolved.
    amount: f.type === 'percent' ? Math.round(Number(f.amount)) : Math.round(Number(f.amount) * 100),
    minimumAmount: cents(f.minimumAmount),
    usageLimit: num(f.usageLimit),
    usageLimitPerUser: num(f.usageLimitPerUser),
    // End of the chosen day, not the start — a coupon that says it ends on the
    // 30th should work on the 30th.
    expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59`).toISOString() : null,
    status: f.status,
    description: f.description.trim() || null,
    milieuId: f.milieuId || null,
  };
}

export function CouponsTab({ initial, milieus }: { initial: CouponRow[]; milieus: MilieuOption[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  // null = closed; '' = creating; an id = editing that one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const open = editingId !== null;

  async function save(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const url = editingId ? `${BASE_PATH}/api/coupons/${editingId}` : `${BASE_PATH}/api/coupons`;
      await jsonOrThrow(
        await fetch(url, {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payloadFrom(form)),
        }),
      );
      setEditingId(null);
      setForm(EMPTY);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setBusy(false);
  }

  async function remove(id: string): Promise<void> {
    setError('');
    try {
      await jsonOrThrow(await fetch(`${BASE_PATH}/api/coupons/${id}`, { method: 'DELETE' }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {error && <div className="notice">{error}</div>}

      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        <div className="row-between">
          <strong>{open ? (editingId ? 'Edit coupon' : 'New coupon') : 'Coupons'}</strong>
          <button
            className="th-btn"
            onClick={() => {
              setForm(EMPTY);
              setEditingId(open ? null : '');
            }}
          >
            {open ? 'Cancel' : '+ New coupon'}
          </button>
        </div>

        {open && (
          <div style={{ display: 'grid', gap: 'var(--th-space-10)', marginTop: 'var(--th-space-14)', maxWidth: 520 }}>
            <label className="field-label">
              Code
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
              />
            </label>
            <label className="field-label">
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Form['type'] })}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </label>
            <label className="field-label">
              {form.type === 'percent' ? 'Percent (1–100)' : 'Amount off ($)'}
              <input
                type="number"
                min={form.type === 'percent' ? 1 : 0.01}
                max={form.type === 'percent' ? 100 : undefined}
                step={form.type === 'percent' ? 1 : 0.01}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              />
            </label>
            <label className="field-label">
              Minimum spend ($)
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.minimumAmount}
                onChange={(e) => setForm({ ...form, minimumAmount: e.target.value })}
                placeholder="No minimum"
              />
            </label>
            <label className="field-label">
              Milieus group
              <select value={form.milieuId} onChange={(e) => setForm({ ...form, milieuId: e.target.value })}>
                <option value="">Anyone with the code</option>
                {milieus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-help" style={{ marginTop: -4 }}>
              Restricting a code to a Milieus group checks it against a signed-in account, never the email typed at
              checkout — so it cannot be claimed by guessing a member&apos;s address. Note that Milieus members do not
              use coupons at all: their member price already applies, and codes do not stack on top of it.
            </p>
            <label className="field-label">
              Total uses
              <input
                type="number"
                min={1}
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="Unlimited"
              />
            </label>
            <label className="field-label">
              Uses per customer
              <input
                type="number"
                min={1}
                value={form.usageLimitPerUser}
                onChange={(e) => setForm({ ...form, usageLimitPerUser: e.target.value })}
                placeholder="Unlimited"
              />
            </label>
            <label className="field-label">
              Ends
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </label>
            <label className="field-label">
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Form['status'] })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="field-label">
              Internal note
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this campaign is for. Never shown to shoppers."
              />
            </label>
            <div>
              <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create coupon'}
              </button>
            </div>
          </div>
        )}

        {initial.length === 0 ? (
          <p className="th-lp-sub" style={{ marginTop: 'var(--th-space-12)' }}>
            No coupons yet. A coupon is also what an Offer sends, so this is the place to start.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)', marginTop: 'var(--th-space-14)' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                {['Code', 'Value', 'Restrictions', 'Used', 'Ends', 'Status'].map((h) => (
                  <th key={h} style={TH}>
                    {h}
                  </th>
                ))}
                <th style={TD} />
              </tr>
            </thead>
            <tbody>
              {initial.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--th-line)', opacity: c.status === 'active' && !expired(c) ? 1 : 0.55 }}>
                  <td style={{ ...TD, fontFamily: 'var(--th-font-mono)' }}>{c.code}</td>
                  <td style={TD}>{value(c)}</td>
                  <td style={TD}>
                    {[
                      c.milieu ? `${c.milieu.name} only` : null,
                      c.minimumAmount ? `min ${money(c.minimumAmount)}` : null,
                      c.usageLimitPerUser ? `${c.usageLimitPerUser}/customer` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td style={TD}>
                    {c.usageCount}
                    {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                  </td>
                  <td style={TD}>{fmtDate(c.expiresAt)}</td>
                  <td style={TD}>{expired(c) ? 'Expired' : c.status === 'active' ? 'Active' : 'Inactive'}</td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="th-btn"
                      onClick={() => {
                        setForm(formFrom(c));
                        setEditingId(c.id);
                      }}
                    >
                      Edit
                    </button>{' '}
                    {/* Deleting cascades its redemptions, which is real history —
                        so a used coupon is deactivated instead. */}
                    {c._count.redemptions === 0 ? (
                      <button className="th-btn" onClick={() => void remove(c.id)}>
                        Delete
                      </button>
                    ) : null}
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
