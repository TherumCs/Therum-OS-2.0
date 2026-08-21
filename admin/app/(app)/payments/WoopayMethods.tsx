'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Which methods a shopper sees at checkout, on the WooPayments account. The
// engine's PUT /methods takes the FULL set of enabled ids (replace, not
// per-method toggle), so this island keeps the local enabled set and sends the
// whole list on every change. Flips optimistically and rolls the one method
// back if the engine refuses — the same feel as the direct-Stripe method
// switches (StripeMethods.tsx), driven by a Server Action instead of a route.

export function WoopayMethods({
  methods,
  onSave,
}: {
  methods: { id: string; label: string; enabled: boolean; description: string | null }[];
  onSave: (ids: string[]) => Promise<{ error?: string } | void>;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => new Map(methods.map((m) => [m.id, m.enabled])));
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string, on: boolean): void {
    setErr(null);
    const next = new Map(state);
    next.set(id, on);
    setState(next);
    const ids = [...next.entries()].filter(([, v]) => v).map(([k]) => k);
    start(async () => {
      try {
        const res = await onSave(ids);
        if (res && 'error' in res && res.error) throw new Error(res.error);
        router.refresh();
      } catch (e) {
        setState((p) => {
          const rb = new Map(p);
          rb.set(id, !on);
          return rb;
        });
        setErr(e instanceof Error ? e.message : 'Could not save that change.');
      }
    });
  }

  if (methods.length === 0) {
    return <p className="muted">No payment methods reported by the engine.</p>;
  }

  return (
    <div>
      {err && (
        <p className="field-help" style={{ color: 'var(--th-danger)' }}>
          {err}
        </p>
      )}
      {methods.map((m) => (
        <label key={m.id} className="settings-toggle-row" style={{ cursor: 'pointer' }}>
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">{m.label}</span>
            {m.description && <span className="settings-toggle-row-desc">{m.description}</span>}
          </div>
          <input
            type="checkbox"
            role="switch"
            checked={state.get(m.id) ?? false}
            disabled={pending}
            onChange={(e) => toggle(m.id, e.target.checked)}
          />
        </label>
      ))}
    </div>
  );
}
