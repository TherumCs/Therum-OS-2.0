import { createHmac, timingSafeEqual } from 'node:crypto';
import { engineGet, engineSend } from '../../counter/woopayBridge.js';
import type { OrderForPayment, PaymentGateway, PaymentIntentResult, PspWebhookEvent } from './gateway.js';

// WooPayments via the headless WooCommerce+WooPayments engine at /var/www/pay
// on the VPS (upstream 127.0.0.1:8088, reached publicly on the carved
// /wp-json/wc/v3/payments/* paths under the store's public origin). This is the LIVE
// merchant rail — the WooPayments/WCPay merchant account, is_live, US/USD — Stripe rails run
// through WCPay's own account, giving instant payout that a raw Stripe key
// does not. We never touch the engine directly: every call goes through the
// Nexus bridge (src/counter/woopayBridge — engineGet / engineSend, which hold
// the engine's HTTP Basic app-password credential in env). That is why the
// per-call `credential` (Stripe-style secret key) is unused for
// create/refund/status here — the bridge authenticates; `credential` matters
// only to verifyWebhook, where it is the bridge webhook secret
// (SM_BRIDGE_SECRET on the engine, WEBHOOK_SECRET in Fastify).
//
// Flow: createIntent → engine mints an UNCONFIRMED WCPay PaymentIntent (no
// off_session) → we hand back client_secret + publishable_key + account_id so
// the storefront confirms IN-PAGE (Stripe.js, no redirect). WCPay's own
// webhook (Stripe → WP.com → engine) runs $order->payment_complete once; the
// engine then POSTs the Therum bridge webhook to our Fastify receiver, signed
// x-therum-signature = hex HMAC-SHA256(rawBody, secret), body
// {type, orderId (OUR order id), txnId?, method?} — that is what
// verifyWebhook / parseEvent below decode.
//
// DOCTRINE CONFLICT (flagged, not resolved here): squareGateway.ts's header
// asserts "WooPayments ... NOT a separate integration ... absorbed (= Stripe
// rails + instant payout)". The live deployment contradicts that note — the
// engine is a real headless WooPayments instance and this gateway is the seam
// to it. Integrator: reconcile the stale comment with this file.

const CHARGE_PATH = '/wc/v3/payments/sm/charge';
const REFUND_PATH = '/wc/v3/payments/refund';
const INTENT_PATH = '/wc/v3/payments/payment_intents/';

