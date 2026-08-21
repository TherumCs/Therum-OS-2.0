import { woopayBridge } from './woopayBridge.js';

/**
 * Counter › Payments view-adapter for WooPayments.
 *
 * woopayBridge is the raw engine reader (its own typed shapes, ISO dates). The
 * admin Payments screens reuse the SAME row types as the direct-Stripe surfaces
 * — unix-second dates, cents, a `connected` flag, richer per-surface fields —
 * so both tables render through one component. This module is the thin seam
 * between the two: it consumes the bridge and emits exactly the shapes the
 * pages fetch, so neither side has to know about the other's field names.
 *
 * Everything degrades soft, matching the bridge: engine down / not connected
 * comes back as { connected:false, ...empty } with a reason the page renders.
 */

function toSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// WCPay dispute statuses that mean the case is over (no action can change it).
const DISPUTE_CLOSED = new Set(['won', 'lost', 'warning_closed', 'charge_refunded']);

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  link: 'Link',
  klarna: 'Klarna',
  affirm: 'Affirm',
  afterpay_clearpay: 'Afterpay / Clearpay',
  cashapp: 'Cash App Pay',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  sepa_debit: 'SEPA Direct Debit',
  bancontact: 'Bancontact',
  ideal: 'iDEAL',
  p24: 'Przelewy24',
  eps: 'EPS',
  sofort: 'Sofort',
  giropay: 'giropay',
};
function methodLabel(id: string): string {
  return METHOD_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface WoopayDepositView {
  id: string; amount: number; currency: string; status: string;
  date: number | null; type: string | null; automatic: boolean | null; bankLast4: string | null;
}
export interface WoopayPayoutsView {
  connected: boolean;
  error?: string;
  account?: {
    depositsEnabled: boolean; depositSchedule: string | null;
    instantEligible: boolean; instantFeePct: number | null; instantReason: string | null;
  };
  balance?: { available: number; pending: number; instant: number; currency: string };
  deposits: WoopayDepositView[];
}

export interface WoopayTxnView {
  id: string; type: string; amount: number; fee: number; net: number; currency: string;
  status: string; created: number | null; description: string | null;
  customer: string | null;
  orderNumber: string | null; orderId: string | null;
}
export interface WoopayTxnsView { connected: boolean; error?: string; transactions: WoopayTxnView[] }

export interface WoopayDisputeView {
  id: string; amount: number; currency: string; status: string; reason: string;
  created: number | null; evidenceDueBy: number | null; hasEvidence: boolean; chargeId: string | null;
  orderNumber: string | null; orderId: string | null; submitted: boolean; closed: boolean;
}
export interface WoopayDisputesView { connected: boolean; error?: string; disputes: WoopayDisputeView[] }

export interface WoopaySettingsView {
  connected: boolean;
  error?: string;
  deposits?: { interval: string; weeklyAnchor: string | null; monthlyAnchor: number | null; delayDays: number | null; canManage: boolean };
  methods?: { id: string; label: string; enabled: boolean; description: string | null }[];
}

export const woopayView = {
  /** Balance + account controls + payout history, in the payouts-page shape. */
  async payouts(limit = 50): Promise<WoopayPayoutsView> {
    const ov = await woopayBridge.overview();
    if (!ov.connected) return { connected: false, error: ov.reason, deposits: [] };
    const dep = await woopayBridge.deposits(limit);
    const instantEligible = ov.account?.instantEligible ?? false;
    return {
      connected: true,
      error: dep.ok ? undefined : dep.reason,
      account: {
        depositsEnabled: ov.account?.depositsEnabled ?? false,
        depositSchedule: ov.account?.depositSchedule ?? null,
        instantEligible,
        instantFeePct: ov.account?.instantFeePct ?? null,
        instantReason: instantEligible ? null : 'This account is not eligible for instant payouts yet — it returns once the account has processed enough volume.',
      },
      balance: ov.balance,
      deposits: dep.rows.map((d) => ({
        id: d.id, amount: d.amount, currency: d.currency, status: d.status,
        date: toSec(d.date), type: d.type, automatic: d.automatic, bankLast4: d.bankAccount,
      })),
    };
  },

  async transactions(limit = 50): Promise<WoopayTxnsView> {
    const r = await woopayBridge.transactions(limit);
    if (!r.ok) return { connected: false, error: r.reason, transactions: [] };
    return {
      connected: true,
      transactions: r.rows.map((t) => ({
        id: t.id, type: t.type, amount: t.amount, fee: t.fees, net: t.net, currency: t.currency,
        status: 'succeeded',
        created: toSec(t.date),
        description: t.customerName || t.customerEmail || t.source || null,
        // A real name/email carried through from the engine (mapTransaction
        // already trims customer_name); the payment method `source` is NOT a
        // customer, so it is not a fallback here — null when the row has no one.
        customer: t.customerName || t.customerEmail || null,
        // The engine order id is the WC stub's id, not our storefront order —
        // linking it would 404, so leave the row unlinked.
        orderNumber: null,
        orderId: null,
      })),
    };
  },

  async disputes(limit = 50): Promise<WoopayDisputesView> {
    const r = await woopayBridge.disputes(limit);
    if (!r.ok) return { connected: false, error: r.reason, disputes: [] };
    return {
      connected: true,
      disputes: r.rows.map((d) => {
        const status = d.status ?? '';
        const closed = DISPUTE_CLOSED.has(status);
        const submitted = status === 'under_review';
        return {
          id: d.id, amount: d.amount, currency: d.currency, status,
          reason: d.reason ?? '', created: toSec(d.created), evidenceDueBy: toSec(d.dueBy),
          hasEvidence: submitted, chargeId: d.chargeId,
          orderNumber: d.orderId != null ? String(d.orderId) : null, orderId: null,
          submitted, closed,
        };
      }),
    };
  },

  async settings(): Promise<WoopaySettingsView> {
    const s = await woopayBridge.settings();
    if (!s.ok) return { connected: false, error: s.reason };
    return {
      connected: true,
      deposits: {
        interval: s.depositSchedule.interval ?? 'daily',
        weeklyAnchor: s.depositSchedule.weeklyAnchor,
        monthlyAnchor: s.depositSchedule.monthlyAnchor,
        delayDays: s.depositSchedule.delayDays,
        canManage: true,
      },
      methods: s.availableMethods.map((id) => ({
        id, label: methodLabel(id), enabled: s.enabledMethods.includes(id), description: null,
      })),
    };
  },
};
