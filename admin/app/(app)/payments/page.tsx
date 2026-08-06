import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { money, fmtDate } from './format';

export const dynamic = 'force-dynamic';

// Counter › Payments & Transactions › Overview.
//
// Everything WooPayments' Overview shows, on this store's LIVE Stripe account:
// balances, account status, the real effective fee, payout cadence, the most
// recent payouts, live notices, and Manage-in-Stripe deep links. Every value is
// read live in src/counter/stripePayments.ts — nothing is cached or invented.

interface Overview {
  connected: boolean;
  error?: string;
  account?: {
    id: string | null;
    type: string | null;
    name: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirementsDue: number;
    country: string | null;
    currency: string;
  };
  balance?: { available: number; pending: number; total: number; instantAvailable: number; currency: string };
  schedule?: { interval: string; delayDays: number | null; weeklyAnchor: string | null; monthlyAnchor: number | null };
  fees?: { effectiveRatePct: number; feeTotal: number; sampleCount: number } | null;
  recentPayouts?: { id: string; amount: number; currency: string; status: string; arrivalDate: number | null; bankLast4: string | null }[];
  notices?: { level: 'info' | 'warn' | 'bad'; text: string }[];
  stripeDashboard?: { root: string; balance: string; payouts: string; settings: string; payments: string; account: string; express: string };
}

function scheduleText(s?: Overview['schedule']): string {
  if (!s) return '—';
  const delay = s.delayDays != null ? `, ${s.delayDays} days after each charge clears` : '';
  if (s.interval === 'daily') return `Automatic, daily${delay}`;
  if (s.interval === 'weekly') return `Automatic, weekly${s.weeklyAnchor ? ` on ${s.weeklyAnchor}` : ''}${delay}`;
  if (s.interval === 'monthly') return `Automatic, monthly${s.monthlyAnchor ? ` on day ${s.monthlyAnchor}` : ''}${delay}`;
  if (s.interval === 'manual') return 'Manual — you release each payout yourself';
  return s.interval;
}

const NOTICE_COLOR = { info: 'var(--th-accent)', warn: '#e0a43f', bad: 'var(--th-danger)' } as const;

