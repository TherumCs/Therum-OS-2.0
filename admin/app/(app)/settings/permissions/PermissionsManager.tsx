'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../../lib/session';

interface Bundle {
  value: string;
  label: string;
}
interface Role {
  id: string;
  name: string;
  bundles: string[];
  _count: { users: number };
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${BASE_PATH}/api${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts?.headers ?? {}) },
  });
}

function BundleChips({ values, bundles }: { values: string[]; bundles: Bundle[] }) {
  if (values.length === 0) return <span className="muted" style={{ fontSize: 'var(--th-fs-xs)' }}>No bundles — this role can log in but do nothing else.</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--th-space-6)' }}>
      {values.map((v) => (
        <span
          key={v}
          style={{
            fontSize: 'var(--th-fs-2xs)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--th-accent-tint)',
            color: 'var(--th-accent)',
            border: '1px solid var(--th-accent-border)',
          }}
        >
          {bundles.find((b) => b.value === v)?.label ?? v}
        </span>
      ))}
    </div>
  );
}

function RoleFormModal({
  bundles,
  initial,
  onClose,
  onSaved,
}: {
  bundles: Bundle[];
  initial: Role | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.bundles ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleBundle(value: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, bundles: Array.from(selected) };
      const res = initial ? await api(`/roles/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : await api('/roles', { method: 'POST', body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not save this role.');
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="th-modal-backdrop" onClick={onClose}>
      <div className="th-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="th-modal-header">
          <h2>{initial ? 'Edit role' : 'New role'}</h2>
          <button type="button" className="th-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="th-modal-body">
            <div className="settings-field">
              <div className="field-label">Name</div>
              <input className="settings-text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Editor" required maxLength={60} autoFocus />
            </div>
            <div className="settings-field">
              <div className="field-label">Capability bundles</div>
              <p className="field-help" style={{ marginTop: 0 }}>
                What this role can do. Composable — pick any combination.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-8)' }}>
                {bundles.map((b) => (
                  <label key={b.value} style={{ display: 'flex', alignItems: 'center', gap: 'var(--th-space-8)', fontSize: 'var(--th-fs-sm)' }}>
                    <input type="checkbox" checked={selected.has(b.value)} onChange={() => toggleBundle(b.value)} />
                    {b.label}
                  </label>
                ))}
              </div>
            </div>
            {error && (
              <div className="notice" style={{ padding: 'var(--th-space-8) var(--th-space-10)', fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--th-space-8)', padding: 'var(--th-space-16) var(--th-space-20)', borderTop: '1px solid var(--th-line)' }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Create role'}
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PermissionsManager({ roles, bundles, userCount }: { roles: Role[]; bundles: Bundle[]; userCount: number }) {
  const router = useRouter();
  const [formTarget, setFormTarget] = useState<'new' | Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSaved(): void {
    setFormTarget(null);
    router.refresh();
  }

  async function handleDelete(role: Role): Promise<void> {
    if (!window.confirm(`Delete "${role.name}"? This can't be undone.`)) return;
    setError(null);
    const res = await api(`/roles/${role.id}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) {
      setError(data?.error?.message ?? 'Could not delete this role.');
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="settings-group">
        <h3 className="settings-group-title">Roles</h3>
        <p className="settings-group-desc">
          Every account not assigned one of these is a full administrator, unaffected by anything below. {userCount} account{userCount === 1 ? '' : 's'} total —
          assign a role from the Users page.
        </p>
        {error && (
          <div className="notice" style={{ padding: 'var(--th-space-8) var(--th-space-10)', fontSize: 12, marginBottom: 'var(--th-space-12)' }}>
            {error}
          </div>
        )}
        {roles.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>No custom roles yet — every account is a full administrator.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-12)' }}>
            {roles.map((role) => (
              <div key={role.id} className="card" style={{ padding: 'var(--th-space-14) var(--th-space-16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--th-space-12)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--th-space-8)', marginBottom: 'var(--th-space-6)' }}>
                      <strong>{role.name}</strong>
                      <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                        {role._count.users} account{role._count.users === 1 ? '' : 's'}
                      </span>
                    </div>
                    <BundleChips values={role.bundles} bundles={bundles} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--th-space-6)', flexShrink: 0 }}>
                    <button type="button" className="ghost" onClick={() => setFormTarget(role)}>
                      Edit
                    </button>
                    <button type="button" className="ghost" onClick={() => void handleDelete(role)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setFormTarget('new')} style={{ marginTop: 'var(--th-space-14)' }}>
          + New role
        </button>
      </div>

      {formTarget && <RoleFormModal bundles={bundles} initial={formTarget === 'new' ? null : formTarget} onClose={() => setFormTarget(null)} onSaved={handleSaved} />}
    </div>
  );
}
