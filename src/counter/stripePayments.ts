import { connectionService } from '../services/connection.service.js';
import { db } from '../lib/db.js';

// Payments & Transactions — the read side.
//
// This is the data behind the WooPayments-equivalent screens (Overview,
// Payouts, Transactions, Disputes). WooPayments' own screens are a UI over the
// WPCOM/Stripe payments API; ours is the same idea over THIS store's Stripe
// account, read with the secret key already in the Nexus vault. No SDK — plain
// fetch against the REST API, the same posture as stripeGateway and the Nexus
// testers.
//
// Everything here is READ-ONLY. Moving money (issuing a payout, submitting
// dispute evidence) is a deliberate, separate action and is not wired to these
// list endpoints — a page that lists money must never be the page that moves
// it by accident.
//
// Amounts are returned in MINOR units (cents), the same unit orders and
// payments are stored in, and formatted once in the admin. Mixing the two
// units is how a $19.00 payout renders as $1,900.

const API = 'https://api.stripe.com/v1';

async function key(): Promise<string | null> {
  return connectionService.credentialFor('stripe');
}

async function stripeGet<T>(path: string, secret: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe returned ${res.status}`);
  return json as T;
}

// A Stripe money bucket: { amount, currency } repeated per source type.
interface Money {
  amount: number;
  currency: string;
}
interface StripeBalance {
  available?: Money[];
  pending?: Money[];
  instant_available?: Money[];
}
interface StripeAccount {
  id?: string;
  type?: string;
  business_profile?: { name?: string | null } | null;
  settings?: {
    dashboard?: { display_name?: string | null } | null;
    payouts?: { schedule?: { interval?: string; delay_days?: number; weekly_anchor?: string; monthly_anchor?: number } } | null;
  } | null;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: { currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null } | null;
  country?: string | null;
  default_currency?: string | null;
}
interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  arrival_date?: number;
  created?: number;
  description?: string | null;
  destination?: { last4?: string; bank_name?: string } | string | null;
}
interface StripeBalanceTxn {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: string;
  created: number;
  description?: string | null;
  source?: { payment_intent?: string | null } | string | null;
}
interface StripeDispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  created: number;
  evidence_details?: { due_by?: number | null; has_evidence?: boolean } | null;
  charge?: { id?: string } | string | null;
}
interface List<T> {
  data?: T[];
  has_more?: boolean;
}

function sum(buckets?: Money[]): number {
  return (buckets ?? []).reduce((n, b) => n + (b.amount ?? 0), 0);
}

function intentOf(source: StripeBalanceTxn['source']): string | null {
  if (!source || typeof source === 'string') return null;
  return source.payment_intent ?? null;
}

function chargeOf(charge: StripeDispute['charge']): string | null {
  if (!charge) return null;
  return typeof charge === 'string' ? charge : (charge.id ?? null);
}

/**
 * Map a set of Stripe payment-intent ids back to this store's own orders, so a
 * ledger row can say "Order 1043" instead of an opaque pi_… The link is the
 * intent id we stored on the payment when the webhook (or inline charge) marked
 * it paid.
 */
async function ordersByIntent(intents: string[]): Promise<Map<string, { number: string; id: string }>> {
  const unique = [...new Set(intents.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.payment.findMany({
    where: { txnId: { in: unique } },
    select: { txnId: true, order: { select: { id: true, number: true } } },
  });
  const map = new Map<string, { number: string; id: string }>();
  for (const r of rows) {
    if (r.txnId && r.order) map.set(r.txnId, { number: r.order.number, id: r.order.id });
  }
  return map;
}

function destLast4(d: StripePayout['destination']): string | null {
  if (!d || typeof d === 'string') return null;
  return d.last4 ?? null;
}

export const stripePayments = {
  /**
   * The Overview screen — everything WooPayments' Overview shows, on this
   * store's live Stripe account: balances (total / available / pending /
   * instant), account status, the real effective fee, the payout cadence, the
   * most recent payouts, live notices, and the deep links to manage the account
   * in Stripe. One call so the page is a straight render, nothing invented.
   */
  async overview() {
    const k = await key();
    if (!k) return { connected: false as const };
    try {
      const [bal, acct, payoutList, txnList] = await Promise.all([
        stripeGet<StripeBalance>('/balance', k),
        stripeGet<StripeAccount>('/account', k),
        stripeGet<List<StripePayout>>('/payouts?limit=3&expand[]=data.destination', k),
        stripeGet<List<StripeBalanceTxn>>('/balance_transactions?limit=100&type=charge', k),
      ]);
      const schedule = acct.settings?.payouts?.schedule ?? {};
      const available = sum(bal.available);
      const pending = sum(bal.pending);
      const instant = sum(bal.instant_available);
      const currency = bal.available?.[0]?.currency ?? acct.default_currency ?? 'usd';

      // Effective fee from REAL recent charges (fees ÷ gross) — what this account
      // has actually paid lately, not a quoted rate. Null until there are charges.
      const charges = (txnList.data ?? []).filter((t) => t.type === 'charge' && t.amount > 0);
      const grossSum = charges.reduce((n, t) => n + t.amount, 0);
      const feeSum = charges.reduce((n, t) => n + t.fee, 0);
      const fees = grossSum > 0 ? { effectiveRatePct: Math.round((feeSum / grossSum) * 1000) / 10, feeTotal: feeSum, sampleCount: charges.length } : null;

      // Notices are surfaced ONLY when the real account state is true — never a
      // placeholder. This is the Overview task/notice strip.
      const requirementsDue = acct.requirements?.currently_due?.length ?? 0;
      const notices: { level: 'info' | 'warn' | 'bad'; text: string }[] = [];
      if (acct.charges_enabled === false) notices.push({ level: 'bad', text: 'Card charging is disabled on this Stripe account — finish verification in Stripe to accept payments.' });
      if (acct.payouts_enabled === false) notices.push({ level: 'warn', text: 'Payouts are paused. Stripe needs more information before it will send money to your bank.' });
      if (requirementsDue > 0) notices.push({ level: 'warn', text: `Stripe needs ${requirementsDue} more detail${requirementsDue === 1 ? '' : 's'} to keep payouts running.` });
      if (acct.requirements?.disabled_reason) notices.push({ level: 'bad', text: `Account restricted: ${acct.requirements.disabled_reason.replace(/[._]/g, ' ')}.` });

      return {
        connected: true as const,
        account: {
          id: acct.id ?? null,
          type: acct.type ?? null,
          name: acct.business_profile?.name ?? acct.settings?.dashboard?.display_name ?? null,
          chargesEnabled: !!acct.charges_enabled,
          payoutsEnabled: !!acct.payouts_enabled,
          detailsSubmitted: !!acct.details_submitted,
          requirementsDue,
          country: acct.country ?? null,
          currency,
        },
        balance: { available, pending, total: available + pending, instantAvailable: instant, currency },
        schedule: {
          interval: schedule.interval ?? 'daily',
          delayDays: schedule.delay_days ?? null,
          weeklyAnchor: schedule.weekly_anchor ?? null,
          monthlyAnchor: schedule.monthly_anchor ?? null,
        },
        fees,
        recentPayouts: (payoutList.data ?? []).map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          arrivalDate: p.arrival_date ?? null,
          bankLast4: destLast4(p.destination),
        })),
        notices,
        // Manage-in-Stripe deep links. sidemoney's Stripe is its own account
        // (not a Connect sub-account), so the dashboard is the edit surface —
        // the same jump WooPayments' "Manage in Stripe" makes.
        stripeDashboard: {
          root: 'https://dashboard.stripe.com/',
          balance: 'https://dashboard.stripe.com/balance/overview',
          payouts: 'https://dashboard.stripe.com/payouts',
          settings: 'https://dashboard.stripe.com/settings/payouts',
          payments: 'https://dashboard.stripe.com/payments',
          account: 'https://dashboard.stripe.com/settings/account',
          // Where Bam manages: the Stripe Express dashboard sign-in. Stable URL
          // (the per-account internal_express_login links are single-use), so
          // "Edit details" always lands somewhere that works.
          express: 'https://connect.stripe.com/express_login',
        },
      };
    } catch (err) {
      return { connected: true as const, error: (err as Error).message };
    }
  },

  /** Recent payouts (deposits) — the Payouts screen. */
  async payouts(limit = 20) {
    const k = await key();
    if (!k) return { connected: false as const, payouts: [] };
    try {
      const j = await stripeGet<List<StripePayout>>(`/payouts?limit=${limit}&expand[]=data.destination`, k);
      return {
        connected: true as const,
        payouts: (j.data ?? []).map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          method: p.method ?? 'standard',
          arrivalDate: p.arrival_date ?? null,
          created: p.created ?? null,
          description: p.description ?? null,
          bankLast4: destLast4(p.destination),
        })),
      };
    } catch (err) {
      return { connected: true as const, payouts: [], error: (err as Error).message };
    }
  },

  /** One payout and the transactions that make it up — the Payout detail. */
  async payout(id: string) {
    const k = await key();
    if (!k) return { connected: false as const };
    try {
      const [p, txns] = await Promise.all([
        stripeGet<StripePayout>(`/payouts/${encodeURIComponent(id)}?expand[]=destination`, k),
        stripeGet<List<StripeBalanceTxn>>(`/balance_transactions?payout=${encodeURIComponent(id)}&limit=100`, k),
      ]);
      return {
        connected: true as const,
        payout: {
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          method: p.method ?? 'standard',
          arrivalDate: p.arrival_date ?? null,
          created: p.created ?? null,
          bankLast4: destLast4(p.destination),
        },
        transactions: (txns.data ?? []).map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          fee: t.fee,
          net: t.net,
          currency: t.currency,
          created: t.created,
          description: t.description ?? null,
        })),
      };
    } catch (err) {
      return { connected: true as const, error: (err as Error).message };
    }
  },

  /** The money ledger — every charge, refund and fee, linked to its order. */
  async transactions(limit = 25) {
    const k = await key();
    if (!k) return { connected: false as const, transactions: [] };
    try {
      const j = await stripeGet<List<StripeBalanceTxn>>(
        `/balance_transactions?limit=${limit}&expand[]=data.source`,
        k,
      );
      const rows = j.data ?? [];
      const orders = await ordersByIntent(rows.map((t) => intentOf(t.source)).filter((x): x is string => !!x));
      return {
        connected: true as const,
        hasMore: !!j.has_more,
        transactions: rows.map((t) => {
          const intent = intentOf(t.source);
          const order = intent ? orders.get(intent) : undefined;
          return {
            id: t.id,
            type: t.type,
            amount: t.amount,
            fee: t.fee,
            net: t.net,
            currency: t.currency,
            status: t.status,
            created: t.created,
            description: t.description ?? null,
            orderNumber: order?.number ?? null,
            orderId: order?.id ?? null,
          };
        }),
      };
    } catch (err) {
      return { connected: true as const, transactions: [], error: (err as Error).message };
    }
  },

  /** Chargebacks and inquiries — the Disputes screen. */
  async disputes(limit = 25) {
    const k = await key();
    if (!k) return { connected: false as const, disputes: [] };
    try {
      const j = await stripeGet<List<StripeDispute>>(`/disputes?limit=${limit}`, k);
      const rows = j.data ?? [];
      // Disputes reference a charge, not an intent; resolve the charge → intent
      // → order is another round-trip, so for the list we link by charge and
      // leave the order association to the (rare) detail view.
      return {
        connected: true as const,
        disputes: rows.map((d) => ({
          id: d.id,
          amount: d.amount,
          currency: d.currency,
          status: d.status,
          reason: d.reason,
          created: d.created,
          evidenceDueBy: d.evidence_details?.due_by ?? null,
          hasEvidence: !!d.evidence_details?.has_evidence,
          chargeId: chargeOf(d.charge),
        })),
      };
    } catch (err) {
      return { connected: true as const, disputes: [], error: (err as Error).message };
    }
  },
};
