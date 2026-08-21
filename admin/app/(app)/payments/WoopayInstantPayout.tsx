'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from './format';

// The one control on the Payments screens that MOVES money: an instant payout
// of the instant-eligible balance to the linked debit card, for a fee. It is
// deliberately its own island with a confirm step — a screen that lists money
// must never be the screen that moves it by accident, the same posture the
// read side (stripePayments.ts) takes.
//
// When the account is not instant-eligible the button is shown DISABLED with
// the reason, never hidden: an operator who cannot find the control assumes it
// is broken, where a greyed-out one reading "standard deposits only on this
// account" tells them exactly why. The write itself is a Server Action handed
// down from the page (Counter → engine over the bridge); this island only
// gathers intent and reports the result.

export function WoopayInstantPayout({
  instantAvailable,
  currency,
  eligible,
  reason,
  feePct,
  onPayout,
}: {
  instantAvailable: number;
  currency: string;
  eligible: boolean;
  reason?: string | null;
  feePct?: number | null;
  onPayout: (currency: string) => Promise<{ error?: string } | void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasFunds = instantAvailable > 0;
  const disabled = !eligible || !hasFunds || pending;
  const why = !eligible
    ? reason || 'This account is not eligible for instant payouts yet.'
    : !hasFunds
      ? 'No instant-eligible balance to pay out right now.'
      : null;

  function run(): void {
    setMsg(null);
    setErr(null);
    const feeNote = feePct ? ` A ${feePct}% instant-payout fee applies.` : '';
    if (!window.confirm(`Pay out ${money(instantAvailable)} to your debit card now?${feeNote}`)) return;
    start(async () => {
      try {
        const res = await onPayout(currency);
        if (res && 'error' in res && res.error) throw new Error(res.error);
        setMsg('Instant payout requested — it should reach your card within minutes.');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'The payout could not be started.');
      }
    });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
      <button type="button" className="th-btn th-btn-primary" disabled={disabled} onClick={run}>
        {pending ? 'Requesting…' : `Instant payout${hasFunds ? ` · ${money(instantAvailable)}` : ''}`}
      </button>
      {why && <span className="muted" style={{ fontSize: 'var(--th-fs-xs)' }}>{why}</span>}
      {msg && <span style={{ color: 'var(--th-accent)', fontSize: 'var(--th-fs-xs)' }}>{msg}</span>}
      {err && <span style={{ color: 'var(--th-danger)', fontSize: 'var(--th-fs-xs)' }}>{err}</span>}
    </div>
  );
}
