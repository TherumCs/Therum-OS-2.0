'use client';

import { useState } from 'react';
import { BASE_PATH } from '../../../lib/session';
import { api } from './MarketingClient';

export interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  openCount: number;
  clickCount: number;
  unsubCount: number;
  createdAt: string;
  updatedAt: string;
}

const PILL: Record<string, string> = { draft: 'pill', scheduled: 'pill pill-pending', sending: 'pill pill-pending', sent: 'pill pill-ok', paused: 'pill pill-pending', cancelled: 'pill pill-failed' };

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export function CampaignsTab({ initial }: { initial: CampaignRow[] }) {
  const [rows, setRows] = useState<CampaignRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async (channel: 'email' | 'sms' = 'email') => {
    setBusy(true);
    setError('');
    try {
      const c = (await api.send('POST', 'campaigns', { name: channel === 'sms' ? 'Untitled text' : 'Untitled campaign', channel })) as CampaignRow;
      window.location.href = `${BASE_PATH}/marketing/campaigns/${c.id}`;
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the campaign.');
    }
    setBusy(false);
  };

  const duplicate = async (r: CampaignRow) => {
    setBusy(true);
    setError('');
    try {
      const c = (await api.send('POST', `campaigns/${r.id}/duplicate`)) as CampaignRow;
      setRows((rs) => [{ ...c, recipientCount: 0, sentCount: 0, failedCount: 0, openCount: 0, clickCount: 0, unsubCount: 0 }, ...rs]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate.');
    }
    setBusy(false);
  };

  const remove = async (r: CampaignRow) => {
    if (!window.confirm(`Delete "${r.name}"? ${r.status === 'sent' ? 'Its send history goes with it.' : ''}`)) return;
    setBusy(true);
    setError('');
    try {
      await api.send('DELETE', `campaigns/${r.id}`);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-16)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 'var(--th-fs-sm)' }}>
          A campaign is one email (or text) to a list. Write it in blocks, edit the HTML of any block, send yourself a test, then send.
        </span>
        <span style={{ flex: 1 }} />
        <button className="th-btn" onClick={() => void create('sms')} disabled={busy} title="A text message to everyone with SMS consent">
          New text
        </button>
        <button className="th-btn th-btn-primary" onClick={() => void create('email')} disabled={busy}>
          New campaign
        </button>
      </div>
      {error && <div style={{ color: 'var(--th-danger-text)', fontSize: 13 }}>{error}</div>}

      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Sent</th>
            <th style={{ textAlign: 'right' }}>Opened</th>
            <th style={{ textAlign: 'right' }}>Clicked</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No campaigns yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={`${BASE_PATH}/marketing/campaigns/${r.id}`} style={{ fontWeight: 600 }}>
                  {r.name}
                </a>
                <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>
                  {r.channel === 'sms' ? 'SMS' : r.subject || 'No subject yet'}
                </div>
              </td>
              <td>
                <span className={PILL[r.status] || 'pill'}>{r.status}</span>
                {r.status === 'scheduled' && r.scheduledAt && <div className="muted" style={{ fontSize: 'var(--th-fs-2xs)' }}>{new Date(r.scheduledAt).toLocaleString()}</div>}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.sentCount}
                {r.failedCount > 0 && <span className="muted"> · {r.failedCount} failed</span>}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.openCount, r.sentCount)}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.clickCount, r.sentCount)}</td>
              <td style={{ fontSize: 'var(--th-fs-2xs)', whiteSpace: 'nowrap' }}>{new Date(r.updatedAt).toLocaleDateString()}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <a className="th-btn th-btn--xs" href={`${BASE_PATH}/marketing/campaigns/${r.id}`}>
                  {r.status === 'draft' ? 'Edit' : 'Open'}
                </a>{' '}
                <button className="th-btn th-btn--xs" onClick={() => void duplicate(r)} disabled={busy}>
                  Duplicate
                </button>{' '}
                {r.status !== 'sending' && (
                  <button className="th-btn th-btn--xs th-btn--danger" onClick={() => void remove(r)} disabled={busy}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
