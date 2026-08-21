'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../lib/session';

// A settings page that BATCHES its edits instead of saving on every keystroke.
//
// The rest of the admin saves per field the moment a control changes (see
// settings/SettingsControls.tsx). That is right for a toggle whose effect is
// obvious, and wrong for a page where the choices are visual and compared
// against each other: picking through five card layouts should not publish
// four of them to the live storefront on the way to the fifth.
//
// So: edits collect in memory, a bar appears the moment anything differs from
// what is saved, and one Save writes the whole diff. Discard puts it back.
// Built as a generic provider rather than baked into the Counter page — this
// is meant to become the pattern everywhere.

interface Ctx<T> {
  value: T;
  set: <K extends keyof T>(field: K, next: T[K]) => void;
  dirty: boolean;
}

const FormCtx = createContext<Ctx<Record<string, unknown>> | null>(null);

/** The bar styles itself, so its buttons do too. See the note on the bar. */
function btn(primary: boolean, off: boolean): CSSProperties {
  return {
    font: '600 12px/1 inherit', letterSpacing: '.02em', padding: '10px 16px',
    borderRadius: 8, cursor: off ? 'default' : 'pointer', opacity: off ? 0.45 : 1,
    border: primary ? '1px solid #fff' : '1px solid rgba(255,255,255,.35)',
    background: primary ? '#fff' : 'transparent',
    color: primary ? '#111' : '#fff',
  };
}

/** How long to wait after the last edit before saving on the user's behalf. */
const AUTOSAVE_MS = 1200;

export function useSettingsForm<T extends Record<string, unknown>>(): Ctx<T> {
  const ctx = useContext(FormCtx);
  if (!ctx) throw new Error('useSettingsForm must be used inside <SettingsForm>');
  return ctx as unknown as Ctx<T>;
}

export function SettingsForm<T extends Record<string, unknown>>({
  domain,
  initial,
  children,
}: {
  /** The /api/settings/<domain> key this page writes to. */
  domain: string;
  initial: T;
  children: ReactNode;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<T>(initial);
  const [value, setValue] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const set = useCallback(<K extends keyof T>(field: K, next: T[K]) => {
    setJustSaved(false);
    setValue((v) => ({ ...v, [field]: next }));
  }, []);

  // Only the fields that actually changed are sent. A settings PATCH that
  // echoes every field back would overwrite anything another tab changed
  // while this page was open.
  const diff = useMemo(() => {
    const out: Partial<T> = {};
    for (const k of Object.keys(value) as (keyof T)[]) {
      if (value[k] !== saved[k]) out[k] = value[k];
    }
    return out;
  }, [value, saved]);
  const dirty = Object.keys(diff).length > 0;

  async function save(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE_PATH}/api/settings/${domain}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const msg =
          body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
            ? String((body.error as { message: unknown }).message)
            : `Save failed (${res.status})`;
        throw new Error(msg);
      }
      setSaved(value);
      setJustSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
    setBusy(false);
  }

  // AUTOSAVE. Bam asked for both: it should save itself, and there should still
  // be a button. The debounce is what keeps the batching worth having — picking
  // through five card layouts settles on one before anything is written, rather
  // than publishing four of them to the live storefront on the way past.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || busy) return;
    const t = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, busy, value]);

  const ctx = useMemo(
    () => ({ value: value as Record<string, unknown>, set: set as Ctx<Record<string, unknown>>['set'], dirty }),
    [value, set, dirty],
  );

  return (
    <FormCtx.Provider value={ctx}>
      {children}
      {/* ALWAYS rendered, and styled INLINE.
          Two earlier versions of this bar were invisible on the page: first an
          opacity toggle that computed to 0, then a conditional mount.
          I originally blamed an unbalanced globals.css. That was WRONG — the
          file is balanced (697 braces each way), and the real reason the
          `.th-savebar` rules did not take is still not identified. What is
          certain is that the bar was interactive and unseen twice, so it no
          longer depends on the stylesheet at all: the one control that must
          never go missing carries its own styling and is always on screen,
          whether or not there is anything to save. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px 12px 20px', borderRadius: 12,
          background: '#111', color: '#fff', font: '500 13px/1.2 inherit',
          boxShadow: '0 12px 34px rgba(0,0,0,.28)', maxWidth: 'calc(100vw - 32px)',
        }}
      >
        <span style={{ whiteSpace: 'nowrap', opacity: error ? 1 : 0.8, color: error ? '#ff9c8f' : undefined }}>
          {error
            ? error
            : busy
              ? 'Saving…'
              : dirty
                ? `${Object.keys(diff).length} unsaved change${Object.keys(diff).length === 1 ? '' : 's'}`
                : justSaved
                  ? 'Saved.'
                  : 'All changes saved'}
        </span>
        <button type="button" onClick={() => { setValue(saved); setError(''); }} disabled={!dirty || busy} style={btn(false, !dirty || busy)}>
          Discard
        </button>
        {/* Never disabled. Autosave should mean you rarely need it, but when a
            save has failed or you simply want to be sure, a greyed-out Save
            button is the least useful thing on the screen. */}
        <button type="button" onClick={() => void save()} disabled={busy} style={btn(true, busy)}>
          Save
        </button>
      </div>
    </FormCtx.Provider>
  );
}
