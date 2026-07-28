'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalFilterBar, sortRows } from '../ClientTableControls';
import { useRouter } from 'next/navigation';

export interface MilieuRow {
  id: string;
  name: string;
  slug: string;
  color: string;
  discountPct: number;
  expiresAt: string | null;
  memberDurationDays: number;
  memberCount: number;
  regEnabled: boolean;
  regSlug: string | null;
  regRequiresApproval: boolean;
  regMaxSignups: number;
  regSignupCount: number;
}

interface MemberRow {
  customerId: string;
  email: string;
  name: string | null;
  assignedAt: string;
  expiresAt: string | null;
  expiryTier: 'permanent' | 'ok' | 'soon' | 'urgent' | 'expired';
  source: string;
  pending: boolean;
}

interface Candidate {
  id: string;
  email: string;
  name: string | null;
}

const EMPTY_FORM = { name: '', slug: '', color: '#2563eb', discountPct: 0, memberDurationDays: 0, expiresAt: '', regEnabled: false, regSlug: '', regRequiresApproval: false, regMaxSignups: 0 };

type MilieuForm = typeof EMPTY_FORM;

function formFromRow(m: MilieuRow): MilieuForm {
  return {
    name: m.name,
    slug: m.slug,
    color: m.color,
    discountPct: m.discountPct,
    memberDurationDays: m.memberDurationDays,
    expiresAt: m.expiresAt ? m.expiresAt.slice(0, 10) : '',
    regEnabled: m.regEnabled,
    regSlug: m.regSlug ?? '',
    regRequiresApproval: m.regRequiresApproval,
    regMaxSignups: m.regMaxSignups,
  };
}

function formToPayload(form: MilieuForm) {
  return {
    name: form.name,
    slug: form.slug,
    color: form.color,
    discountPct: Number(form.discountPct),
    memberDurationDays: Math.floor(Number(form.memberDurationDays) || 0),
    expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
    regEnabled: form.regEnabled,
    regSlug: form.regEnabled && form.regSlug ? form.regSlug : null,
    regRequiresApproval: form.regRequiresApproval,
    regMaxSignups: Math.floor(Number(form.regMaxSignups) || 0),
  };
}

// 1.x expiry tiers → visual treatment. Status colors are semantic tokens,
// separate from the accent (design-system rule).
const TIER_LABEL: Record<MemberRow['expiryTier'], string> = {
  permanent: 'Permanent',
  ok: '',
  soon: 'soon',
  urgent: 'urgent',
  expired: 'expired',
};

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

