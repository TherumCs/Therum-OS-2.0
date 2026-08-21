import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { BalanceHero } from './AllBalances';
import { AccountTiles } from './WoopaySection';
import { Activity } from './Activity';
import { mergeTxns, mergePayouts, type AcctTile } from './merge';

export const dynamic = 'force-dynamic';

// Counter › Payments › Overview — Direction A.
//
// One screen, four sections: a unified balance across both money rails, the two
// accounts side by side, one merged activity ledger (payouts + transactions,
// both accounts, with customers), and disputes. This file is the ORCHESTRATOR:
// it does every fetch in one Promise.all and hands typed props down; the section
// components fetch nothing. Both rails settle to the same bank, so the totals
// are a straight sum.

interface StripeOverview {
  connected: boolean;
  error?: string;
  account?: { payoutsEnabled: boolean; chargesEnabled: boolean };
  balance?: { available: number; pending: number; total: number; instantAvailable: number; currency: string };
  schedule?: { interval: string; delayDays: number | null; weeklyAnchor: string | null; monthlyAnchor: number | null };
  fees?: { effectiveRatePct: number; sampleCount: number } | null;
  recentPayouts?: { id: string; amount: number; status: string; arrivalDate: number | null; created?: number | null; bankLast4: string | null }[];
  notices?: { level: 'info' | 'warn' | 'bad'; text: string }[];
  stripeDashboard?: { root: string; settings: string };
}
interface WoopayOverview {
  connected: boolean;
  account?: { status: string | null; depositsEnabled: boolean; depositSchedule: string | null; instantEligible: boolean; instantFeePct: number | null };
  balance?: { available: number; pending: number; instant: number; currency: string };
}
interface WoopayPayouts {
  connected: boolean;
  account?: { instantReason: string | null };
  deposits?: { amount: number; status: string; date: number | null; bankLast4: string | null }[];
}
interface TxnRow { customer?: string | null; type: string; created: number | null; amount: number; fee: number; net: number; description?: string | null; orderNumber?: string | null; orderId?: string | null }
interface TxnsResp { connected: boolean; transactions?: TxnRow[] }
interface StripePayouts { connected: boolean; payouts?: { amount: number; status: string; arrivalDate: number | null; created: number | null; bankLast4: string | null }[] }
interface DisputesResp { connected: boolean; disputes?: { closed?: boolean }[] }

const NOTICE_COLOR = { info: 'var(--th-accent)', warn: '#e0a43f', bad: 'var(--th-danger)' } as const;

// WooPayments deposit cadence "daily, 2-day" → "Daily · 2-day delay" (the
// account-tile <Deposits> splits on " · " to grey the qualifier).
function wooDepositLabel(s: string | null | undefined): string {
  if (!s) return '—';
  const [interval, delay] = s.split(', ');
  const head = interval ? interval.charAt(0).toUpperCase() + interval.slice(1) : 'Daily';
  return delay ? `${head} · ${delay} delay` : head;
}
function stripeDepositLabel(s?: StripeOverview['schedule']): string {
  if (!s?.interval) return '—';
  const head = s.interval.charAt(0).toUpperCase() + s.interval.slice(1);
  if (s.interval === 'weekly' && s.weeklyAnchor) return `${head} · ${s.weeklyAnchor}`;
  if (s.interval === 'monthly' && s.monthlyAnchor) return `${head} · day ${s.monthlyAnchor}`;
  return head;
}

