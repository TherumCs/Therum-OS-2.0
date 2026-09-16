'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ListRow } from './MarketingClient';

export interface PopupSettings {
  logo: string;
  eyebrow: string;
  headline: string;
  body: string;
  placeholder: string;
  buttonLabel: string;
  footnote: string;
  successHeadline: string;
  successBody: string;
  askName: boolean;
  askPhone: boolean;
  smsConsentText: string;
  trigger: 'delay' | 'scroll' | 'exit';
  delaySeconds: number;
  scrollPercent: number;
  dismissDays: number;
  pages: 'all' | 'home';
  accent: string;
}
export interface FormRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  listId: string | null;
  settings: PopupSettings;
  views: number;
  submits: number;
  list?: { id: string; name: string } | null;
}
export interface FormsData {
  forms: FormRow[];
  footer: { submits: number };
}

const pct = (n: number, d: number): string => (d > 0 ? `${(Math.round((n / d) * 1000) / 10).toFixed(1)}%` : '—');

export function FormsTab({ initial, lists }: { initial: FormsData; lists: ListRow[] }) {
  const [rows, setRows] = useState<FormRow[]>(initial.forms);
  const [editing, setEditing] = useState<FormRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const timer = useRef<number | null>(null);

  const refreshPreview = (f: FormRow) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/tos-admin/api/marketing/forms/${f.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: f.settings }) });
        setPreviewHtml(await res.text());
      } catch {
        setPreviewHtml('');
      }
    }, 250);
  };

  useEffect(() => {
    if (editing) refreshPreview(editing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const f = (await api.send('POST', 'forms', { name: 'Subscribe popup', kind: 'popup' })) as FormRow;
      setRows((rs) => [...rs, { ...f, views: 0, submits: 0 }]);
      setEditing({ ...f, views: 0, submits: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the popup.');
    }
    setBusy(false);
  };

  const patchSettings = (p: Partial<PopupSettings>) => {
    if (!editing) return;
    const next = { ...editing, settings: { ...editing.settings, ...p } };
    setEditing(next);
    refreshPreview(next);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const f = (await api.send('PATCH', `forms/${editing.id}`, { name: editing.name, listId: editing.listId, settings: editing.settings })) as FormRow;
      setRows((rs) => rs.map((x) => (x.id === f.id ? { ...x, ...f, settings: editing.settings } : x)));
      setNotice('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  };

  const toggle = async (f: FormRow) => {
    setBusy(true);
    setError('');
    try {
      const u = (await api.send('PATCH', `forms/${f.id}`, { enabled: !f.enabled })) as FormRow;
      // Only one live popup at a time — the backend switched the others off.
      setRows((rs) => rs.map((x) => (x.id === f.id ? { ...x, enabled: u.enabled } : u.enabled && x.kind === 'popup' ? { ...x, enabled: false } : x)));
      if (editing?.id === f.id) setEditing({ ...editing, enabled: u.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
    setBusy(false);
  };

  const remove = async (f: FormRow) => {
    if (!window.confirm(`Delete "${f.name}"?`)) return;
    setBusy(true);
    try {
      await api.send('DELETE', `forms/${f.id}`);
      setRows((rs) => rs.filter((x) => x.id !== f.id));
      if (editing?.id === f.id) setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
    setBusy(false);
  };

  const s = editing?.settings;
  const field = (k: keyof PopupSettings, label: string, opts: { textarea?: boolean; width?: number } = {}) => (
    <label style={{ display: 'grid', gap: 3, fontSize: 'var(--th-fs-2xs)' }}>
      <span className="muted">{label}</span>
      {opts.textarea ? (
        <textarea rows={3} value={String(s?.[k] ?? '')} onChange={(e) => patchSettings({ [k]: e.target.value } as Partial<PopupSettings>)} />
      ) : (
        <input value={String(s?.[k] ?? '')} onChange={(e) => patchSettings({ [k]: e.target.value } as Partial<PopupSettings>)} style={opts.width ? { width: opts.width } : undefined} />
      )}
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          Where people can sign up. The footer form is always on. A popup shows once per visitor, never to anyone already subscribed, never on cart or checkout, and
          stays quiet for a month after it is closed.
        </span>
        <span style={{ flex: 1 }} />
        <button className="th-btn th-btn-primary" onClick={() => void create()} disabled={busy}>
          New popup
        </button>
      </div>
      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}
      {notice && <div className="notice" style={{ margin: 0 }}>{notice}</div>}

      <table>
        <thead>
          <tr>
            <th>Form</th>
            <th>Feeds</th>
            <th style={{ textAlign: 'right' }}>Seen</th>
            <th style={{ textAlign: 'right' }}>Signed up</th>
            <th style={{ textAlign: 'right' }}>Rate</th>
            <th>Live</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div style={{ fontWeight: 600 }}>Site footer</div>
              <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>Built into every page</div>
            </td>
            <td style={{ fontSize: 'var(--th-fs-2xs)' }}>Newsletter</td>
            <td style={{ textAlign: 'right' }} className="muted">—</td>
            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{initial.footer.submits}</td>
            <td style={{ textAlign: 'right' }} className="muted">—</td>
            <td>
              <span className="pill pill-ok">always</span>
            </td>
            <td />
          </tr>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                  {f.kind} · {f.settings?.trigger === 'exit' ? 'on exit intent' : f.settings?.trigger === 'scroll' ? `after ${f.settings.scrollPercent}% scroll` : `after ${f.settings?.delaySeconds ?? 6}s`}
                </div>
              </td>
              <td style={{ fontSize: 'var(--th-fs-2xs)' }}>{f.list?.name ?? 'Newsletter'}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.views}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.submits}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(f.submits, f.views)}</td>
              <td>
                <button className={'th-btn th-btn--xs' + (f.enabled ? ' th-btn-primary' : '')} onClick={() => void toggle(f)} disabled={busy}>
                  {f.enabled ? 'On' : 'Off'}
                </button>
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="th-btn th-btn--xs" onClick={() => setEditing(f)} disabled={busy}>
                  Edit
                </button>{' '}
                <button className="th-btn th-btn--xs th-btn--danger" onClick={() => void remove(f)} disabled={busy}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) minmax(320px, 1fr)', gap: 'var(--th-space-16)', alignItems: 'start' }}>
          <div className="th-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={{ fontWeight: 600, maxWidth: 240 }} />
              <span style={{ flex: 1 }} />
              <button className="th-btn th-btn--xs" onClick={() => setEditing(null)} disabled={busy}>
                Close
              </button>
              <button className="th-btn th-btn-primary th-btn--xs" onClick={() => void save()} disabled={busy}>
                Save
              </button>
            </div>

            <div className="th-card-label">Copy</div>
            {field('logo', 'Logo image URL (leave empty to show the eyebrow text instead)')}
            {field('eyebrow', 'Eyebrow (used as the logo alt text when a logo is set)')}
            {field('headline', 'Headline')}
            {field('body', 'Body', { textarea: true })}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {field('buttonLabel', 'Button')}
              {field('placeholder', 'Email placeholder')}
            </div>
            {field('footnote', 'Footnote')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {field('successHeadline', 'After signup — headline')}
              {field('successBody', 'After signup — body')}
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
              <input type="checkbox" checked={s.askName} onChange={(e) => patchSettings({ askName: e.target.checked })} /> Ask for a first name too
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
              <input type="checkbox" checked={!!s.askPhone} onChange={(e) => patchSettings({ askPhone: e.target.checked })} /> Ask for a mobile number with an SMS consent tick (needs Twilio in Settings)
            </label>
            {s.askPhone && field('smsConsentText', 'SMS consent line (shown next to the tick)')}

            <div className="th-card-label" style={{ marginTop: 4 }}>Behaviour</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
              <select value={s.trigger} onChange={(e) => patchSettings({ trigger: e.target.value as PopupSettings['trigger'] })} style={{ width: 170 }}>
                <option value="delay">Show after a delay</option>
                <option value="scroll">Show after scrolling</option>
                <option value="exit">Show on exit intent</option>
              </select>
              {s.trigger === 'delay' && (
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min={0} max={600} value={s.delaySeconds} onChange={(e) => patchSettings({ delaySeconds: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 70 }} /> seconds
                </label>
              )}
              {s.trigger === 'scroll' && (
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min={5} max={95} value={s.scrollPercent} onChange={(e) => patchSettings({ scrollPercent: Math.min(95, Math.max(5, Number(e.target.value) || 40)) })} style={{ width: 70 }} /> % down the page
                </label>
              )}
              {s.trigger === 'exit' && <span className="muted">Desktop only; phones fall back to a {Math.max(20, s.delaySeconds || 45)}s delay.</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--th-fs-2xs)' }}>
              <select value={s.pages} onChange={(e) => patchSettings({ pages: e.target.value as PopupSettings['pages'] })} style={{ width: 170 }}>
                <option value="all">Any page (except cart/checkout)</option>
                <option value="home">Home and /shop only</option>
              </select>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                after closing, quiet for <input type="number" min={1} max={365} value={s.dismissDays} onChange={(e) => patchSettings({ dismissDays: Math.max(1, Number(e.target.value) || 30) })} style={{ width: 64 }} /> days
              </label>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                accent <input type="color" value={s.accent} onChange={(e) => patchSettings({ accent: e.target.value })} style={{ width: 40, padding: 0, height: 28 }} />
              </label>
            </div>
            <label style={{ display: 'grid', gap: 3, fontSize: 'var(--th-fs-2xs)' }}>
              <span className="muted">Adds people to</span>
              <select value={editing.listId ?? ''} onChange={(e) => setEditing({ ...editing, listId: e.target.value || null })} style={{ width: 220 }}>
                <option value="">Newsletter (default)</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
              New signups from this popup get the Welcome automation (and its code) if that automation is on. Test it on the live site with <code>?th_pop=1</code> on any URL.
            </div>
          </div>

          <div style={{ position: 'sticky', top: 12 }}>
            <div className="th-card-label" style={{ marginBottom: 6 }}>Live preview</div>
            <iframe title="Popup preview" srcDoc={previewHtml} sandbox="allow-scripts" style={{ width: '100%', height: 560, border: '1px solid var(--th-border, #e7e7e7)', borderRadius: 12, background: '#f4f4f4' }} />
          </div>
        </div>
      )}
    </div>
  );
}