export function MilieusClient({ initial, loadError }: { initial: MilieuRow[]; loadError?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  // null = closed; '' = creating; a milieu id = editing that one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mq, setMq] = useState('');
  const [msort, setMsort] = useState('name:asc');
  const creating = editingId !== null;

  const save = async () => {
    setError('');
    try {
      const url = editingId ? `/tos-admin/api/milieus/${editingId}` : '/tos-admin/api/milieus';
      await jsonOrThrow(
        await fetch(url, {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(formToPayload(form)),
        }),
      );
      setEditingId(null);
      setForm(EMPTY_FORM);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const remove = async (id: string) => {
    setError('');
    try {
      await jsonOrThrow(await fetch(`/tos-admin/api/milieus/${id}`, { method: 'DELETE' }));
      if (openId === id) setOpenId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const mNeedle = mq.trim().toLowerCase();
  const mVisible = sortRows(
    mNeedle ? initial.filter((m) => `${m.name} ${m.slug}`.toLowerCase().includes(mNeedle)) : initial,
    msort,
    {
      name: (m) => m.name,
      members: (m) => m.memberCount,
      discount: (m) => m.discountPct,
    },
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {loadError && <div className="notice">Couldn&apos;t reach the backend — the list below may be incomplete.</div>}
      {error && <div className="notice">{error}</div>}

      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        <div className="row-between">
          <strong>Member groups</strong>
          <button
            className="th-btn"
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId(creating ? null : '');
            }}
          >
            {creating ? 'Cancel' : '+ New milieu'}
          </button>
        </div>

        {creating && (
          <div style={{ display: 'grid', gap: 'var(--th-space-10)', marginTop: 'var(--th-space-12)', maxWidth: 420 }}>
            <label className="field-label">
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') })} />
            </label>
            <label className="field-label">
              Slug
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </label>
            <label className="field-label">
              Color
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </label>
            <label className="field-label">
              Discount %
              <input type="number" min={0} max={100} value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: Number(e.target.value) })} />
            </label>
            <label className="field-label">
              Member duration (days, 0 = permanent)
              <input type="number" min={0} step={1} value={form.memberDurationDays} onChange={(e) => setForm({ ...form, memberDurationDays: Number(e.target.value) })} />
            </label>
            <label className="field-label">
              Group expires (blank = forever)
              <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </label>
            <label className="field-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.regEnabled} onChange={(e) => setForm({ ...form, regEnabled: e.target.checked, regSlug: form.regSlug || form.slug })} />
              Public registration link
            </label>
            {form.regEnabled && (
              <>
                <label className="field-label">
                  Registration slug
                  <input value={form.regSlug} onChange={(e) => setForm({ ...form, regSlug: e.target.value })} />
                </label>
                <label className="field-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.regRequiresApproval} onChange={(e) => setForm({ ...form, regRequiresApproval: e.target.checked })} />
                  Require approval
                </label>
                <label className="field-label">
                  Max signups (0 = unlimited)
                  <input type="number" min={0} step={1} value={form.regMaxSignups} onChange={(e) => setForm({ ...form, regMaxSignups: Number(e.target.value) })} />
                </label>
              </>
            )}
            <div>
              <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={!form.name || !form.slug || (form.regEnabled && !form.regSlug)}>
                {editingId ? 'Save changes' : 'Create milieu'}
              </button>
            </div>
          </div>
        )}

        {initial.length === 0 ? (
          !creating && (
            <p className="muted" style={{ marginBottom: 0 }}>
              No milieus yet — create your first group.
            </p>
          )
        ) : (
          <>
          <LocalFilterBar
            query={mq}
            onQuery={setMq}
            sortKey={msort}
            onSort={setMsort}
            sorts={[
              { key: 'name:asc', label: 'Name A–Z' },
              { key: 'name:desc', label: 'Name Z–A' },
              { key: 'members:desc', label: 'Most members' },
              { key: 'members:asc', label: 'Fewest members' },
              { key: 'discount:desc', label: 'Highest discount' },
            ]}
            searchPlaceholder="Search milieus…"
            shown={mVisible.length}
            total={initial.length}
          />
          <table style={{ width: '100%', marginTop: 'var(--th-space-12)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th style={{ textAlign: 'left' }}>Members</th>
                <th style={{ textAlign: 'left' }}>Discount</th>
                <th style={{ textAlign: 'left' }}>Default duration</th>
                <th style={{ textAlign: 'left' }}>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mVisible.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: m.color, marginRight: 8 }} />
                    {m.name} <span className="muted">/{m.slug}</span>
                    {m.regEnabled && m.regSlug && (
                      <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                        signup: POST /api/public/register/{m.regSlug}
                        {m.regRequiresApproval ? ' · approval' : ''}
                        {m.regMaxSignups > 0 ? ` · ${m.regSignupCount}/${m.regMaxSignups}` : ''}
                      </div>
                    )}
                  </td>
                  <td>{m.memberCount}</td>
                  <td>{m.discountPct > 0 ? `${m.discountPct}%` : '—'}</td>
                  <td>{m.memberDurationDays > 0 ? `${m.memberDurationDays}d` : 'Permanent'}</td>
                  <td>{m.expiresAt ? fmtDate(m.expiresAt) : 'Never'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="th-btn" onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                      {openId === m.id ? 'Close' : 'Members'}
                    </button>{' '}
                    <button
                      className="th-btn"
                      onClick={() => {
                        setForm(formFromRow(m));
                        setEditingId(m.id);
                      }}
                    >
                      Edit
                    </button>{' '}
                    <button className="th-btn" onClick={() => void remove(m.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      {openId && <MembersPanel key={openId} milieuId={openId} onChanged={() => router.refresh()} />}
    </div>
  );
}

function MembersPanel({ milieuId, onChanged }: { milieuId: string; onChanged: () => void }) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Monotonic sequence: a slow response for an older query can't overwrite a
  // newer one (audit finding B2 — the filter had no stale-response guard).
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const res = await fetch(`/tos-admin/api/milieus/${milieuId}/members?page=${page}&search=${encodeURIComponent(search)}`);
    const data = (await jsonOrThrow(res)) as { rows: MemberRow[]; total: number };
    if (seq !== loadSeq.current) return; // superseded by a newer request
    setRows(data.rows);
    setTotal(data.total);
    setSelected(new Set());
  }, [milieuId, page, search]);

  // Debounced: typing in the filter doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      void load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'));
    }, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Typeahead: customers not yet in this milieu (1.x members_search).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    debounce.current = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/tos-admin/api/milieus/${milieuId}/candidates?q=${encodeURIComponent(q)}`);
        setCandidates((await jsonOrThrow(res)) as Candidate[]);
      })().catch(() => setCandidates([]));
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current); // no set-state after unmount
    };
  }, [q, milieuId]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  };

  const add = (customerId: string) =>
    act(async () => {
      await jsonOrThrow(
        await fetch(`/tos-admin/api/milieus/${milieuId}/members`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ customerId, source: 'manual' }),
        }),
      );
      setQ('');
      setCandidates([]);
    });

  const approve = (customerId: string) =>
    act(async () => {
      await jsonOrThrow(await fetch(`/tos-admin/api/milieus/${milieuId}/members/${customerId}/approve`, { method: 'POST' }));
    });

  const bulk = (action: 'revoke' | 'extend_30' | 'reset_expiry') =>
    act(async () => {
      await jsonOrThrow(
        await fetch(`/tos-admin/api/milieus/${milieuId}/members/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, customerIds: [...selected] }),
        }),
      );
    });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
      <div className="row-between">
        <strong>Members ({total})</strong>
        <input placeholder="Filter members…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {error && <div className="notice">{error}</div>}

      <div style={{ position: 'relative', marginTop: 'var(--th-space-12)', maxWidth: 360 }}>
        <input placeholder="Add customer by name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
        {candidates.length > 0 && (
          <div className="th-card" style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, top: '100%', padding: 'var(--th-space-6)' }}>
            {candidates.map((c) => (
              <button key={c.id} className="th-btn" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => void add(c.id)}>
                {c.name ?? c.email} <span className="muted">{c.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div style={{ marginTop: 'var(--th-space-12)', display: 'flex', gap: 'var(--th-space-8)' }}>
          <button className="th-btn" onClick={() => void bulk('revoke')}>Remove ({selected.size})</button>
          <button className="th-btn" onClick={() => void bulk('extend_30')}>Extend 30d</button>
          <button className="th-btn" onClick={() => void bulk('reset_expiry')}>Reset expiry</button>
        </div>
      )}

      <table style={{ width: '100%', marginTop: 'var(--th-space-12)' }}>
        <thead>
          <tr>
            <th />
            <th style={{ textAlign: 'left' }}>Member</th>
            <th style={{ textAlign: 'left' }}>Joined</th>
            <th style={{ textAlign: 'left' }}>Expires</th>
            <th style={{ textAlign: 'left' }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId}>
              <td>
                <input type="checkbox" checked={selected.has(r.customerId)} onChange={() => toggle(r.customerId)} />
              </td>
              <td>
                {r.name ?? r.email} <span className="muted">{r.email}</span>
              </td>
              <td>{fmtDate(r.assignedAt)}</td>
              <td data-tier={r.expiryTier}>
                {r.pending ? (
                  <>
                    <span style={{ color: 'var(--th-warn, #b45309)' }}>pending approval</span>{' '}
                    <button className="th-btn" onClick={() => void approve(r.customerId)}>Approve</button>
                  </>
                ) : (
                  <>
                    {r.expiryTier === 'permanent' ? 'Permanent' : fmtDate(r.expiresAt)}
                    {TIER_LABEL[r.expiryTier] && r.expiryTier !== 'permanent' ? <span className="muted"> · {TIER_LABEL[r.expiryTier]}</span> : null}
                  </>
                )}
              </td>
              <td className="muted">{r.source}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No members yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div style={{ marginTop: 'var(--th-space-12)', display: 'flex', gap: 'var(--th-space-8)', alignItems: 'center' }}>
          <button className="th-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
          <span className="muted">{page} / {pages}</span>
          <button className="th-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>→</button>
        </div>
      )}
    </div>
  );
}