export default async function PaymentsOverviewPage() {
  const [stripe, woo, wooPay, wooTxns, stripePay, stripeTxns, wooDisp, stripeDisp] = await Promise.all([
    apiGet<StripeOverview>('/api/counter/payments/overview').catch((): StripeOverview => ({ connected: false })),
    apiGet<WoopayOverview>('/api/counter/payments/woopay').catch((): WoopayOverview => ({ connected: false })),
    apiGet<WoopayPayouts>('/api/counter/payments/woopay/deposits').catch((): WoopayPayouts => ({ connected: false })),
    apiGet<TxnsResp>('/api/counter/payments/woopay/transactions?limit=8').catch((): TxnsResp => ({ connected: false })),
    apiGet<StripePayouts>('/api/counter/payments/payouts?limit=8').catch((): StripePayouts => ({ connected: false })),
    apiGet<TxnsResp>('/api/counter/payments/transactions?limit=8').catch((): TxnsResp => ({ connected: false })),
    apiGet<DisputesResp>('/api/counter/payments/woopay/disputes').catch((): DisputesResp => ({ connected: false })),
    apiGet<DisputesResp>('/api/counter/payments/disputes').catch((): DisputesResp => ({ connected: false })),
  ]);

  // Nothing connected at all — a single connect prompt, no empty dashboard.
  if (!stripe.connected && !woo.connected) {
    return (
      <div className="card">
        <div className="l">No payment account connected</div>
        <p className="th-about-sub" style={{ marginTop: 8 }}>
          Connect Stripe in <a href={`${BASE_PATH}/settings/connections?tab=payments`}>Nexus</a>, or attach the WooPayments
          merchant account, to take payments and see your balance, payouts and transactions here.
        </p>
      </div>
    );
  }

  // ── Balances (minor units) ─────────────────────────────────────────────
  const wA = woo.balance?.available ?? 0, wP = woo.balance?.pending ?? 0, wI = woo.balance?.instant ?? 0;
  const sA = stripe.balance?.available ?? 0, sP = stripe.balance?.pending ?? 0, sI = stripe.balance?.instantAvailable ?? 0;
  const totalAvailable = wA + sA, totalPending = wP + sP, totalInstant = wI + sI;
  const wooBal = wA + wP, stripeBal = sA + sP, base = wooBal + stripeBal;
  const pct = (amt: number) => (base > 0 ? Math.max(0, Math.min(100, (amt / base) * 100)) : 0);
  const perAccount = [
    { key: 'woo' as const, name: 'WooPayments', amount: wooBal, pct: pct(wooBal) },
    { key: 'stripe' as const, name: 'Stripe', amount: stripeBal, pct: pct(stripeBal) },
  ];

  // ── Merged activity + bank ─────────────────────────────────────────────
  const transactions = mergeTxns(wooTxns.transactions ?? [], stripeTxns.transactions ?? []);
  const payouts = mergePayouts(wooPay.deposits ?? [], stripePay.payouts ?? []);
  const bankLast4 = payouts.find((p) => p.bankLast4)?.bankLast4
    ?? stripe.recentPayouts?.find((p) => p.bankLast4)?.bankLast4
    ?? null;

  // ── Account tiles ──────────────────────────────────────────────────────
  const wooTile: AcctTile = {
    connected: woo.connected,
    available: wA, pending: wP,
    payoutsOn: woo.connected && (woo.account?.depositsEnabled ?? false),
    depositLabel: wooDepositLabel(woo.account?.depositSchedule),
    instantEligible: woo.account?.instantEligible ?? false,
    instantReason: wooPay.account?.instantReason ?? null,
    feePct: null, feeSample: null, manageUrl: null, scheduleUrl: null,
  };
  const stripeTile: AcctTile = {
    connected: stripe.connected,
    available: sA, pending: sP,
    payoutsOn: stripe.account?.payoutsEnabled ?? false,
    depositLabel: stripeDepositLabel(stripe.schedule),
    instantEligible: false, instantReason: null,
    feePct: stripe.fees?.effectiveRatePct ?? null,
    feeSample: stripe.fees?.sampleCount ?? null,
    manageUrl: stripe.stripeDashboard?.root ?? null,
    scheduleUrl: stripe.stripeDashboard?.settings ?? null,
  };

  // ── Disputes (open only) ───────────────────────────────────────────────
  const openDisputes = (wooDisp.disputes ?? []).filter((d) => !d.closed).length + (stripeDisp.disputes ?? []).length;

  return (
    <div>
      {/* Live notices from the Stripe account state (unchanged). */}
      {(stripe.notices ?? []).map((n, i) => (
        <div key={i} className="card" style={{ marginBottom: 10, borderLeft: `3px solid ${NOTICE_COLOR[n.level]}` }}>
          <p style={{ margin: 0, fontSize: 'var(--th-fs-sm)' }}>{n.text}</p>
        </div>
      ))}
      {stripe.error && (
        <div className="card" style={{ marginBottom: 10, borderLeft: '3px solid var(--th-danger)' }}>
          <p style={{ margin: 0, fontSize: 'var(--th-fs-sm)' }}>Couldn’t read Stripe: {stripe.error}</p>
        </div>
      )}

      <BalanceHero
        available={totalAvailable}
        pending={totalPending}
        instant={totalInstant}
        total={totalAvailable + totalPending}
        perAccount={perAccount}
        bankLast4={bankLast4}
      />

      <AccountTiles woo={wooTile} stripe={stripeTile} bankLast4={bankLast4} />

      <Activity transactions={transactions} payouts={payouts} />

      {/* Disputes — a slim strip; the empty state when nothing is open. */}
      <section className="card disputes">
        <div className="disp-icon" style={openDisputes ? { background: 'var(--th-warning-bg)', color: 'var(--th-warning-ink)' } : undefined}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            {openDisputes ? <path d="M12 8v4M12 16h.01" /> : <path d="m9 12 2 2 4-4" />}
          </svg>
        </div>
        <div className="disp-body">
          <div className="disp-title">{openDisputes ? `${openDisputes} open dispute${openDisputes > 1 ? 's' : ''}` : 'No open disputes'}</div>
          <div className="disp-sub">
            {openDisputes
              ? <>Respond before the evidence deadline. <a className="pay-orderlink" href={`${BASE_PATH}/payments/disputes`}>Review →</a></>
              : 'A clean record — nothing to respond to. WooPayments and Stripe are both clear.'}
          </div>
        </div>
        <div className="disp-count">{openDisputes}</div>
      </section>
    </div>
  );
}
