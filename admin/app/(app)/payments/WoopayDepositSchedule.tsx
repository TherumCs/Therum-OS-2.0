'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// WooPayments deposit cadence — how often the cleared balance is sent to the
// bank. Daily, weekly on a chosen weekday, or monthly on a chosen day. Stripe
// only settles on business days, so the weekly anchor is Mon–Fri. When the
// account's schedule is owned by the platform (canManage=false) the control
// steps back and just states the current cadence rather than offering a change
// that the engine would reject. The save is a Server Action handed down from
// the page (PUT /deposit-schedule over the bridge).

const WEEKDAYS: [string, string][] = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
];

export function WoopayDepositSchedule({
  interval,
  weeklyAnchor,
  monthlyAnchor,
  delayDays,
  canManage,
  onSave,
}: {
  interval: string;
  weeklyAnchor: string | null;
  monthlyAnchor: number | null;
  delayDays: number | null;
  canManage: boolean;
  onSave: (v: { interval: string; weekly_anchor?: string; monthly_anchor?: number }) => Promise<{ error?: string } | void>;
}) {
  const router = useRouter();
  // 'manual' is a real WCPay state (you release each deposit yourself) but not
  // one this selector sets, so it falls back to daily as the editable default.
  const [iv, setIv] = useState(interval === 'weekly' || interval === 'monthly' ? interval : 'daily');
  const [wa, setWa] = useState(weeklyAnchor ?? 'monday');
  const [ma, setMa] = useState(monthlyAnchor ?? 1);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function submit(): void {
    setMsg(null);
    setErr(null);
    const payload: { interval: string; weekly_anchor?: string; monthly_anchor?: number } = { interval: iv };
    if (iv === 'weekly') payload.weekly_anchor = wa;
    if (iv === 'monthly') payload.monthly_anchor = ma;
    start(async () => {
      try {
        const res = await onSave(payload);
        if (res && 'error' in res && res.error) throw new Error(res.error);
        setMsg('Deposit schedule updated.');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not update the schedule.');
      }
    });
  }

  if (!canManage) {
    return (
      <p className="muted">
        This account&apos;s deposit schedule is set by the payment provider and cannot be changed here
        {interval ? ` — currently ${interval}` : ''}.
      </p>
    );
  }

  return (
    <div>
      <div className="settings-toggle-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="settings-toggle-row-text">
          <span className="settings-toggle-row-label">Deposit cadence</span>
          <span className="settings-toggle-row-desc">
            How often WooPayments sends your cleared balance to the bank
            {delayDays != null ? `, ${delayDays} days after each charge settles` : ''}.
          </span>
        </div>
        <select className="settings-select" value={iv} disabled={pending} onChange={(e) => setIv(e.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {iv === 'weekly' && (
        <div className="settings-toggle-row" style={{ alignItems: 'center' }}>
          <span className="settings-toggle-row-label">Payout day</span>
          <select className="settings-select" value={wa} disabled={pending} onChange={(e) => setWa(e.target.value)}>
            {WEEKDAYS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      )}

      {iv === 'monthly' && (
        <div className="settings-toggle-row" style={{ alignItems: 'center' }}>
          <span className="settings-toggle-row-label">Day of month</span>
          <select
            className="settings-select"
            value={String(ma)}
            disabled={pending}
            onChange={(e) => setMa(Number(e.target.value))}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {/* Stripe pays on the last day for any month without the chosen date. */}
            <option value={31}>Last day</option>
          </select>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="th-btn th-btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Saving…' : 'Save schedule'}
        </button>
        {msg && <span style={{ color: 'var(--th-accent)', fontSize: 'var(--th-fs-xs)' }}>{msg}</span>}
        {err && <span style={{ color: 'var(--th-danger)', fontSize: 'var(--th-fs-xs)' }}>{err}</span>}
      </div>
    </div>
  );
}
