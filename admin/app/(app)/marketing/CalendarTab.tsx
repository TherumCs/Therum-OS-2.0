'use client';

import { useMemo, useState } from 'react';
import { BASE_PATH } from '../../../lib/session';
import type { CampaignRow } from './CampaignsTab';

// The month at a glance: what went out, what is booked. Social posts and
// other outreach can be pencilled in as campaigns in draft with a scheduled
// date later; for now this shows email.
export function CalendarTab({ campaigns, nextSlot }: { campaigns: CampaignRow[]; nextSlot: string | null }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const out: { date: Date; inMonth: boolean; items: CampaignRow[] }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = date.toDateString();
      const items = campaigns.filter((c) => {
        const when = c.sentAt ?? c.scheduledAt;
        return when && new Date(when).toDateString() === key;
      });
      out.push({ date, inMonth: date.getMonth() === cursor.getMonth(), items });
    }
    return out;
  }, [cursor, campaigns]);

  const today = new Date().toDateString();
  const slot = nextSlot ? new Date(nextSlot) : null;
  const label = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="th-btn th-btn--xs" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          ←
        </button>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <button className="th-btn th-btn--xs" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          →
        </button>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
          <span className="pill pill-ok">sent</span> <span className="pill pill-pending">scheduled</span> <span className="pill">next weekly slot</span>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="th-card-label" style={{ textAlign: 'center', padding: '4px 0' }}>
            {d}
          </div>
        ))}
        {cells.map((c) => {
          const isToday = c.date.toDateString() === today;
          const isSlot = slot && slot.toDateString() === c.date.toDateString();
          return (
            <div
              key={c.date.toISOString()}
              className="th-card"
              style={{ minHeight: 82, padding: 6, opacity: c.inMonth ? 1 : 0.45, outline: isToday ? '2px solid var(--th-accent, #e83b3b)' : undefined, display: 'grid', gap: 3, alignContent: 'start' }}
            >
              <div style={{ fontSize: 'var(--th-fs-2xs)', fontWeight: isToday ? 700 : 500 }}>{c.date.getDate()}</div>
              {isSlot && c.items.length === 0 && (
                <span className="pill" style={{ fontSize: 10 }}>
                  slot {slot!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
              {c.items.map((it) => (
                <a key={it.id} href={`${BASE_PATH}/marketing/campaigns/${it.id}`} className={'pill ' + (it.status === 'sent' ? 'pill-ok' : 'pill-pending')} style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }} title={it.name}>
                  {it.name}
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
