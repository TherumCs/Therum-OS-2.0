'use client';

import { useMemo, useState } from 'react';
import { api, type ListRow, type StatsRow, type SubscriberRow } from './MarketingClient';

const STATUS_PILL: Record<string, string> = { subscribed: 'pill pill-ok', unsubscribed: 'pill pill-failed', pending: 'pill pill-pending', bounced: 'pill pill-failed' };

const SOURCE_LABEL: Record<string, string> = {
  footer: 'Site footer',
  popup: 'Popup',
  embed: 'Embed',
  checkout: 'Checkout',
  customer: 'Customer',
  import: 'Import',
  manual: 'Added by hand',
  'coming-soon': 'Coming soon',
  unsubscribe: 'Opted out',
};

export function SubscribersTab({ initial, initialCursor, lists, stats }: { initial: SubscriberRow[]; initialCursor: string | null; lists: ListRow[]; stats: StatsRow | null }) {
  const [rows, setRows] = useState<SubscriberRow[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'none' | 'add' | 'import'>('none');
  const [add, setAdd] = useState({ email: '', firstName: '', lastName: '', phone: '', listIds: [] as string[] });
  const [csv, setCsv] = useState('');
  const [importLists, setImportLists] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ firstName: '', lastName: '', phone: '', tags: '', listIds: [] as string[] });

  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (listId && !r.listIds.includes(listId)) return false;
      if (!s) return true;
      return [r.email, r.firstName, r.lastName, r.phone, ...r.tags].some((v) => (v || '').toLowerCase().includes(s));
    });
  }, [rows, q, status, listId]);

  const patch = (id: string, next: Partial<SubscriberRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${label}.`);
    }
    setBusy(false);
  };

  const loadMore = () =>
    run('load more', async () => {
      const r = (await api.get(`subscribers?limit=200&cursor=${encodeURIComponent(cursor || '')}`)) as { items: SubscriberRow[]; nextCursor: string | null };
      setRows((rs) => [...rs, ...r.items]);
      setCursor(r.nextCursor);
    });

  const createOne = () =>
    run('add the subscriber', async () => {
      const row = (await api.send('POST', 'subscribers', {
        email: add.email,
        firstName: add.firstName || null,
        lastName: add.lastName || null,
        phone: add.phone || null,
        listIds: add.listIds.length ? add.listIds : undefined,
      })) as SubscriberRow;
      const withLists = { ...row, listIds: add.listIds.length ? add.listIds : lists.filter((l) => l.slug === 'newsletter').map((l) => l.id) };
      setRows((rs) => [withLists, ...rs.filter((r) => r.id !== row.id)]);
      setAdd({ email: '', firstName: '', lastName: '', phone: '', listIds: [] });
      setPanel('none');
      setNotice(`${row.email} added.`);
    });

  const runImport = () =>
    run('import', async () => {
      const r = (await api.send('POST', 'subscribers/import', { csv, listIds: importLists.length ? importLists : undefined })) as { added: number; existing: number; skipped: number; total: number };
      setNotice(`Imported ${r.added} new, ${r.existing} already on file, ${r.skipped} skipped (of ${r.total}). Reload to see them all.`);
      setCsv('');
      setPanel('none');
      const fresh = (await api.get('subscribers?limit=200')) as { items: SubscriberRow[]; nextCursor: string | null };
      setRows(fresh.items);
      setCursor(fresh.nextCursor);
    });

  const syncCustomers = () =>
    run('sync customers', async () => {
      const r = (await api.send('POST', 'sync-customers')) as { scanned: number; added: number; linked: number };
      setNotice(`Customers synced: ${r.scanned} eligible, ${r.added} new subscribers, ${r.linked} already on file.`);
      const fresh = (await api.get('subscribers?limit=200')) as { items: SubscriberRow[]; nextCursor: string | null };
      setRows(fresh.items);
      setCursor(fresh.nextCursor);
    });

  const setStatusOf = (r: SubscriberRow, next: string) =>
    run('update', async () => {
      const row = (await api.send('PATCH', `subscribers/${r.id}`, { status: next })) as SubscriberRow;
      patch(r.id, { status: row.status, unsubscribedAt: row.unsubscribedAt, subscribedAt: row.subscribedAt });
    });

  const saveEdit = (id: string) =>
    run('save', async () => {
      const row = (await api.send('PATCH', `subscribers/${id}`, {
        firstName: edit.firstName || null,
        lastName: edit.lastName || null,
        phone: edit.phone || null,
        tags: edit.tags.split(',').map((t) => t.trim()).filter(Boolean),
        listIds: edit.listIds,
      })) as SubscriberRow;
      patch(id, { firstName: row.firstName, lastName: row.lastName, phone: row.phone, tags: row.tags, listIds: edit.listIds });
      setEditId(null);
    });

  const remove = (r: SubscriberRow) => {
    if (!window.confirm(`Remove ${r.email} entirely? To stop mailing them without losing the record, mark them unsubscribed instead.`)) return;
    void run('remove', async () => {
      await api.send('DELETE', `subscribers/${r.id}`);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    });
  };

  const toggleIn = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const ListPicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {lists.map((l) => (
        <label key={l.id} className={'pill' + (value.includes(l.id) ? ' pill-ok' : '')} style={{ cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={value.includes(l.id)} onChange={() => onChange(toggleIn(value, l.id))} style={{ display: 'none' }} />
          {l.name}
        </label>
      ))}
      {lists.length === 0 && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Goes on Newsletter.</span>}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {[
            ['Subscribed', stats.subscribed],
            ['Opted out', stats.unsubscribed],
            ['New · 30 days', stats.last30],
            ['SMS consent', stats.sms],
            ['Lists', stats.lists],
          ].map(([k, v]) => (
            <div key={k} className="th-card" style={{ padding: '12px 14px' }}>
              <div className="th-card-label">{k}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="Search email, name, phone, tag…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
          <option value="">Any status</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Opted out</option>
          <option value="pending">Pending</option>
          <option value="bounced">Bounced</option>
        </select>
        <select value={listId} onChange={(e) => setListId(e.target.value)} style={{ width: 180 }}>
          <option value="">Any list</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.members})
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button className="th-btn" onClick={() => void syncCustomers()} disabled={busy} title="Mirror engaged customers (verified account or an order here) into the Customers list. Never revives an opt-out.">
          Sync customers
        </button>
        <button className="th-btn" onClick={() => setPanel(panel === 'import' ? 'none' : 'import')} disabled={busy}>
          Import
        </button>
        <button className="th-btn th-btn-primary" onClick={() => setPanel(panel === 'add' ? 'none' : 'add')} disabled={busy}>
          Add subscriber
        </button>
      </div>

      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}
      {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}

      {panel === 'add' && (
        <div className="th-card" style={{ padding: 'var(--th-space-16)', display: 'grid', gap: 10 }}>
          <div className="th-card-label">Add a subscriber by hand</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Email" type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} style={{ maxWidth: 260 }} />
            <input placeholder="First" value={add.firstName} onChange={(e) => setAdd({ ...add, firstName: e.target.value })} style={{ width: 120 }} />
            <input placeholder="Last" value={add.lastName} onChange={(e) => setAdd({ ...add, lastName: e.target.value })} style={{ width: 120 }} />
            <input placeholder="Phone (for SMS)" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} style={{ width: 160 }} />
          </div>
          <ListPicker value={add.listIds} onChange={(v) => setAdd({ ...add, listIds: v })} />
          <div>
            <button className="th-btn th-btn-primary" onClick={() => void createOne()} disabled={busy || !add.email.includes('@')}>
              Add
            </button>
          </div>
        </div>
      )}

      {panel === 'import' && (
        <div className="th-card" style={{ padding: 'var(--th-space-16)', display: 'grid', gap: 10 }}>
          <div className="th-card-label">Import — paste a CSV</div>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--th-fs-sm)' }}>
            One address per line. A header row is optional; columns can be <code>email, first, last, phone</code> in any order. Existing addresses
            are kept as they are (never re-subscribed if they opted out).
          </p>
          <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'email,first,last\njane@example.com,Jane,Doe'} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
          <ListPicker value={importLists} onChange={setImportLists} />
          <div>
            <button className="th-btn th-btn-primary" onClick={() => void runImport()} disabled={busy || !csv.includes('@')}>
              Import
            </button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Subscriber</th>
            <th>Status</th>
            <th>Lists</th>
            <th>Tags</th>
            <th>Source</th>
            <th>Since</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                {rows.length === 0 ? 'No subscribers yet. Footer signups on the site land here automatically.' : 'Nothing matches that filter.'}
              </td>
            </tr>
          )}
          {filtered.map((r) => {
            const editing = editId === r.id;
            const name = [r.firstName, r.lastName].filter(Boolean).join(' ');
            return (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.email}</div>
                  {editing ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} placeholder="First" style={{ width: 90 }} />
                      <input value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} placeholder="Last" style={{ width: 90 }} />
                      <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="Phone" style={{ width: 130 }} />
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                      {name || '—'}
                      {r.phone ? ` · ${r.phone}` : ''}
                      {r.customerId ? ' · customer' : ''}
                    </div>
                  )}
                </td>
                <td>
                  <span className={STATUS_PILL[r.status] || 'pill'}>{r.status === 'unsubscribed' ? 'opted out' : r.status}</span>
                  {r.smsStatus === 'subscribed' && <span className="pill" style={{ marginLeft: 4 }}>SMS</span>}
                </td>
                <td>
                  {editing ? (
                    <ListPicker value={edit.listIds} onChange={(v) => setEdit({ ...edit, listIds: v })} />
                  ) : (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.listIds.map((id) => (
                        <span key={id} className="pill">
                          {listName.get(id) || '…'}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {editing ? (
                    <input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder="vip, sixers" style={{ width: 140 }} />
                  ) : (
                    <span className={r.tags.length ? '' : 'muted'} style={{ fontSize: 'var(--th-fs-2xs)' }}>{r.tags.join(', ') || '—'}</span>
                  )}
                </td>
                <td style={{ fontSize: 'var(--th-fs-2xs)' }}>{SOURCE_LABEL[r.source] || r.source}</td>
                <td style={{ fontSize: 'var(--th-fs-2xs)', whiteSpace: 'nowrap' }}>{new Date(r.subscribedAt).toLocaleDateString()}</td>
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
                    <>
                      <button
                        className="th-btn th-btn--xs"
                        onClick={() => {
                          setEditId(r.id);
                          setEdit({ firstName: r.firstName || '', lastName: r.lastName || '', phone: r.phone || '', tags: r.tags.join(', '), listIds: r.listIds });
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>{' '}
                      {r.status === 'subscribed' ? (
                        <button className="th-btn th-btn--xs" onClick={() => void setStatusOf(r, 'unsubscribed')} disabled={busy}>
                          Opt out
                        </button>
                      ) : (
                        <button className="th-btn th-btn--xs" onClick={() => void setStatusOf(r, 'subscribed')} disabled={busy}>
                          Re-subscribe
                        </button>
                      )}{' '}
                      <button className="th-btn th-btn--xs th-btn--danger" onClick={() => remove(r)} disabled={busy}>
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cursor && (
        <div>
          <button className="th-btn" onClick={() => void loadMore()} disabled={busy}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
