'use client';

import { useEffect, useState } from 'react';
import { api } from '../../MarketingClient';

export interface Trigger {
  event?: 'signup' | 'cart_abandoned' | 'order_delivered' | 'no_order_days';
  delayMinutes?: number;
  days?: number;
  repeatAfterDays?: number;
  coupon?: { enabled: boolean; percent: number; expiresDays: number; prefix: string; code?: string } | null;
}
interface Report {
  automation: { sentCount: number; openCount: number; clickCount: number };
  recent: { email: string; status: string; error: string | null; sentAt: string | null; openedAt: string | null; clickedAt: string | null; meta?: { couponCode?: string } }[];
}

const EVENT_LABEL: Record<string, string> = {
  signup: 'Someone subscribes on the site (footer, popup, embed)',
  cart_abandoned: 'A cart sits untouched 2+ hours — checked nightly',
  order_delivered: 'An order was delivered a few days ago — checked nightly',
  no_order_days: 'No order in a while — checked nightly',
};

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

// When it fires, how long it waits, how often the same person can get it,
// and (welcome only) the first-order code it mints.
export function TriggerPanel({ automationId, automationKey, initialEnabled, initialTrigger, dirty, onSaveFirst }: { automationId: string; automationKey: string; initialEnabled: boolean; initialTrigger: Trigger; dirty: boolean; onSaveFirst: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [t, setT] = useState<Trigger>({ delayMinutes: 0, repeatAfterDays: 0, ...initialTrigger, coupon: initialTrigger.coupon ?? (automationKey === 'welcome' ? { enabled: true, percent: 10, expiresDays: 14, prefix: 'WELCOME' } : null) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setReport((await api.get(`automations/${automationId}/report`)) as Report);
      } catch {
        /* best-effort */
      }
    })();
  }, [automationId]);

  const saveTrigger = async (next: Trigger) => {
    setT(next);
    setError('');
    try {
      await api.send('PATCH', `automations/${automationId}`, { trigger: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the trigger.');
    }
  };

  const toggle = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (dirty) await onSaveFirst();
      const u = (await api.send('PATCH', `automations/${automationId}`, { enabled: !enabled })) as { enabled: boolean };
      setEnabled(u.enabled);
      setNotice(u.enabled ? 'On. It fires from now on.' : 'Off. Nothing more goes out; the built-in fallback (if any) takes over.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
    setBusy(false);
  };

  const num = (v: string, min = 0) => Math.max(min, Math.round(Number(v) || 0));
  const a = report?.automation;

  return (
    <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="th-card-label">Trigger</div>
        <span style={{ flex: 1 }} />
        <button className={'th-btn th-btn--xs' + (enabled ? ' th-btn-primary' : '')} onClick={() => void toggle()} disabled={busy}>
          {enabled ? 'On' : 'Off'}
        </button>
      </div>
      <div style={{ fontSize: 'var(--th-fs-sm)' }}>{EVENT_LABEL[t.event ?? ''] ?? '—'}</div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
        {t.event === 'no_order_days' && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            after <input type="number" min={7} value={t.days ?? 90} onChange={(e) => void saveTrigger({ ...t, days: num(e.target.value, 7) })} style={{ width: 70 }} /> days without an order
          </label>
        )}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          wait <input type="number" min={0} value={t.delayMinutes ?? 0} onChange={(e) => void saveTrigger({ ...t, delayMinutes: num(e.target.value) })} style={{ width: 80 }} /> minutes before sending
        </label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          same person again after <input type="number" min={0} value={t.repeatAfterDays ?? 0} onChange={(e) => void saveTrigger({ ...t, repeatAfterDays: num(e.target.value) })} style={{ width: 70 }} /> days (0 = once ever)
        </label>
      </div>

      {automationKey === 'welcome' && (
        <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--th-border, #e7e7e7)', paddingTop: 10 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--th-fs-sm)' }}>
            <input type="checkbox" checked={!!t.coupon?.enabled} onChange={(e) => void saveTrigger({ ...t, coupon: { ...(t.coupon ?? { percent: 10, expiresDays: 14, prefix: 'WELCOME', code: 'WELCOME10' }), enabled: e.target.checked } })} /> Send a first-order code
          </label>
          {t.coupon?.enabled && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={1} max={100} value={t.coupon.percent} onChange={(e) => void saveTrigger({ ...t, coupon: { ...t.coupon!, percent: Math.min(100, num(e.target.value, 1)) } })} style={{ width: 64 }} /> % off
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                shared code <input value={t.coupon.code ?? ''} onChange={(e) => void saveTrigger({ ...t, coupon: { ...t.coupon!, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40) } })} placeholder="WELCOME10" style={{ width: 130 }} />
                <span className="muted">once per person; leave empty to mint a random single-use code each</span>
              </label>
              {!t.coupon.code && (
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                expires in <input type="number" min={1} value={t.coupon.expiresDays} onChange={(e) => void saveTrigger({ ...t, coupon: { ...t.coupon!, expiresDays: num(e.target.value, 1) } })} style={{ width: 64 }} /> days
              </label>
              )}
              {!t.coupon.code && (
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                code prefix <input value={t.coupon.prefix} onChange={(e) => void saveTrigger({ ...t, coupon: { ...t.coupon!, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) } })} style={{ width: 110 }} />
              </label>
              )}
              <span className="muted">
                Use <code>{'{{coupon_code}}'}</code> and <code>{'{{coupon_expires}}'}</code> in the copy. Jerseys stay exempt (they carry the no-discount flag).
              </span>
            </div>
          )}
        </div>
      )}

      {a && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, borderTop: '1px solid var(--th-border, #e7e7e7)', paddingTop: 10 }}>
          {[
            ['Sent', String(a.sentCount)],
            ['Opened', `${a.openCount} · ${pct(a.openCount, a.sentCount)}`],
            ['Clicked', `${a.clickCount} · ${pct(a.clickCount, a.sentCount)}`],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="th-card-label">{k}</div>
              <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {report && report.recent.length > 0 && (
        <div style={{ fontSize: 'var(--th-fs-2xs)' }}>
          <div className="th-card-label" style={{ marginBottom: 4 }}>Recent</div>
          {report.recent.slice(0, 8).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span className={'pill ' + (r.status === 'sent' ? 'pill-ok' : r.status === 'failed' ? 'pill-failed' : '')}>{r.status}</span>
              <span>{r.email}</span>
              {r.meta?.couponCode && <span className="muted">{r.meta.couponCode}</span>}
              {r.error && <span className="muted">{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}
      {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}
    </div>
  );
}
