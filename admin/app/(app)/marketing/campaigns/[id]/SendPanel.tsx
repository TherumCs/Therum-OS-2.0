'use client';

import { useEffect, useState } from 'react';
import { api } from '../../MarketingClient';

interface ListOpt {
  id: string;
  name: string;
  members: number;
}
interface Audience {
  all?: boolean;
  listIds?: string[];
  excludeListIds?: string[];
  segmentIds?: string[];
}
interface SegOpt {
  id: string;
  name: string;
  count: number;
}
interface Report {
  campaign: { status: string; scheduledAt: string | null; startedAt: string | null; sentAt: string | null; recipientCount: number; sentCount: number; failedCount: number; openCount: number; clickCount: number; unsubCount: number };
  byStatus: { status: string; count: number }[];
  links: { url: string | null; clicks: number }[];
  recent: { email: string; status: string; error: string | null; sentAt: string | null; openedAt: string | null; clickedAt: string | null; unsubscribedAt: string | null }[];
}

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

// Who gets it, when, and what happened. Lives under the meta card in the
// composer so the send is one screen away from the copy it sends.
export function SendPanel({
  campaignId,
  status,
  initialAudience,
  dirty,
  onSaveFirst,
  onStatus,
}: {
  campaignId: string;
  status: string;
  initialAudience: Audience;
  dirty: boolean;
  onSaveFirst: () => Promise<void>;
  onStatus: (s: string) => void;
}) {
  const [lists, setLists] = useState<ListOpt[]>([]);
  const [segments, setSegments] = useState<SegOpt[]>([]);
  const [aud, setAud] = useState<Audience>({ all: !!initialAudience.all, listIds: initialAudience.listIds ?? [], excludeListIds: initialAudience.excludeListIds ?? [], segmentIds: initialAudience.segmentIds ?? [] });
  const [count, setCount] = useState<number | null>(null);
  const [when, setWhen] = useState('');
  const [nextSlot, setNextSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [audDirty, setAudDirty] = useState(false);

  const live = status === 'scheduled' || status === 'sending' || status === 'paused' || status === 'sent';

  useEffect(() => {
    void (async () => {
      try {
        setLists((await api.get('lists')) as ListOpt[]);
        setSegments((await api.get('segments')) as SegOpt[]);
        const st = (await api.get('settings')) as { nextSlot?: string };
        if (st?.nextSlot) setNextSlot(st.nextSlot);
      } catch {
        /* lists are optional here */
      }
    })();
  }, []);

  const saveAudience = async (next: Audience) => {
    setAud(next);
    setAudDirty(true);
    try {
      await api.send('PATCH', `campaigns/${campaignId}`, { audience: next });
      setAudDirty(false);
      const r = (await api.get(`campaigns/${campaignId}/audience`)) as { count: number };
      setCount(r.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the audience.');
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const r = (await api.get(`campaigns/${campaignId}/audience`)) as { count: number };
        setCount(r.count);
      } catch {
        setCount(null);
      }
    })();
  }, [campaignId]);

  const loadReport = async () => {
    try {
      setReport((await api.get(`campaigns/${campaignId}/report`)) as Report);
    } catch {
      /* report is best-effort */
    }
  };
  useEffect(() => {
    if (!live) return;
    void loadReport();
    const t = window.setInterval(() => void loadReport(), status === 'sending' ? 3000 : 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, status, campaignId]);

  const send = async (schedule: boolean) => {
    setError('');
    setNotice('');
    const n = count ?? 0;
    const at = schedule && when ? new Date(when) : null;
    if (schedule && (!at || Number.isNaN(at.getTime()))) {
      setError('Pick a date and time first.');
      return;
    }
    const msg = schedule ? `Schedule this campaign to ${n} ${n === 1 ? 'person' : 'people'} for ${at!.toLocaleString()}?` : `Send this campaign to ${n} ${n === 1 ? 'person' : 'people'} now? This cannot be recalled.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      if (dirty) await onSaveFirst();
      const r = (await api.send('POST', `campaigns/${campaignId}/schedule`, at ? { at: at.toISOString() } : {})) as { status: string; recipientCount: number };
      onStatus(r.status);
      setNotice(schedule ? `Scheduled for ${at!.toLocaleString()} — ${r.recipientCount} recipients queued.` : `Sending to ${r.recipientCount} recipients. Numbers below update live.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send.');
    }
    setBusy(false);
  };

  const cancel = async () => {
    setError('');
    setBusy(true);
    try {
      const r = (await api.send('POST', `campaigns/${campaignId}/cancel`)) as { status: string };
      onStatus(r.status);
      setNotice(r.status === 'draft' ? 'Schedule cancelled — back to draft.' : r.status === 'paused' ? 'Paused. Nothing more goes out until you resume.' : 'Resuming.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
    setBusy(false);
  };

  const toggle = (key: 'listIds' | 'excludeListIds' | 'segmentIds', id: string) => {
    const cur = aud[key] ?? [];
    void saveAudience({ ...aud, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const c = report?.campaign;

  return (
    <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="th-card-label">Audience &amp; send</div>
        <span style={{ flex: 1 }} />
        {count !== null && !live && (
          <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
            {count} {count === 1 ? 'person' : 'people'} will get this{audDirty ? ' (saving…)' : ''}
          </span>
        )}
      </div>

      {!live && (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--th-fs-sm)' }}>
            <input type="checkbox" checked={!!aud.all} onChange={(e) => void saveAudience({ ...aud, all: e.target.checked })} /> Everyone subscribed
          </label>
          {!aud.all && (
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Send to these lists</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {lists.map((l) => (
                  <label key={l.id} className={'pill' + ((aud.listIds ?? []).includes(l.id) ? ' pill-ok' : '')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={(aud.listIds ?? []).includes(l.id)} onChange={() => toggle('listIds', l.id)} style={{ display: 'none' }} />
                    {l.name} · {l.members}
                  </label>
                ))}
                {lists.length === 0 && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>No lists yet.</span>}
              </div>
            </div>
          )}
          {segments.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Only people in these segments (optional)</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {segments.map((g) => (
                  <label key={g.id} className={'pill' + ((aud.segmentIds ?? []).includes(g.id) ? ' pill-ok' : '')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={(aud.segmentIds ?? []).includes(g.id)} onChange={() => toggle('segmentIds', g.id)} style={{ display: 'none' }} />
                    {g.name} · {g.count}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>But not anyone on</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {lists.map((l) => (
                <label key={l.id} className={'pill' + ((aud.excludeListIds ?? []).includes(l.id) ? ' pill-failed' : '')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={(aud.excludeListIds ?? []).includes(l.id)} onChange={() => toggle('excludeListIds', l.id)} style={{ display: 'none' }} />
                  {l.name}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <button className="th-btn th-btn-primary" onClick={() => void send(false)} disabled={busy || !count}>
              Send now
            </button>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>or</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 210 }} />
            {nextSlot && (
              <button
                className="th-btn th-btn--xs"
                title="Fill in the weekly slot from Marketing › Settings"
                onClick={() => {
                  const d = new Date(nextSlot);
                  const pad = (n: number) => String(n).padStart(2, '0');
                  setWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                }}
              >
                Next weekly slot
              </button>
            )}
            <button className="th-btn" onClick={() => void send(true)} disabled={busy || !count || !when}>
              Schedule
            </button>
          </div>
        </>
      )}

      {live && c && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={'pill' + (c.status === 'sent' ? ' pill-ok' : c.status === 'paused' ? ' pill-failed' : ' pill-pending')}>{c.status}</span>
            {c.status === 'scheduled' && c.scheduledAt && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>for {new Date(c.scheduledAt).toLocaleString()}</span>}
            {c.sentAt && <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>finished {new Date(c.sentAt).toLocaleString()}</span>}
            <span style={{ flex: 1 }} />
            {c.status === 'scheduled' && (
              <button className="th-btn th-btn--xs" onClick={() => void cancel()} disabled={busy}>
                Cancel schedule
              </button>
            )}
            {c.status === 'sending' && (
              <button className="th-btn th-btn--xs th-btn--danger" onClick={() => void cancel()} disabled={busy}>
                Pause
              </button>
            )}
            {c.status === 'paused' && (
              <button className="th-btn th-btn--xs th-btn-primary" onClick={() => void cancel()} disabled={busy}>
                Resume
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>
            {[
              ['Recipients', String(c.recipientCount)],
              ['Sent', String(c.sentCount)],
              ['Failed', String(c.failedCount)],
              ['Opened', `${c.openCount} · ${pct(c.openCount, c.sentCount)}`],
              ['Clicked', `${c.clickCount} · ${pct(c.clickCount, c.sentCount)}`],
              ['Opted out', String(c.unsubCount)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="th-card-label">{k}</div>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            ))}
          </div>
          {report && report.links.length > 0 && (
            <div>
              <div className="th-card-label" style={{ marginBottom: 4 }}>Clicks by link</div>
              {report.links.map((l) => (
                <div key={l.url ?? ''} style={{ display: 'flex', gap: 8, fontSize: 'var(--th-fs-2xs)' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{l.clicks}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</span>
                </div>
              ))}
            </div>
          )}
          {report && report.recent.some((r) => r.status === 'failed') && (
            <div>
              <div className="th-card-label" style={{ marginBottom: 4 }}>Failures</div>
              {report.recent
                .filter((r) => r.status === 'failed')
                .slice(0, 10)
                .map((r) => (
                  <div key={r.email} style={{ fontSize: 'var(--th-fs-2xs)' }}>
                    {r.email} — <span className="muted">{r.error}</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}
      {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}
    </div>
  );
}
