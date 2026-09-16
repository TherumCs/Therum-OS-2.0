'use client';

import { useState } from 'react';
import { BASE_PATH } from '../../../lib/session';
import { api } from './MarketingClient';

export interface AutomationRow {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  channel: string;
  subject: string;
  trigger: { event?: string; delayMinutes?: number; days?: number; coupon?: { enabled: boolean; percent: number; expiresDays: number } | null; repeatAfterDays?: number };
  sentCount: number;
  openCount: number;
  clickCount: number;
  updatedAt: string;
}

const WHEN: Record<string, (t: AutomationRow['trigger']) => string> = {
  signup: (t) => `When someone subscribes on the site${t.delayMinutes ? ` · ${t.delayMinutes} min later` : ''}${t.coupon?.enabled ? ` · ${t.coupon.percent}% code, ${t.coupon.expiresDays} days` : ''}`,
  cart_abandoned: () => 'When a cart sits untouched for 2+ hours (nightly sweep)',
  order_delivered: () => 'A few days after an order is delivered (nightly sweep)',
  no_order_days: (t) => `No order in ${t.days ?? 90} days (nightly sweep)`,
};

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export function AutomationsTab({ initial }: { initial: AutomationRow[] }) {
  const [rows, setRows] = useState<AutomationRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = async (r: AutomationRow) => {
    setBusy(true);
    setError('');
    try {
      const u = (await api.send('PATCH', `automations/${r.id}`, { enabled: !r.enabled })) as { enabled: boolean };
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: u.enabled } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <span className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
        Emails the store sends on its own when something happens. Each one is written in the same composer as a campaign; switch it on when the copy is right. While an
        automation is off, the abandoned-cart and review asks fall back to the built-in versions.
      </span>
      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Automation</th>
            <th>Fires</th>
            <th style={{ textAlign: 'right' }}>Sent</th>
            <th style={{ textAlign: 'right' }}>Opened</th>
            <th style={{ textAlign: 'right' }}>Clicked</th>
            <th>On</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={`${BASE_PATH}/marketing/automations/${r.id}`} style={{ fontWeight: 600 }}>
                  {r.name}
                </a>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>{r.subject}</div>
              </td>
              <td style={{ fontSize: 'var(--th-fs-2xs)' }}>{(WHEN[r.trigger?.event ?? ''] ?? (() => '—'))(r.trigger ?? {})}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.sentCount}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.openCount, r.sentCount)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.clickCount, r.sentCount)}</td>
              <td>
                <button className={'th-btn th-btn--xs' + (r.enabled ? ' th-btn-primary' : '')} onClick={() => void toggle(r)} disabled={busy} title={r.enabled ? 'Switch off' : 'Switch on'}>
                  {r.enabled ? 'On' : 'Off'}
                </button>
              </td>
              <td style={{ textAlign: 'right' }}>
                <a className="th-btn th-btn--xs" href={`${BASE_PATH}/marketing/automations/${r.id}`}>
                  Edit
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
