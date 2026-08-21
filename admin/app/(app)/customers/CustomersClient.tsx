'use client';

import { useMemo, useState } from 'react';

export interface GroupOption {
  id: string;
  name: string;
}
interface Membership {
  id: string;
  pendingAt: string | null;
  milieu: { id: string; name: string };
}
export interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  _count?: { orders: number };
  memberships: Membership[];
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error((body as { error?: { message?: string } })?.error?.message || `Request failed (${res.status})`);
  return body;
}

export function CustomersClient({ initial, groups, loadError }: { initial: CustomerRow[]; groups: GroupOption[]; loadError: boolean }) {
  const [rows, setRows] = useState<CustomerRow[]>(initial);
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', firstName: '', lastName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.email, r.name, r.firstName, r.lastName].some((v) => (v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const patch = (id: string, next: Partial<CustomerRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const startEdit = (r: CustomerRow) => {
    setEditId(r.id);
    setForm({ name: r.name || '', firstName: r.firstName || '', lastName: r.lastName || '' });
    setError('');
  };

  const saveEdit = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const updated = (await jsonOrThrow(
        await fetch(`/tos-admin/api/customers/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: form.name || null, firstName: form.firstName || null, lastName: form.lastName || null }),
        }),
      )) as CustomerRow;
      patch(id, { name: updated.name, firstName: updated.firstName, lastName: updated.lastName });
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };

  const addGroup = async (r: CustomerRow, groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    if (!g || r.memberships.some((m) => m.milieu.id === groupId)) return;
    setBusy(true);
    setError('');
    try {
      await jsonOrThrow(
        await fetch(`/tos-admin/api/milieus/${groupId}/members`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ customerId: r.id, source: 'manual' }),
        }),
      );
      patch(r.id, { memberships: [...r.memberships, { id: `tmp-${groupId}`, pendingAt: null, milieu: { id: g.id, name: g.name } }] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to group.');
    }
    setBusy(false);
  };

  const removeGroup = async (r: CustomerRow, groupId: string) => {
    setBusy(true);
    setError('');
    try {
      await jsonOrThrow(await fetch(`/tos-admin/api/milieus/${groupId}/members/${r.id}`, { method: 'DELETE' }));
      patch(r.id, { memberships: r.memberships.filter((m) => m.milieu.id !== groupId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove from group.');
    }
    setBusy(false);
  };

  if (loadError) return <div className="notice">Couldn&apos;t load customers — the backend may be offline.</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 14px' }}>
        <input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        {error && <span style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Real name</th>
            <th>Groups</th>
            <th style={{ textAlign: 'right' }}>Orders</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const editing = editId === r.id;
            const avail = groups.filter((g) => !r.memberships.some((m) => m.milieu.id === g.id));
            return (
              <tr key={r.id}>
                <td>
                  {editing ? (
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Display name" style={{ maxWidth: 180 }} />
                  ) : (
                    <div style={{ fontWeight: 600 }}>{r.name || '—'}</div>
                  )}
                  <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>{r.email}</div>
                </td>
                <td>
                  {editing ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="First" style={{ width: 92 }} />
                      <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Last" style={{ width: 92 }} />
                    </div>
                  ) : (
                    <span>{[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {r.memberships.map((m) => (
                      <span key={m.milieu.id} className="pill pill-ok" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {m.milieu.name}
                        {m.pendingAt ? ' (pending)' : ''}
                        <button
                          type="button"
                          title="Remove from group"
                          onClick={() => void removeGroup(r, m.milieu.id)}
                          disabled={busy}
                          style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {avail.length > 0 && (
                      <select
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          e.currentTarget.value = '';
                          void addGroup(r, v);
                        }}
                        style={{ width: 120, fontSize: 'var(--th-fs-2xs)' }}
                      >
                        <option value="">+ group</option>
                        {avail.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r._count?.orders ?? 0}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editing ? (
                    <>
                      <button className="th-btn th-btn-primary th-btn--xs" onClick={() => void saveEdit(r.id)} disabled={busy}>
                        Save
                      </button>{' '}
                      <button className="th-btn th-btn--xs" onClick={() => setEditId(null)} disabled={busy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="th-btn th-btn--xs" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!filtered.length && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 20 }}>
                No customers match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
