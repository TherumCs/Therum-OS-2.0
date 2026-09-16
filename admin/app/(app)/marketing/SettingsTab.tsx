'use client';

import { useEffect, useState } from 'react';
import { api } from './MarketingClient';

export interface MarketingSettingsRow {
  weeklyDay: number;
  weeklyHour: number;
  weeklyMinute: number;
  timezone: string;
  capPerWeek: number;
  smsFrom: string;
  nextSlot: string;
}
interface SmsStatus {
  ready: boolean;
  via: string;
  from: string | null;
  reason?: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'UTC'];

// The cadence rules: one fixed weekly slot for product + brand mail, and a
// per-person cap so events and extras can float without piling up.
export function SettingsTab({ initial }: { initial: MarketingSettingsRow | null }) {
  const [s, setS] = useState<MarketingSettingsRow>(initial ?? { weeklyDay: 1, weeklyHour: 10, weeklyMinute: 0, timezone: 'America/New_York', capPerWeek: 2, smsFrom: '', nextSlot: '' });
  const [sms, setSms] = useState<SmsStatus | null>(null);
  const [fromDraft, setFromDraft] = useState(initial?.smsFrom ?? '');
  useEffect(() => {
    void (async () => {
      try {
        setSms((await api.get('sms/status')) as SmsStatus);
      } catch {
        /* status is best-effort */
      }
    })();
  }, [s.smsFrom]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const save = async (patch: Partial<MarketingSettingsRow>) => {
    const next = { ...s, ...patch };
    setS(next);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = (await api.send('PUT', 'settings', { weeklyDay: next.weeklyDay, weeklyHour: next.weeklyHour, weeklyMinute: next.weeklyMinute, timezone: next.timezone, capPerWeek: next.capPerWeek, smsFrom: next.smsFrom })) as MarketingSettingsRow;
      setS(r);
      setNotice('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };

  const slot = s.nextSlot ? new Date(s.nextSlot).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: s.timezone, timeZoneName: 'short' }) : '—';

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)', maxWidth: 720 }}>
      <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="th-card-label">Weekly slot</div>
        <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          Product releases and brand news go out at the same time every week, so people know when to expect you. The composer offers this as the one-click schedule.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
          <select value={s.weeklyDay} onChange={(e) => void save({ weeklyDay: Number(e.target.value) })} disabled={busy} style={{ width: 140 }}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          at
          <input type="number" min={0} max={23} value={s.weeklyHour} onChange={(e) => void save({ weeklyHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })} disabled={busy} style={{ width: 64 }} />
          :
          <input type="number" min={0} max={59} step={5} value={s.weeklyMinute} onChange={(e) => void save({ weeklyMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} disabled={busy} style={{ width: 64 }} />
          <select value={s.timezone} onChange={(e) => void save({ timezone: e.target.value })} disabled={busy} style={{ width: 190 }}>
            {[...new Set([s.timezone, ...ZONES])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 'var(--th-fs-sm)' }}>
          Next slot: <b>{slot}</b>
        </div>
      </div>

      <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="th-card-label">Frequency cap</div>
        <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          The most campaign emails one person can get in any 7 days. Events and extras still go out, but anyone already at the cap is skipped that time (you see it in
          the campaign report). Automations — welcome, cart, review, win-back — never count.
        </div>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
          <input type="number" min={0} max={30} value={s.capPerWeek} onChange={(e) => void save({ capPerWeek: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} disabled={busy} style={{ width: 64 }} />
          per person per week (0 = no cap)
        </label>
      </div>

      <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="th-card-label">SMS (Twilio)</div>
        <div className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          Texts go through Twilio. Connect it under Counter › Connections (Account SID and Auth Token), then put the sending number here. Point Twilio&apos;s
          inbound-message webhook at <code>/api/shop/sms/inbound</code> so STOP replies opt people out on their own.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--th-fs-2xs)' }}>
          <input value={fromDraft} onChange={(e) => setFromDraft(e.target.value)} placeholder="+12155550100" style={{ width: 170 }} />
          <button className="th-btn th-btn--xs" onClick={() => void save({ smsFrom: fromDraft.trim() })} disabled={busy || fromDraft.trim() === s.smsFrom}>
            Save number
          </button>
          {sms && (
            <span className={'pill' + (sms.ready ? ' pill-ok' : ' pill-failed')} title={sms.reason || ''}>
              {sms.ready ? sms.via : `not ready — ${sms.reason ?? sms.via}`}
            </span>
          )}
        </div>
      </div>

      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}
      {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}
    </div>
  );
}
