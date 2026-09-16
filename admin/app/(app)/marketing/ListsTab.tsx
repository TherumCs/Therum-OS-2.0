'use client';

import { useState } from 'react';
import { api, type ListRow } from './MarketingClient';

export function ListsTab({ lists, onChange }: { lists: ListRow[]; onChange: (next: ListRow[]) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', description: '' });

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const row = (await api.send('POST', 'lists', { name, description: description || null })) as ListRow;
      onChange([...lists, { ...row, members: 0 }]);
      setName('');
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the list.');
    }
    setBusy(false);
  };

  const save = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const row = (await api.send('PATCH', `lists/${id}`, { name: edit.name, description: edit.description || null })) as ListRow;
      onChange(lists.map((l) => (l.id === id ? { ...l, name: row.name, description: row.description } : l)));
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };

  const remove = async (l: ListRow) => {
    if (!window.confirm(`Delete the list "${l.name}"? Subscribers stay; they just leave this list.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.send('DELETE', `lists/${l.id}`);
      onChange(lists.filter((x) => x.id !== l.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <div className="th-card" style={{ padding: 'var(--th-space-16)' }}>
        <div className="th-card-label">New list</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input placeholder="Name (e.g. VIPs, Bird Season buyers)" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 260 }} />
          <input placeholder="What this list is for (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ maxWidth: 360 }} />
          <button className="th-btn th-btn-primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            Create list
          </button>
        </div>
        {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>

      <table>
        <thead>
          <tr>
            <th>List</th>
            <th>Purpose</th>
            <th style={{ textAlign: 'right' }}>Subscribers</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lists.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No lists yet. The Newsletter list is created automatically on the first footer signup.
              </td>
            </tr>
          )}
          {lists.map((l) => {
            const editing = editId === l.id;
            return (
              <tr key={l.id}>
                <td>
                  {editing ? (
                    <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ maxWidth: 220 }} />
                  ) : (
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                  )}
                  <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>{l.slug}</div>
                </td>
                <td>
                  {editing ? (
                    <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ maxWidth: 360 }} />
                  ) : (
                    <span className={l.description ? '' : 'muted'}>{l.description || '—'}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.members}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editing ? (
                    <>
                      <button className="th-btn th-btn-primary th-btn--xs" onClick={() => void save(l.id)} disabled={busy}>
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
                          setEditId(l.id);
                          setEdit({ name: l.name, description: l.description || '' });
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>{' '}
                      {l.slug !== 'newsletter' && (
                        <button className="th-btn th-btn--xs th-btn--danger" onClick={() => void remove(l)} disabled={busy}>
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
