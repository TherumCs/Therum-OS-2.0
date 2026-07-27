'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

// Shared save-on-change controls for the generic Settings domains (Admin
// Dock, Login, Performance, Editor Defaults, Uploads, Notifications,
// Backup) — matches 1.9.44's Quick-Controls UX: toggles/selects save
// instantly, no page-level submit button. Each control PATCHes its one
// field through the generic /api/settings/[domain] proxy.
async function save(domain: string, field: string, value: unknown): Promise<void> {
  await fetch(`${BASE_PATH}/api/settings/${domain}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [field]: value }),
  });
}

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <div className="field-label">{label}</div>
      {children}
      {help && <p className="field-help">{help}</p>}
    </div>
  );
}

export function Toggle({ domain, field, initial }: { domain: string; field: string; initial: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(): Promise<void> {
    const next = !checked;
    setChecked(next);
    setBusy(true);
    try {
      await save(domain, field, next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="th-switch">
      <input type="checkbox" checked={checked} disabled={busy} onChange={() => void toggle()} />
      <span className="th-switch-track" />
    </label>
  );
}

export function SelectField({
  domain,
  field,
  initial,
  options,
}: {
  domain: string;
  field: string;
  initial: string;
  options: [string, string][];
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function change(next: string): Promise<void> {
    setValue(next);
    setBusy(true);
    try {
      await save(domain, field, next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select className="settings-select" value={value} disabled={busy} onChange={(e) => void change(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  domain,
  field,
  initial,
  placeholder,
  type = 'text',
}: {
  domain: string;
  field: string;
  initial: string;
  placeholder?: string;
  type?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function commit(): Promise<void> {
    if (value === initial) return;
    setBusy(true);
    try {
      await save(domain, field, value);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      type={type}
      className="settings-text-input"
      value={value}
      placeholder={placeholder}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
    />
  );
}

export function NumberInput({ domain, field, initial }: { domain: string; field: string; initial: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(initial));
  const [busy, setBusy] = useState(false);

  async function commit(): Promise<void> {
    const n = Number(value);
    if (!Number.isFinite(n) || n === initial) return;
    setBusy(true);
    try {
      await save(domain, field, n);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      type="number"
      className="settings-text-input settings-text-input-narrow"
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
    />
  );
}

// Takes the endpoint to POST to (not a callback) — the caller is usually a
// Server Component page, which can't hand a browser-side closure across the
// server/client boundary. This does the fetch itself instead.
export function ActionButton({
  label,
  endpoint,
  confirmMessage,
  successMessage = 'Done.',
}: {
  label: string;
  endpoint: string;
  confirmMessage?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}${endpoint}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setResult(body?.message ?? successMessage);
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy ? 'Working…' : label}
      </button>
      {result && (
        <span className="muted" style={{ fontSize: 'var(--th-fs-xs)' }}>
          {result}
        </span>
      )}
    </div>
  );
}
