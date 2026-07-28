'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalFilterBar, sortRows } from '../ClientTableControls';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

export interface ClusterRow {
  id: string;
  name: string;
  memberCount: number;
  primaryProductId: string | null;
  primaryName: string | null;
  hasDrift: boolean;
}

interface Candidate {
  id: string;
  name: string;
  slug: string;
  vendor: { name: string } | null;
}

interface Member {
  productId: string;
  name: string;
  slug: string;
  status: string;
  vendor: { id: string; name: string } | null;
  variantCount: number;
  isPrimary: boolean;
}

interface GroupDetail {
  id: string;
  name: string;
  primaryProductId: string;
  primaryIsExplicit: boolean;
  members: Member[];
}

interface MergedVariant {
  variantId: string;
  sku: string | null;
  price: number;
  color: string | null;
  size: string | null;
  available: number;
  inStock: boolean;
  sourceProductName: string;
  sourceVendor: { name: string } | null;
}

interface DriftFinding {
  productId: string;
  productName: string;
  missing: string[];
  extra: string[];
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body ? (body.error as { message?: string }).message : null;
    throw new Error(msg ?? `Request failed (${res.status})`);
  }
  return body;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function ClustersClient({ initial, loadError }: { initial: ClusterRow[]; loadError?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  // null = closed; '' = creating; an id = editing that group.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState('name:asc');
  const editorOpen = editingId !== null;

  const openCreate = () => {
    setName('');
    setPicked([]);
    setEditingId(editorOpen ? null : '');
  };

  const openEdit = async (id: string) => {
    setError('');
    try {
      const g = (await jsonOrThrow(await fetch(`${BASE_PATH}/api/clusters/${id}`))) as GroupDetail;
      setName(g.name);
      setPicked(g.members.map((m) => ({ id: m.productId, name: m.name, slug: m.slug, vendor: m.vendor })));
      setEditingId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  };

  const save = async () => {
    setError('');
    try {
      const payload = { name, productIds: picked.map((p) => p.id) };
      const url = editingId ? `${BASE_PATH}/api/clusters/${editingId}` : `${BASE_PATH}/api/clusters`;
      await jsonOrThrow(await fetch(url, { method: editingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const remove = async (id: string) => {
    const row = initial.find((c) => c.id === id);
    if (!window.confirm(`Delete group "${row?.name ?? id}"? Products stay; only the grouping is removed.`)) return;
    setError('');
    try {
      await jsonOrThrow(await fetch(`${BASE_PATH}/api/clusters/${id}`, { method: 'DELETE' }));
      if (openId === id) setOpenId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const needle = q.trim().toLowerCase();
  const visible = sortRows(
    needle
      ? initial.filter((c) => `${c.name} ${c.primaryName ?? ''}`.toLowerCase().includes(needle))
      : initial,
    sortKey,
    {
      name: (c) => c.name,
      members: (c) => c.memberCount,
      health: (c) => (c.hasDrift ? 'drift' : 'consistent'),
    },
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {loadError && <div className="notice">Couldn&apos;t reach the backend — the list below may be incomplete.</div>}
      {error && <div className="notice">{error}</div>}

      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        <div className="row-between">
          <strong>Merged products</strong>
          <button className="th-btn" onClick={openCreate}>
            {editorOpen ? 'Cancel' : '+ New group'}
          </button>
        </div>

        {editorOpen && (
          <div style={{ display: 'grid', gap: 'var(--th-space-12)', margin: 'var(--th-space-16) 0', maxWidth: 480 }}>
            <label className="field-label">
              Group name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Starter Tee (all suppliers)" />
            </label>
            <ProductPicker picked={picked} onChange={setPicked} />
            <div>
              <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={!name || picked.length < 2}>
                {editingId ? 'Save changes' : 'Create group'}
              </button>{' '}
              {picked.length < 2 && <span className="muted">Pick at least 2 products.</span>}
            </div>
          </div>
        )}

        {initial.length === 0 ? (
          !editorOpen && (
            <p className="muted" style={{ marginBottom: 0 }}>
              No merged-product groups yet — create your first one.
            </p>
          )
        ) : (
          <>
          <LocalFilterBar
            query={q}
            onQuery={setQ}
            sortKey={sortKey}
            onSort={setSortKey}
            sorts={[
              { key: 'name:asc', label: 'Name A–Z' },
              { key: 'name:desc', label: 'Name Z–A' },
              { key: 'members:desc', label: 'Most members' },
              { key: 'members:asc', label: 'Fewest members' },
              { key: 'health:asc', label: 'Health' },
            ]}
            searchPlaceholder="Search groups…"
            shown={visible.length}
            total={initial.length}
          />
          <table style={{ width: '100%', marginTop: 'var(--th-space-12)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th style={{ textAlign: 'left' }}>Members</th>
                <th style={{ textAlign: 'left' }}>Primary</th>
                <th style={{ textAlign: 'left' }}>Health</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.memberCount}</td>
                  <td>{c.primaryName ?? '—'}</td>
                  <td>
                    {c.hasDrift ? (
                      <span style={{ color: 'var(--th-warn, #b45309)' }}>drift</span>
                    ) : (
                      <span className="muted">consistent</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="th-btn" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                      {openId === c.id ? 'Close' : 'Details'}
                    </button>{' '}
                    <button className="th-btn" onClick={() => void openEdit(c.id)}>
                      Edit
                    </button>{' '}
                    <button className="th-btn" onClick={() => void remove(c.id)}>
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

      {openId && <GroupDetailPanel key={openId} groupId={openId} onChanged={() => router.refresh()} />}
    </div>
  );
}

function ProductPicker({ picked, onChange }: { picked: Candidate[]; onChange: (next: Candidate[]) => void }) {
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sequence guard: a slow response for an older query (or one raced by a
  // pick) can't repopulate the dropdown with stale rows (audit finding #9).
  const seq = useRef(0);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    const mySeq = ++seq.current;
    debounce.current = setTimeout(() => {
      void (async () => {
        const res = await fetch(`${BASE_PATH}/api/clusters/candidates?q=${encodeURIComponent(q)}`);
        if (mySeq !== seq.current) return;
        const rows = (await jsonOrThrow(res)) as Candidate[];
        if (mySeq !== seq.current) return;
        setCandidates(rows.filter((r) => !picked.some((p) => p.id === r.id)));
      })().catch(() => setCandidates([]));
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, picked]);

  return (
    <div>
      <label className="field-label">
        Member products
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products to add…" />
      </label>
      {candidates.length > 0 && (
        <div className="th-card" style={{ padding: 'var(--th-space-8)', marginTop: 4 }}>
          {candidates.map((c) => (
            <button
              key={c.id}
              className="th-btn"
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
              onClick={() => {
                onChange([...picked, c]);
                setQ('');
                setCandidates([]);
              }}
            >
              {c.name} <span className="muted">/{c.slug}{c.vendor ? ` · ${c.vendor.name}` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {picked.map((p) => (
            <span key={p.id} className="th-card" style={{ padding: '2px 8px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {p.name}
              <button className="th-btn" style={{ padding: '0 6px' }} onClick={() => onChange(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupDetailPanel({ groupId, onChanged }: { groupId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [merged, setMerged] = useState<MergedVariant[]>([]);
  const [drift, setDrift] = useState<DriftFinding[]>([]);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    // Truly parallel (audit #8: awaiting each fetch inside the array literal
    // serialized them — 3× latency for nothing).
    const [resD, resR, resF] = await Promise.all([
      fetch(`${BASE_PATH}/api/clusters/${groupId}`),
      fetch(`${BASE_PATH}/api/clusters/${groupId}/resolve`),
      fetch(`${BASE_PATH}/api/clusters/${groupId}/drift`),
    ]);
    const [d, r, f] = (await Promise.all([jsonOrThrow(resD), jsonOrThrow(resR), jsonOrThrow(resF)])) as [
      GroupDetail,
      { variants: MergedVariant[] },
      DriftFinding[],
    ];
    if (seq !== loadSeq.current) return;
    setDetail(d);
    setMerged(r.variants);
    setDrift(f);
  }, [groupId]);

  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, [load]);

  const setPrimary = async (productId: string | null) => {
    setError('');
    try {
      await jsonOrThrow(
        await fetch(`${BASE_PATH}/api/clusters/${groupId}/primary`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId }),
        }),
      );
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  if (!detail) {
    return (
      <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
        {error ? <div className="notice">{error}</div> : <span className="muted">Loading…</span>}
      </div>
    );
  }

  return (
    <div className="th-card" style={{ padding: 'var(--th-space-20)', display: 'grid', gap: 'var(--th-space-16)' }}>
      {error && <div className="notice">{error}</div>}

      <div>
        <strong>{detail.name} — members</strong>
        <table style={{ width: '100%', marginTop: 'var(--th-space-8)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Product</th>
              <th style={{ textAlign: 'left' }}>Vendor</th>
              <th style={{ textAlign: 'left' }}>Variants</th>
              <th style={{ textAlign: 'left' }}>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => (
              <tr key={m.productId}>
                <td>
                  {m.name} <span className="muted">/{m.slug}</span>
                </td>
                <td className="muted">{m.vendor?.name ?? '—'}</td>
                <td>{m.variantCount}</td>
                <td>{m.isPrimary ? <strong>primary{detail.primaryIsExplicit ? '' : ' (auto)'}</strong> : <span className="muted">source</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {!m.isPrimary && (
                    <button className="th-btn" onClick={() => void setPrimary(m.productId)}>
                      Make primary
                    </button>
                  )}
                  {m.isPrimary && detail.primaryIsExplicit && (
                    <button className="th-btn" onClick={() => void setPrimary(null)}>
                      Clear override
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drift.length > 0 && (
        <div>
          <strong style={{ color: 'var(--th-warn, #b45309)' }}>Drift</strong>
          <ul style={{ margin: 'var(--th-space-8) 0 0', paddingLeft: 20 }}>
            {drift.map((f) => (
              <li key={f.productId}>
                {f.productName}:{' '}
                {f.missing.length > 0 && (
                  <span>
                    missing <code>{f.missing.join(', ')}</code>
                  </span>
                )}
                {f.missing.length > 0 && f.extra.length > 0 ? ' · ' : ''}
                {f.extra.length > 0 && (
                  <span>
                    only member with <code>{f.extra.join(', ')}</code>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <strong>Merged variants — what the customer sees</strong>
        {merged.length === 0 ? (
          <p className="muted">No variants across this group yet.</p>
        ) : (
          <table style={{ width: '100%', marginTop: 'var(--th-space-8)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Combo</th>
                <th style={{ textAlign: 'left' }}>SKU</th>
                <th style={{ textAlign: 'left' }}>Price</th>
                <th style={{ textAlign: 'left' }}>Stock</th>
                <th style={{ textAlign: 'left' }}>Routed to</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((v) => (
                <tr key={v.variantId}>
                  <td>{[v.color, v.size].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="muted">{v.sku ?? '—'}</td>
                  <td>{money(v.price)}</td>
                  <td>{v.inStock ? v.available : <span style={{ color: 'var(--th-warn, #b45309)' }}>out</span>}</td>
                  <td className="muted">
                    {v.sourceProductName}
                    {v.sourceVendor ? ` · ${v.sourceVendor.name}` : ''}
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
