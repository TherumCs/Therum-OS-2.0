'use client';

import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '../../../lib/session';

// The payment-methods surface — Counter's answer to WooPayments' "Payments
// accepted on checkout" screen. The backend already knew how to do all of this
// (/api/connections/stripe/methods, list + pin + per-method toggle, driven by
// stripeMethods.ts); what was missing was anywhere to SEE it. A merchant had to
// open the Stripe dashboard to turn Klarna on. Now it lives where the rest of
// the store's wiring does.
//
// One deliberate difference from WooPayments: methods this storefront cannot
// actually route (the European locals — Bancontact, iDEAL, P24…) are shown in
// their own muted group, labelled as such, rather than mixed in as if a tap
// would surface them at checkout. Turning a method "on" at Stripe that the cart
// never presents is the exact silent gap `drift` exists to catch.

interface Method {
  id: string;
  on: boolean;
  routable: boolean;
}
interface Config {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  parent: string | null;
  methods: Method[];
}
interface Drift {
  offeredButOff: string[];
  onButNotOffered: string[];
  configId: string | null;
}
interface MethodsResponse {
  configs: Config[];
  pinned: string | null;
  suggested: string | null;
  drift: Drift;
}

// Friendly names + the group each falls into, mirroring the WooPayments layout
// (Cards · Buy now pay later · Express checkout · Bank debit). Anything not
// listed here is a Stripe method the storefront does not route yet.
const META: Record<string, { label: string; blurb: string; group: string }> = {
  card: { label: 'Credit / debit cards', blurb: 'Visa, Mastercard, Amex, Discover and more.', group: 'cards' },
  us_bank_account: { label: 'US bank account', blurb: 'ACH direct debit, lower fees, slower to clear.', group: 'bank' },
  klarna: { label: 'Klarna', blurb: 'Pay over time.', group: 'bnpl' },
  affirm: { label: 'Affirm', blurb: 'Pay over time.', group: 'bnpl' },
  afterpay_clearpay: { label: 'Afterpay / Clearpay', blurb: 'Pay in four.', group: 'bnpl' },
  apple_pay: { label: 'Apple Pay', blurb: 'One-tap wallet on Apple devices.', group: 'express' },
  google_pay: { label: 'Google Pay', blurb: 'One-tap wallet on Android and Chrome.', group: 'express' },
  link: { label: 'Link', blurb: "Stripe's saved one-click checkout.", group: 'express' },
  cashapp: { label: 'Cash App Pay', blurb: 'Cash App balance and card.', group: 'express' },
};

const GROUPS: { key: string; label: string; blurb: string }[] = [
  { key: 'cards', label: 'Cards', blurb: 'The default — every store should keep this on.' },
  { key: 'express', label: 'Express checkout & wallets', blurb: 'One-tap methods shown at the top of checkout.' },
  { key: 'bnpl', label: 'Buy now, pay later', blurb: 'Split or defer payment. Stripe still pays you in full up front.' },
  { key: 'bank', label: 'Bank debit', blurb: 'Lower fees, funds take longer to settle.' },
];

