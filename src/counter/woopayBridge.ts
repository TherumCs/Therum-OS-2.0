import { env } from '../lib/env.js';

/**
 * Counter ⇄ payment-engine bridge.
 *
 * The WooPayments engine is a sealed WooCommerce runtime whose only
 * job is holding the WooPayments merchant connection. This module is the ONLY
 * thing that talks to it: read-only pulls of the account/deposits/transactions
 * surfaces its own dashboard uses, re-served inside Counter so the operator
 * never opens a WordPress admin — plus the write actions (instant payout,
 * deposit schedule, enabled methods, dispute responses) the same dashboard
 * exposes, and the raw engineSend() the payment gateway confirms intents with.
 *
 * Everything degrades softly: engine missing, credential missing, or the
 * merchant not yet connected all come back as { connected:false } / { ok:false }
 * with a reason — the admin renders a connect card instead of an error page.
 */

const TIMEOUT = 12_000;

// Connected-account publishable key + id, cached for the checkout page (see
// clientKeys). Module-level so it survives across requests within a process.
let keyCache: { publishableKey: string; accountId: string; at: number } | null = null;

function cfg(): { base: string; auth: string } | null {
  const base = env.WOOPAY_BRIDGE_URL;
  const auth = env.WOOPAY_BRIDGE_AUTH; // "user:application-password"
  if (!base || !auth) return null;
  return { base: base.replace(/\/$/, ''), auth };
}

export interface WoopayEngineResult {
  ok: boolean;
  status: number;
  body: unknown;
}

function parseBody(text: string): unknown {
  try { return JSON.parse(text); } catch { return text.slice(0, 200); }
}