export default async function PaymentsOverviewPage() {
  const o = await apiGet<Overview>('/api/counter/payments/overview').catch((): Overview => ({ connected: false }));

  if (!o.connected) {
    return (
      <div className="card">
        <div className="l">No card processor connected</div>
        <p className="th-about-sub">
          Connect Stripe in <a href={`${BASE_PATH}/settings/connections?tab=payments`}>Nexus</a> to take payments and see
          your balance, payouts and transactions here.
        </p>
      </div>
    );
  }

  const active = o.account?.chargesEnabled && o.account?.payoutsEnabled;
  const dash = o.stripeDashboard;

  return (
    <div>
      {o.error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="l">Couldn’t read Stripe</div>
          <p className="th-about-sub">{o.error}</p>
        </div>
      )}

      {/* Live notices — only shown when the account state actually warrants one. */}
      {(o.notices ?? []).map((n, i) => (
        <div key={i} className="card" style={{ marginBottom: 10, borderLeft: `3px solid ${NOTICE_COLOR[n.level]}` }}>
          <p style={{ margin: 0, fontSize: 'var(--th-fs-sm)' }}>{n.text}</p>
        </div>
      ))}

      {/* Account details — connected status, payouts state, and Edit details out
          to where the account is managed (the Stripe sign-in). */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="l" style={{ margin: 0 }}>Account details</span>
            <span className={'th-about-badge' + (active ? ' is-prod' : '')}>{active ? 'Connected' : 'Restricted'}</span>
          </div>
          {dash && (
            <a className="pay-orderlink" href={dash.express} target="_blank" rel="noopener noreferrer">
              Edit details ↗
            </a>
          )}
        </div>
        <div className="settings-toggle-row" style={{ marginTop: 8 }}>
          <span className="settings-toggle-row-label">Payouts</span>
          <span className={'th-about-badge' + (o.account?.payoutsEnabled ? ' is-prod' : '')}>
            {o.account?.payoutsEnabled ? 'Active' : 'Paused'}
          </span>
        </div>
        {o.account?.id && (
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--th-fs-xs)' }}>
            {o.account.name?.trim() || 'Stripe'} · {o.account.id}
            {o.account.type ? ` · ${o.account.type}` : ''}
          </p>
        )}
      </div>

      {/* Balance — total, available, pending, and instant-available. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div className="l">Balance</div>
          {dash && <a className="pay-orderlink" href={dash.balance} target="_blank" rel="noopener noreferrer">Manage balance in Stripe ↗</a>}
        </div>
        <div className="n" style={{ marginTop: 4 }}>{money(o.balance?.total ?? 0)}</div>
        <div className="muted" style={{ marginBottom: 12 }}>Total balance</div>
        <div className="pay-substats">
          <div>
            <div className="pay-substat-v">{money(o.balance?.available ?? 0)}</div>
            <div className="pay-substat-l">Available to pay out</div>
          </div>
          <div>
            <div className="pay-substat-v">{money(o.balance?.pending ?? 0)}</div>
            <div className="pay-substat-l">Pending / clearing</div>
          </div>
          {(o.balance?.instantAvailable ?? 0) > 0 && (
            <div>
              <div className="pay-substat-v">{money(o.balance?.instantAvailable ?? 0)}</div>
              <div className="pay-substat-l">Instant-payout eligible</div>
            </div>
          )}
        </div>
      </div>

      {/* Payouts overview — schedule, recent payouts, links out. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div className="l">Payouts</div>
          <span className="muted" style={{ fontSize: 'var(--th-fs-xs)' }}>{scheduleText(o.schedule)}</span>
        </div>
        {(o.recentPayouts?.length ?? 0) === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>No payouts yet — your first lands once a charge clears and the bank hold passes.</p>
        ) : (
          <div className="pay-scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th className="pay-num">Amount</th><th>Status</th><th>Bank</th><th>Arrival</th></tr>
              </thead>
              <tbody>
                {(o.recentPayouts ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="pay-num">{money(p.amount)}</td>
                    <td><span className={'th-about-badge' + (p.status === 'paid' ? ' is-prod' : '')}>{p.status.replace(/_/g, ' ')}</span></td>
                    <td>{p.bankLast4 ? `•••• ${p.bankLast4}` : '—'}</td>
                    <td>{fmtDate(p.arrivalDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: '12px 0 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="th-btn th-btn-primary" href={`${BASE_PATH}/payments/payouts`}>View all payouts</a>
          {dash && <a className="th-btn" href={dash.settings} target="_blank" rel="noopener noreferrer">Change schedule in Stripe ↗</a>}
        </p>
      </div>

      {/* Account — status, fee, and the Manage-in-Stripe jump. */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div className="l">Account</div>
          {dash && <a className="pay-orderlink" href={dash.root} target="_blank" rel="noopener noreferrer">Manage in Stripe ↗</a>}
        </div>
        <div className="n" style={{ fontSize: 22, marginTop: 4 }}>{active ? 'Active' : 'Restricted'}</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          {o.account?.name?.trim() || 'Stripe'}{o.account?.country ? ` · ${o.account.country}` : ''}
        </div>
        <div className="pay-substats">
          <div>
            <div className="pay-substat-v">{o.account?.chargesEnabled ? 'On' : 'Off'}</div>
            <div className="pay-substat-l">Card charging</div>
          </div>
          <div>
            <div className="pay-substat-v">{o.account?.payoutsEnabled ? 'On' : 'Off'}</div>
            <div className="pay-substat-l">Payouts to bank</div>
          </div>
          {o.fees && (
            <div>
              <div className="pay-substat-v">{o.fees.effectiveRatePct}%</div>
              <div className="pay-substat-l">Effective fee · last {o.fees.sampleCount}</div>
            </div>
          )}
        </div>
        {dash && (
          <p style={{ margin: '12px 0 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="th-btn" href={dash.payments} target="_blank" rel="noopener noreferrer">Payments in Stripe ↗</a>
            <a className="th-btn" href={`${BASE_PATH}/payments/settings`}>Payment methods &amp; keys</a>
          </p>
        )}
      </div>
    </div>
  );
}
