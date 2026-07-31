'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

// Appearance saves per-field the moment you change it, like every Settings
// domain does. The page used to be a single <form method="post"> whose
// handler redirected to /settings/appearance — a route that does not exist,
// so pressing Save landed on a 404 and the change looked like it never took.
// There is no submit button now; there is nothing to forget to press.

async function save(field: string, value: unknown): Promise<void> {
  const res = await fetch(`${BASE_PATH}/api/settings/appearance`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [field]: value }),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
}

/** Shared save + error plumbing for every control below. */
function useSaver(field: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (value: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await save(field, value);
      // Re-render the server components so the chrome picks the change up
      // immediately — appearance is applied via data-attributes on the shell.
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, commit };
}

// Same markup and classes as the Settings pages' own ToggleRow, so a control
// here is indistinguishable from one there.
export function AppRow({
  label,
  help,
  children,
  error,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        {help && <span className="settings-toggle-row-desc">{help}</span>}
        {error && <span className="th-ap-row-error">{error}</span>}
      </div>
      {children}
    </div>
  );
}

/** Segmented picker — the right control for 2–4 mutually exclusive values. */
export function Segmented({
  label,
  help,
  field,
  initial,
  options,
}: {
  label: string;
  help?: string;
  field: string;
  initial: string;
  options: [string, string][];
}) {
  const { busy, error, commit } = useSaver(field);
  const [value, setValue] = useState(initial);

  return (
    <AppRow label={label} help={help} error={error}>
      <div className="th-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            className={'th-seg-btn' + (value === v ? ' active' : '')}
            disabled={busy}
            aria-pressed={value === v}
            onClick={async () => {
              const prev = value;
              setValue(v);
              // Snap back if the server rejected it, so the UI never shows a
              // selection that was not actually stored.
              if (!(await commit(v))) setValue(prev);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </AppRow>
  );
}

/** Dropdown — for lists too long to segment (fonts). */
export function Choice({
  label,
  help,
  field,
  initial,
  options,
}: {
  label: string;
  help?: string;
  field: string;
  initial: string;
  options: [string, string][];
}) {
  const { busy, error, commit } = useSaver(field);
  const [value, setValue] = useState(initial);

  return (
    <AppRow label={label} help={help} error={error}>
      <select
        className="settings-select th-ap-select"
        value={value}
        disabled={busy}
        onChange={async (e) => {
          const prev = value;
          const next = e.target.value;
          setValue(next);
          if (!(await commit(next))) setValue(prev);
        }}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </AppRow>
  );
}

export function Switch({
  label,
  help,
  field,
  initial,
}: {
  label: string;
  help?: string;
  field: string;
  initial: boolean;
}) {
  const { busy, error, commit } = useSaver(field);
  const [checked, setChecked] = useState(initial);

  return (
    <AppRow label={label} help={help} error={error}>
      <label className="th-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={async () => {
            const next = !checked;
            setChecked(next);
            if (!(await commit(next))) setChecked(!next);
          }}
        />
        <span className="th-switch-track" />
      </label>
    </AppRow>
  );
}

/** Colour with a "use the theme's own" empty state — the accent picker
    treats '' as "inherit", which a plain colour input can't express. */
export function ColorField({
  label,
  help,
  field,
  initial,
  fallback,
}: {
  label: string;
  help?: string;
  field: string;
  initial: string;
  fallback: string;
}) {
  const { busy, error, commit } = useSaver(field);
  const [value, setValue] = useState(initial);

  return (
    <AppRow label={label} help={help} error={error}>
      <div className="th-ap-color">
        <input
          type="color"
          className="th-ap-color-input"
          value={value || fallback}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit(value)}
        />
        <code className="th-ap-color-value">{value || 'theme default'}</code>
        {value && (
          <button
            type="button"
            className="th-ap-reset"
            disabled={busy}
            onClick={async () => {
              setValue('');
              await commit('');
            }}
          >
            Reset
          </button>
        )}
      </div>
    </AppRow>
  );
}

export function Stepper({
  label,
  help,
  field,
  initial,
  min,
  max,
  step = 1,
}: {
  label: string;
  help?: string;
  field: string;
  initial: number;
  min: number;
  max: number;
  step?: number;
}) {
  const { busy, error, commit } = useSaver(field);
  const [value, setValue] = useState(initial);

  return (
    <AppRow label={label} help={help} error={error}>
      <div className="th-ap-stepper">
        <input
          type="range"
          className="th-density-slider"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={() => void commit(value)}
          onKeyUp={() => void commit(value)}
        />
        <span className="th-ap-stepper-value">{value}</span>
      </div>
    </AppRow>
  );
}