export async function engineGet(path: string): Promise<WoopayEngineResult> {
  const c = cfg();
  if (!c) return { ok: false, status: 0, body: null };
  try {
    const res = await fetch(`${c.base}${path}`, {
      headers: { authorization: 'Basic ' + Buffer.from(c.auth).toString('base64') },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { ok: res.ok, status: res.status, body: parseBody(await res.text()) };
  } catch {
    // Timeout / DNS / connection refused all surface as status 0 so callers
    // render the "engine unreachable" state instead of throwing.
    return { ok: false, status: 0, body: null };
  }
}

/**
 * POST/PUT counterpart of engineGet — same Basic auth, JSON body, 12s timeout,
 * same soft-fail (status 0 on unreachable). Used by the payment gateway to
 * confirm intents and by the write methods below.
 */
export async function engineSend(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<WoopayEngineResult> {
  const c = cfg();
  if (!c) return { ok: false, status: 0, body: null };
  try {
    const res = await fetch(`${c.base}${path}`, {
      method,
      headers: {
        authorization: 'Basic ' + Buffer.from(c.auth).toString('base64'),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { ok: res.ok, status: res.status, body: parseBody(await res.text()) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

// ── shared normalisers ─────────────────────────────────────────────────────

/** Map an engine failure to the same human reasons overview() uses. */
function reasonFor(r: WoopayEngineResult): string {
  if (r.status === 0) return 'Engine unreachable.';
  if (r.status === 401) return 'Bridge credential rejected by the engine.';
  const msg = (r.body as { message?: string } | null)?.message;
  return typeof msg === 'string' && msg ? msg : `Engine returned ${r.status}.`;
}

/** Engine list routes wrap rows in { data:[...] }; some return a bare array. */
function rowsOf(body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown } | null)?.data ?? body;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/**
 * The engine mixes date encodings: deposits give a millisecond epoch number,
 * transactions give "YYYY-MM-DD HH:MM:SS", disputes a second epoch. Normalise
 * all three to an ISO string (or null).
 */
function toIso(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' && v > 0) {
    return new Date(v > 1e12 ? v : v * 1000).toISOString();
  }
  return null;
}

function clampPer(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

function mapDeposit(d: Record<string, unknown>): WoopayDeposit {
  return {
    id: String(d.id ?? ''),
    amount: Number(d.amount ?? 0),
    status: String(d.status ?? ''),
    date: toIso(d.date),
    type: typeof d.type === 'string' ? d.type : null,
    currency: String(d.currency ?? 'usd').toUpperCase(),
    bankAccount: typeof d.bankAccount === 'string' ? d.bankAccount : null,
    automatic: d.automatic === true,
    fee: Number(d.fee ?? 0),
  };
}

function mapTransaction(t: Record<string, unknown>): WoopayTransaction {
  return {
    id: String(t.transaction_id ?? t.id ?? ''),
    type: String(t.type ?? ''),
    date: toIso(t.date),
    source: typeof t.source === 'string' ? t.source : null,
    customerName: typeof t.customer_name === 'string' ? t.customer_name.trim() : null,
    customerEmail: typeof t.customer_email === 'string' ? t.customer_email : null,
    amount: Number(t.amount ?? 0),
    net: Number(t.net ?? 0),
    fees: Number(t.fees ?? 0),
    currency: String(t.currency ?? 'usd').toUpperCase(),
    orderId: typeof t.order_id === 'number' ? t.order_id : null,
    chargeId: typeof t.charge_id === 'string' ? t.charge_id : null,
    depositId: typeof t.deposit_id === 'string' ? t.deposit_id : null,
    riskLevel: typeof t.risk_level === 'number' ? t.risk_level : null,
  };
}

function mapDispute(d: Record<string, unknown>): WoopayDispute {
  const ev = (d.evidence_details ?? {}) as Record<string, unknown>;
  const order = (d.order ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? ''),
    amount: Number(d.amount ?? 0),
    currency: String(d.currency ?? 'usd').toUpperCase(),
    reason: typeof d.reason === 'string' ? d.reason : null,
    status: typeof d.status === 'string' ? d.status : null,
    created: toIso(d.created ?? d.date),
    dueBy: toIso(ev.due_by),
    orderId: typeof order.number === 'number' ? order.number
      : typeof d.order_id === 'number' ? d.order_id : null,
    chargeId: typeof d.charge_id === 'string' ? d.charge_id
      : typeof d.charge === 'string' ? d.charge : null,
  };
}

// ── types ──────────────────────────────────────────────────────────────────

export interface WoopayDeposit {
  id: string;
  amount: number;
  status: string;
  date: string | null;
  type: string | null;
  currency: string;
  bankAccount: string | null;
  automatic: boolean;
  fee: number;
}

export interface WoopayTransaction {
  id: string;
  type: string;
  date: string | null;
  source: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amount: number;
  net: number;
  fees: number;
  currency: string;
  orderId: number | null;
  chargeId: string | null;
  depositId: string | null;
  riskLevel: number | null;
}

export interface WoopayTransactionSummary {
  count: number;
  total: number;
  fees: number;
  net: number;
  currency: string;
  sources: string[];
}

export interface WoopayDispute {
  id: string;
  amount: number;
  currency: string;
  reason: string | null;
  status: string | null;
  created: string | null;
  dueBy: string | null;
  orderId: number | null;
  chargeId: string | null;
}

export interface WoopayDisputeSummary {
  count: number;
  currencies: string[];
}

export interface WoopayDepositSchedule {
  interval: string | null;
  weeklyAnchor: string | null;
  monthlyAnchor: number | null;
  delayDays: number | null;
  status: string | null;
}

export interface WoopayTransactions {
  ok: boolean;
  reason?: string;
  rows: WoopayTransaction[];
  summary: WoopayTransactionSummary | null;
}

export interface WoopayDeposits {
  ok: boolean;
  reason?: string;
  rows: WoopayDeposit[];
}

export interface WoopayDisputes {
  ok: boolean;
  reason?: string;
  rows: WoopayDispute[];
  summary: WoopayDisputeSummary | null;
}

export interface WoopaySettings {
  ok: boolean;
  reason?: string;
  enabledMethods: string[];
  availableMethods: string[];
  depositSchedule: WoopayDepositSchedule;
}

/** Input for setDepositSchedule — maps onto the engine's deposit_schedule_* keys. */
export interface WoopayDepositScheduleInput {
  interval: string;
  weekly_anchor?: string;
  monthly_anchor?: number;
}

export interface WoopayWriteResult {
  ok: boolean;
  reason?: string;
  body?: unknown;
}

export interface WoopayOverview {
  connected: boolean;
  reason?: string;
  /** Where the operator completes the one-time WordPress.com sign-in. */
  connectUrl: string;
  account?: {
    status: string | null;
    depositsEnabled: boolean;
    depositSchedule: string | null;
    instantEligible: boolean;
    instantFeePct: number | null;
  };
  balance?: { available: number; pending: number; instant: number; currency: string };
  recentDeposits?: WoopayDeposit[];
}

export const woopayBridge = {
  async overview(): Promise<WoopayOverview> {
    const c = cfg();
    const connectUrl = (c?.base ?? process.env.PUBLIC_ORIGIN ?? '').replace(/\/api$/, '')
      + '/wp-admin/admin.php?page=wc-admin&path=%2Fpayments%2Fconnect';
    if (!c) return { connected: false, reason: 'Bridge credential not configured (WOOPAY_BRIDGE_URL / WOOPAY_BRIDGE_AUTH).', connectUrl };

    // Account status — 404/500 before the merchant connect has happened.
    const acct = await engineGet('/wc/v3/payments/accounts');
    if (!acct.ok) {
      const reason = acct.status === 0 ? 'Engine unreachable.'
        : acct.status === 401 ? 'Bridge credential rejected by the engine.'
        : 'WooPayments is not connected yet — sign in once to attach the merchant account.';
      return { connected: false, reason, connectUrl };
    }
    // The REST /accounts route returns either the account object or an array
    // with it at [0]; normalise both.
    const raw = Array.isArray(acct.body) ? (acct.body[0] ?? {}) : (acct.body ?? {});
    const a = raw as Record<string, unknown>;
    // The engine answers even before a merchant is attached — WCPay reports
    // status NOACCOUNT until the one-time WordPress.com sign-in happens.
    if (a.status === 'NOACCOUNT' || a.status === 'ONBOARDING_DISABLED' || !a.status) {
      return { connected: false, reason: 'Engine ready — connect the WooPayments merchant account.', connectUrl };
    }
    const depositsBlock = (a.deposits ?? {}) as Record<string, unknown>;
    const instant = a.instant_deposits_eligible === true;
    const interval = typeof depositsBlock.interval === 'string' ? depositsBlock.interval : null;
    const delay = typeof depositsBlock.delay_days === 'number' ? depositsBlock.delay_days : null;

    const out: WoopayOverview = {
      connected: true,
      connectUrl,
      account: {
        status: typeof a.status === 'string' ? a.status : null,
        depositsEnabled: depositsBlock.status === 'enabled',
        depositSchedule: interval ? (delay != null ? `${interval}, ${delay}-day` : interval) : null,
        instantEligible: instant,
        instantFeePct: instant ? 1.5 : null,
      },
    };

    // Balance / deposits overview — shapes come from WCPay's own dashboard API.
    const ov = await engineGet('/wc/v3/payments/deposits/overview-all');
    if (ov.ok && ov.body && typeof ov.body === 'object') {
      // Live shape is body.balance (singular) with available/pending/instant
      // arrays of { amount, currency }. (Earlier code read body.balances and
      // always got zeros.)
      const b = ((ov.body as { balance?: unknown }).balance ?? {}) as {
        available?: { amount?: number; currency?: string }[];
        pending?: { amount?: number }[];
        instant?: { amount?: number }[];
      };
      const avail = b.available?.[0];
      out.balance = {
        available: avail?.amount ?? 0,
        pending: b.pending?.[0]?.amount ?? 0,
        instant: b.instant?.[0]?.amount ?? 0,
        currency: (avail?.currency ?? 'usd').toUpperCase(),
      };
    }
    // The engine 400s ("Unknown sort present in query") without an explicit
    // sort, so it must be passed.
    const dep = await engineGet('/wc/v3/payments/deposits?sort=date&direction=desc&per_page=5');
    if (dep.ok) {
      out.recentDeposits = rowsOf(dep.body).slice(0, 5).map(mapDeposit);
    }
    return out;
  },

  /**
   * The connected account's live publishable key + id — everything the browser
   * needs to build Stripe.js against the WooPayments merchant (new Stripe(pk,
   * {stripeAccount})) and confirm an intent in-page. Cached briefly; these
   * rotate rarely and a checkout page should not wait on the engine each load.
   */
  async clientKeys(): Promise<{ publishableKey: string | null; accountId: string | null }> {
    if (keyCache && Date.now() - keyCache.at < 300_000) {
      return { publishableKey: keyCache.publishableKey, accountId: keyCache.accountId };
    }
    const r = await engineGet('/wc/v3/payments/accounts');
    if (!r.ok) return { publishableKey: null, accountId: null };
    const a = (Array.isArray(r.body) ? (r.body[0] ?? {}) : (r.body ?? {})) as Record<string, unknown>;
    const publishableKey = typeof a.live_publishable_key === 'string' ? a.live_publishable_key : null;
    const accountId = typeof a.account_id === 'string' ? a.account_id : null;
    if (publishableKey && accountId) keyCache = { publishableKey, accountId, at: Date.now() };
    return { publishableKey, accountId };
  },

  /** Recent transactions (charges/payments) plus the account summary totals. */
  async transactions(limit = 25): Promise<WoopayTransactions> {
    const per = clampPer(limit);
    const list = await engineGet(`/wc/v3/payments/transactions?per_page=${per}`);
    if (!list.ok) return { ok: false, reason: reasonFor(list), rows: [], summary: null };
    const rows = rowsOf(list.body).map(mapTransaction);
    let summary: WoopayTransactionSummary | null = null;
    const sum = await engineGet('/wc/v3/payments/transactions/summary');
    if (sum.ok && sum.body && typeof sum.body === 'object') {
      const s = sum.body as Record<string, unknown>;
      summary = {
        count: Number(s.count ?? 0),
        total: Number(s.total ?? 0),
        fees: Number(s.fees ?? 0),
        net: Number(s.net ?? 0),
        currency: String(s.currency ?? 'usd').toUpperCase(),
        sources: Array.isArray(s.sources) ? (s.sources as unknown[]).map(String) : [],
      };
    }
    return { ok: true, rows, summary };
  },

  /** Payout history, newest first (engine requires the explicit sort). */
  async deposits(limit = 25): Promise<WoopayDeposits> {
    const per = clampPer(limit);
    const list = await engineGet(`/wc/v3/payments/deposits?sort=date&direction=desc&per_page=${per}`);
    if (!list.ok) return { ok: false, reason: reasonFor(list), rows: [] };
    return { ok: true, rows: rowsOf(list.body).map(mapDeposit) };
  },

  /** Open/closed disputes plus the summary count. */
  async disputes(limit = 25): Promise<WoopayDisputes> {
    const per = clampPer(limit);
    const list = await engineGet(`/wc/v3/payments/disputes?per_page=${per}`);
    if (!list.ok) return { ok: false, reason: reasonFor(list), rows: [], summary: null };
    const rows = rowsOf(list.body).map(mapDispute);
    let summary: WoopayDisputeSummary | null = null;
    const sum = await engineGet('/wc/v3/payments/disputes/summary');
    if (sum.ok && sum.body && typeof sum.body === 'object') {
      const s = sum.body as Record<string, unknown>;
      summary = {
        count: Number(s.count ?? 0),
        currencies: Array.isArray(s.currencies) ? (s.currencies as unknown[]).map(String) : [],
      };
    }
    return { ok: true, rows, summary };
  },

  /** Enabled/available payment methods and the current deposit schedule. */
  async settings(): Promise<WoopaySettings> {
    const emptySchedule: WoopayDepositSchedule = {
      interval: null, weeklyAnchor: null, monthlyAnchor: null, delayDays: null, status: null,
    };
    const r = await engineGet('/wc/v3/payments/settings');
    if (!r.ok || !r.body || typeof r.body !== 'object') {
      return { ok: false, reason: reasonFor(r), enabledMethods: [], availableMethods: [], depositSchedule: emptySchedule };
    }
    const s = r.body as Record<string, unknown>;
    return {
      ok: true,
      enabledMethods: Array.isArray(s.enabled_payment_method_ids) ? (s.enabled_payment_method_ids as unknown[]).map(String) : [],
      availableMethods: Array.isArray(s.available_payment_method_ids) ? (s.available_payment_method_ids as unknown[]).map(String) : [],
      depositSchedule: {
        interval: typeof s.deposit_schedule_interval === 'string' ? s.deposit_schedule_interval : null,
        weeklyAnchor: typeof s.deposit_schedule_weekly_anchor === 'string' && s.deposit_schedule_weekly_anchor ? s.deposit_schedule_weekly_anchor : null,
        monthlyAnchor: typeof s.deposit_schedule_monthly_anchor === 'number' ? s.deposit_schedule_monthly_anchor : null,
        delayDays: typeof s.deposit_delay_days === 'number' ? s.deposit_delay_days : null,
        status: typeof s.deposit_status === 'string' ? s.deposit_status : null,
      },
    };
  },

  // ── writes ────────────────────────────────────────────────────────────────
  // Defined from the verified route shapes; never called during this build.

  /** Trigger an instant payout of the available balance for a currency. */
  async instantPayout(currency: string): Promise<WoopayWriteResult> {
    const r = await engineSend('POST', '/wc/v3/payments/deposits', { type: 'instant', currency });
    return r.ok ? { ok: true, body: r.body } : { ok: false, reason: reasonFor(r) };
  },

  /** Change the automatic payout cadence (daily/weekly/monthly + anchor). */
  async setDepositSchedule(schedule: WoopayDepositScheduleInput): Promise<WoopayWriteResult> {
    const body: Record<string, unknown> = { deposit_schedule_interval: schedule.interval };
    if (schedule.weekly_anchor != null) body.deposit_schedule_weekly_anchor = schedule.weekly_anchor;
    if (schedule.monthly_anchor != null) body.deposit_schedule_monthly_anchor = schedule.monthly_anchor;
    const r = await engineSend('PUT', '/wc/v3/payments/settings', body);
    return r.ok ? { ok: true, body: r.body } : { ok: false, reason: reasonFor(r) };
  },

  /** Set the enabled payment method ids (card, klarna, …). */
  async setEnabledMethods(ids: string[]): Promise<WoopayWriteResult> {
    const r = await engineSend('PUT', '/wc/v3/payments/settings', { enabled_payment_method_ids: ids });
    return r.ok ? { ok: true, body: r.body } : { ok: false, reason: reasonFor(r) };
  },

  /** Submit (or save as draft) evidence for a dispute. */
  async respondDispute(id: string, evidence: Record<string, string>, submit: boolean): Promise<WoopayWriteResult> {
    const r = await engineSend('POST', `/wc/v3/payments/disputes/${encodeURIComponent(id)}`, { evidence, submit });
    return r.ok ? { ok: true, body: r.body } : { ok: false, reason: reasonFor(r) };
  },

  /** Accept a dispute (close it, forfeiting the charge). */
  async closeDispute(id: string): Promise<WoopayWriteResult> {
    const r = await engineSend('POST', `/wc/v3/payments/disputes/${encodeURIComponent(id)}/close`);
    return r.ok ? { ok: true, body: r.body } : { ok: false, reason: reasonFor(r) };
  },
};