// The shopper's chosen method → the WCPay/Stripe payment_method_type the intent
// must be created with. Card, the express wallets (Apple/Google Pay) and Link
// all confirm as 'card' in-page; the BNPL rails each need their own type so the
// browser can confirm them (confirmKlarnaPayment, …) and redirect.
const WOOPAY_PMT: Record<string, string[]> = {
  card: ['card'],
  apple_pay: ['card'],
  google_pay: ['card'],
  link: ['card'],
  klarna: ['klarna'],
  affirm: ['affirm'],
  afterpay: ['afterpay_clearpay'],
  cashapp: ['cashapp'],
};
function methodsFor(fundingMethod?: string): string[] {
  return (fundingMethod && WOOPAY_PMT[fundingMethod]) || ['card'];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// WCPay/Stripe intent JSON has moved the charge id around across API versions
// (latest_charge on new, charges.data[0].id on old) and the engine may expose
// its own field — probe all of them so a refund can find the charge to hit.
function chargeIdFromIntent(intent: Record<string, unknown>): string | null {
  const direct = str(intent.charge_id) ?? str(intent.latest_charge) ?? str(asRecord(intent.charge).id);
  if (direct) return direct;
  const charges = asRecord(intent.charges);
  const data = Array.isArray(charges.data) ? (charges.data as unknown[]) : [];
  return str(asRecord(data[0]).id);
}

export const woopayGateway: PaymentGateway = {
  id: () => 'woopay',
  displayName: () => 'WooPayments',
  // Stripe rails: card + Apple/Google Pay confirm in-page under the 'card'
  // payment-method type. BNPL / Cash App are reachable on the WCPay rail but
  // are NOT declared — createIntent (below) has no funding-method input to
  // select them (see risks); declaring them would light up a dead path.
  supports: (c) => ['refunds', 'partial_refunds', 'webhooks', 'card', 'wallet_apple', 'wallet_google'].includes(c),

  async createIntent(
    order: OrderForPayment,
    _credential: string,
    ctx?: { fundingMethod?: string; returnUrl?: string; cancelUrl?: string },
  ): Promise<PaymentIntentResult> {
    // order.total is already minor units (see OrderForPayment); the engine's
    // charge route sets_amount(cents:int). The intent's payment_method_types are
    // pinned to the shopper's chosen method so card/wallet confirm in-page and
    // each BNPL rail can confirm+redirect on its own type.
    const res = await engineSend('POST', CHARGE_PATH, {
      amount: order.total,
      currency: (order.currency || 'usd').toLowerCase(),
      sm_order_id: order.id,
      sm_order_number: order.number,
      methods: methodsFor(ctx?.fundingMethod),
    });
    if (!res.ok) throw new Error(`WooPayments charge ${res.status}`);
    const body = asRecord(res.body);
    const intentId = str(body.payment_intent_id);
    const clientSecret = str(body.client_secret);
    if (!intentId || !clientSecret) throw new Error('WooPayments charge response missing payment_intent_id/client_secret');
    return {
      providerId: 'woopay',
      intentId,
      // Engine returns an UNCONFIRMED intent (client confirms in-page).
      status: str(body.status) ?? 'requires_action',
      clientSecret,
      redirectUrl: null,
      // PaymentIntentResult has no publishableKey/stripeAccount fields — the
      // in-page confirm step needs both, so they ride in `extra` (see risks).
      extra: { publishableKey: str(body.publishable_key), stripeAccount: str(body.account_id) },
    };
  },

  async refund(order: OrderForPayment, amountMinor: number, _idempotencyKey: string, _credential: string, ctx: { intentId: string }): Promise<string> {
    // ctx carries only the intent id (pi_…); the engine refunds a CHARGE, so
    // resolve the charge from the intent first.
    const got = await engineGet(INTENT_PATH + encodeURIComponent(ctx.intentId));
    if (!got.ok) throw new Error(`WooPayments intent lookup ${got.status}`);
    const chargeId = chargeIdFromIntent(asRecord(got.body));
    if (!chargeId) throw new Error('WooPayments intent has no charge to refund');
    const res = await engineSend('POST', REFUND_PATH, {
      charge_id: chargeId,
      amount: amountMinor,
      reason: `Refund for order ${order.number}`,
    });
    if (!res.ok) throw new Error(`WooPayments refund ${res.status}`);
    const body = asRecord(res.body);
    const refundId = str(body.refund_id) ?? str(body.id) ?? str(asRecord(body.refund).id);
    if (!refundId) throw new Error('WooPayments refund response missing id');
    return refundId;
  },

  // The engine's WCPay webhook is consumed by the engine itself; what reaches
  // US is the Therum bridge webhook: x-therum-signature = hex
  // HMAC-SHA256(rawBody, secret), secret = the bridge webhook secret passed as
  // `credential`. Verified inline (mirrors squareGateway) — no bare-hex helper
  // is exported from webhookSignatures.
  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const header = headers['x-therum-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!sig) return null;
    const expected = createHmac('sha256', credential).update(rawBody).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('WooPayments (bridge) webhook signature mismatch');
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    // Bridge body {type, orderId (OUR order id), txnId?, method?}. type is
    // already canonical ('payment.succeeded' | 'payment.failed') — identity
    // map, unknown kinds pass through for the receiver to ignore.
    const type = String(verified.type ?? '');
    const orderId = str(verified.orderId);
    const txnId = str(verified.txnId);
    const method = str(verified.method);
    return {
      providerId: 'woopay',
      // Bridge carries no dedicated event id; txnId (or the order id) is the
      // dedup key. orderService.markPaid is itself idempotent (certified).
      providerEventId: txnId ?? orderId ?? '',
      kind: type,
      paymentIntentId: txnId,
      refundId: null,
      // orderId is OUR order id — the direct resolver, mirrors the stripe M-1
      // fallback of riding order_id in the payload.
      payload: { type, ...(orderId ? { orderId } : {}), ...(method ? { method } : {}) },
    };
  },

  async intentStatus(intentId: string, _credential: string): Promise<string> {
    const got = await engineGet(INTENT_PATH + encodeURIComponent(intentId));
    if (!got.ok) throw new Error(`WooPayments intent ${got.status}`);
    const status = String(asRecord(got.body).status ?? '');
    if (status === 'succeeded') return 'succeeded';
    if (status === 'processing' || status.startsWith('requires_')) return 'processing';
    if (status === 'canceled' || status === 'failed') return 'failed';
    return status;
  },
};