function titleCase(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StripeMethods({ stripeConnected }: { stripeConnected: boolean }) {
  const [data, setData] = useState<MethodsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // methodId currently saving
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/stripe/methods`);
      const body = (await res.json().catch(() => null)) as (MethodsResponse & { error?: { message?: string } }) | null;
      if (!res.ok || !body) throw new Error(body?.error?.message ?? 'Could not read Stripe payment methods.');
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read Stripe payment methods.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stripeConnected) void load();
    else setLoading(false);
  }, [stripeConnected, load]);

  if (!stripeConnected) return null;

  // The configuration we actually manage: the pinned one if this store owns it,
  // otherwise the suggested owned one. A parent config belongs to a connected
  // platform and Stripe will not let us edit its methods.
  const owned = (data?.configs ?? []).filter((c) => !c.parent);
  const managed =
    owned.find((c) => c.id === data?.pinned) ?? owned.find((c) => c.id === data?.suggested) ?? owned[0] ?? null;
  const pinnedIsForeign = data?.pinned != null && !owned.some((c) => c.id === data.pinned);

  async function toggle(methodId: string, on: boolean) {
    if (!managed) return;
    setBusy(methodId);
    // Optimistic: flip locally so the switch responds instantly, reconcile from
    // the response (which is the full re-listed truth) or roll back on failure.
    setData((d) =>
      d
        ? { ...d, configs: d.configs.map((c) => (c.id === managed.id ? { ...c, methods: c.methods.map((m) => (m.id === methodId ? { ...m, on } : m)) } : c)) }
        : d,
    );
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/stripe/methods/${encodeURIComponent(methodId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId: managed.id, on }),
      });
      const body = (await res.json().catch(() => null)) as (Omit<MethodsResponse, 'drift'> & { error?: { message?: string } }) | null;
      if (!res.ok || !body) throw new Error(body?.error?.message ?? 'Stripe refused the change.');
      setData((d) => (d ? { ...d, configs: body.configs, pinned: body.pinned } : d));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      await load(); // reconcile against the real state
    } finally {
      setBusy(null);
    }
  }

  async function pin(configId: string) {
    setBusy('__pin');
    try {
      const res = await fetch(`${BASE_PATH}/api/connections/stripe/methods/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ configId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? 'Could not pin that configuration.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pin.');
    } finally {
      setBusy(null);
    }
  }

  const methodsById = new Map((managed?.methods ?? []).map((m) => [m.id, m]));
  const known = new Set(Object.keys(META));
  // PayPal appears on the Stripe config but is deliberately NOT a toggle here:
  // Stripe only offers PayPal to EU/UK accounts, and this store runs PayPal as
  // its own connected provider (the redirect flow) regardless. A toggle that
  // does nothing for a US account is exactly the dead control this panel exists
  // to avoid — so it is suppressed and pointed at its real home instead.
  const hasStripePaypal = (managed?.methods ?? []).some((m) => m.id === 'paypal');
  const others = (managed?.methods ?? []).filter((m) => !known.has(m.id) && m.id !== 'paypal');

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="l">Payment methods at checkout</div>
      <p className="th-about-sub">
        Turn methods on or off here instead of in the Stripe dashboard — this is the same account, so the change lands
        in both places. Only the configuration checkout actually uses is shown.
      </p>

      {loading && <p className="muted">Reading methods from Stripe…</p>}
      {error && (
        <p className="field-help" style={{ color: 'var(--th-danger, #ef4444)' }}>
          {error}
        </p>
      )}

      {!loading && !managed && !error && (
        <p className="muted">
          Stripe is connected but has no editable payment configuration on this account.
        </p>
      )}

      {managed && (
        <>
          <div className="settings-toggle-row" style={{ alignItems: 'center' }}>
            <div className="settings-toggle-row-text">
              <span className="settings-toggle-row-label">
                Active configuration: {managed.name || managed.id}
              </span>
              <span className="settings-toggle-row-desc">
                Checkout builds every payment against this set.{owned.length > 1 ? ' Switch below if you keep more than one.' : ''}
              </span>
            </div>
            {owned.length > 1 && (
              <select
                value={managed.id}
                disabled={busy === '__pin'}
                onChange={(e) => void pin(e.target.value)}
                className="th-input"
                style={{ maxWidth: 220 }}
              >
                {owned.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                    {c.id === data?.pinned ? ' (pinned)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {pinnedIsForeign && (
            <p className="field-help" style={{ color: 'var(--th-warning, #d97706)' }}>
              The pinned configuration belongs to a connected platform and cannot be edited here. Showing one this store
              owns — pin it above to make it the one checkout uses.
            </p>
          )}

          {data?.drift && (data.drift.offeredButOff.length > 0 || data.drift.onButNotOffered.length > 0) && (
            <div
              className="th-about-sub"
              style={{ border: '1px solid rgba(217,119,6,.35)', borderRadius: 10, padding: '10px 12px', margin: '4px 0 14px' }}
            >
              {data.drift.offeredButOff.length > 0 && (
                <div>
                  <strong>Shown at checkout but off at Stripe:</strong>{' '}
                  {data.drift.offeredButOff.map((m) => META[m]?.label ?? titleCase(m)).join(', ')} — shoppers will pick these and be refused. Turn them on below.
                </div>
              )}
              {data.drift.onButNotOffered.length > 0 && (
                <div>
                  <strong>On at Stripe but the storefront never shows them:</strong>{' '}
                  {data.drift.onButNotOffered.map((m) => META[m]?.label ?? titleCase(m)).join(', ')}.
                </div>
              )}
            </div>
          )}

          {GROUPS.map((g) => {
            const rows = Object.entries(META).filter(([, meta]) => meta.group === g.key).map(([id]) => id).filter((id) => methodsById.has(id));
            if (rows.length === 0) return null;
            return (
              <div key={g.key} style={{ margin: '16px 0 4px' }}>
                <div className="settings-toggle-row-label" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--th-muted)' }}>
                  {g.label}
                </div>
                <p className="th-about-sub" style={{ margin: '2px 0 8px' }}>{g.blurb}</p>
                {rows.map((id) => {
                  const m = methodsById.get(id)!;
                  const meta = META[id];
                  return (
                    <label key={id} className="settings-toggle-row" style={{ cursor: 'pointer' }}>
                      <div className="settings-toggle-row-text">
                        <span className="settings-toggle-row-label">{meta.label}</span>
                        <span className="settings-toggle-row-desc">{meta.blurb}</span>
                      </div>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={m.on}
                        disabled={busy === id || busy === '__pin'}
                        onChange={(e) => void toggle(id, e.target.checked)}
                      />
                    </label>
                  );
                })}
              </div>
            );
          })}

          {hasStripePaypal && (
            <p className="field-help" style={{ marginTop: 14 }}>
              <strong>PayPal</strong> is handled as its own provider (redirect checkout), not a Stripe method — Stripe
              offers PayPal to EU/UK accounts only. It is managed under Payments above and already appears at checkout
              when connected.
            </p>
          )}

          {others.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="settings-toggle-row-label" style={{ cursor: 'pointer', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--th-muted)' }}>
                Other Stripe methods ({others.length}) — not shown at checkout yet
              </summary>
              <p className="th-about-sub" style={{ margin: '6px 0 8px' }}>
                Stripe offers these on this account, but the storefront does not route them, so turning one on here will
                not surface it to shoppers until it is wired into checkout. Listed for visibility.
              </p>
              {others.map((m) => (
                <label key={m.id} className="settings-toggle-row" style={{ cursor: 'pointer', opacity: 0.85 }}>
                  <div className="settings-toggle-row-text">
                    <span className="settings-toggle-row-label">{titleCase(m.id)}</span>
                    <span className="settings-toggle-row-desc">Not routed by the storefront.</span>
                  </div>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={m.on}
                    disabled={busy === m.id || busy === '__pin'}
                    onChange={(e) => void toggle(m.id, e.target.checked)}
                  />
                </label>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
