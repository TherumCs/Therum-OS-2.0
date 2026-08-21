'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BASE_PATH } from '../../../lib/session';

// The one rule that outranks every discount on this page.
//
// A percentage off RETAIL says nothing about whether the sale still makes
// money: 40% off is comfortable on a 4x markup and under water on a 1.6x one,
// and which is which is per product. So rather than asking a merchant to work
// out per-campaign whether a number is safe, every discount — coupon, sale or
// Milieus member price — is clamped against each product's own recorded cost.
//
// It lives above the tabs because it constrains all of them.
export function MarginFloor({ initial }: { initial: number }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const dirty = value !== initial;

  async function save(): Promise<void> {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${BASE_PATH}/api/settings/commerce`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minMarginPct: value }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setMsg('Saved.');
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    }
    setBusy(false);
  }

  return (
    <div className="th-card" style={{ padding: 'var(--th-space-20)' }}>
      <div className="row-between">
        <strong>Margin floor</strong>
        <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
          {value === 0 ? 'Off' : `Never sell below cost + ${value}%`}
        </span>
      </div>
      <p className="th-about-sub">
        Applies to every discount on this page and to Milieus member pricing. A discount that would push an order under
        this line is reduced to whatever the margin allows, rather than refused — the shopper still gets the best price
        that works. Products with no recorded cost are never clamped: guessing a cost would be worse than not guarding.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--th-space-10)', flexWrap: 'wrap' }}>
        {[0, 10, 20, 25, 30, 40].map((n) => (
          <button
            key={n}
            type="button"
            className={'th-preset' + (value === n ? ' on' : '')}
            onClick={() => setValue(n)}
          >
            {n === 0 ? 'Off' : `${n}%`}
          </button>
        ))}
        <span className="th-presets__custom">
          <input
            type="number"
            min={0}
            max={95}
            value={value}
            aria-label="Minimum margin percent"
            onChange={(e) => setValue(Math.min(95, Math.max(0, Math.round(Number(e.target.value) || 0))))}
          />
          <span className="th-presets__suffix">% over cost</span>
        </span>
        <button className="th-btn th-btn-primary" onClick={() => void save()} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>{msg}</span>}
      </div>
    </div>
  );
}
