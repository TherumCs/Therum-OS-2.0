import { verifyStripeSignature } from '../webhookSignatures.js';
import type { OrderForPayment, PaymentGateway, PaymentIntentResult, PspWebhookEvent } from './gateway.js';

// Stripe via its real REST API (form-encoded, no SDK dependency — fetch
// only, same posture as the Nexus testers). Credential = the Stripe secret
// key stored in the Nexus vault. Webhook signing secret comes from Nexus's
// WebhookSecret store (passed in as the verify credential by the service).

const API = 'https://api.stripe.com/v1';

async function stripePost(path: string, secretKey: string, form: Record<string, string>, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(`Stripe ${res.status}: ${err?.message ?? 'request failed'}`);
  }
  return json;
}

// payment_intent.succeeded → payment.succeeded, etc. Unknown types map to
// their raw name — the receiver ignores unknown kinds by design.
// refund.updated is NOT here: its canonical kind depends on the refund
// object's own status (audit H-2 — Stripe emits refund.updated for FAILED
// refunds too; a fixed mapping recorded failed refunds as succeeded).
const KIND_MAP: Record<string, string> = {
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
  'charge.refunded': 'payment.refunded',
  'refund.failed': 'refund.failed',
  'charge.dispute.created': 'dispute.opened',
  'charge.dispute.funds_withdrawn': 'dispute.lost',
  'charge.dispute.funds_reinstated': 'dispute.won',
};

function refundUpdatedKind(status: string): string {
  if (status === 'succeeded') return 'refund.succeeded';
  if (status === 'failed' || status === 'canceled') return 'refund.failed';
  return 'refund.pending'; // in-flight — ledgered, no handler acts on it
}

export const stripeGateway: PaymentGateway = {
  id: () => 'stripe',
  displayName: () => 'Stripe',
  supports: (c) => ['refunds', 'partial_refunds', 'webhooks', 'card', 'wallet_apple', 'wallet_google'].includes(c),

  // In-page payment from a Stripe.js payment-method id. Same reasoning as
  // Square's: tokenised in the browser, confirmed here, no PAN in this system.
  async payWithToken(order: OrderForPayment, credential: string, token: string, idempotencyKey: string): Promise<string> {
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: new URLSearchParams({
        amount: String(order.total),
        currency: order.currency.toLowerCase(),
        payment_method: token,
        confirm: 'true',
        'automatic_payment_methods[enabled]': 'true',
        'automatic_payment_methods[allow_redirects]': 'never',
        description: `Order ${order.number}`,
      }),
    });
    const body = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !body.id) throw new Error(body.error?.message ?? `Stripe returned ${res.status}`);
    return body.id;
  },

  async createIntent(order: OrderForPayment, credential: string): Promise<PaymentIntentResult> {
    const pi = await stripePost('/payment_intents', credential, {
      amount: String(order.total),
      currency: order.currency.toLowerCase(),
      'metadata[order_id]': order.id,
      'metadata[order_number]': order.number,
      'automatic_payment_methods[enabled]': 'true',
    });
    return {
      providerId: 'stripe',
      intentId: String(pi.id),
      status: String(pi.status),
      clientSecret: typeof pi.client_secret === 'string' ? pi.client_secret : null,
      redirectUrl: null,
    };
  },

  async refund(_order: OrderForPayment, amountMinor: number, idempotencyKey: string, credential: string, ctx: { intentId: string }): Promise<string> {
    const re = await stripePost('/refunds', credential, { payment_intent: ctx.intentId, amount: String(amountMinor) }, idempotencyKey);
    return String(re.id);
  },

  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const header = headers['stripe-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!sig) return null;
    if (!verifyStripeSignature(rawBody, sig, credential)) {
      throw new Error('Stripe webhook signature mismatch');
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    const type = String(verified.type ?? '');
    const data = (verified.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
    const objId = typeof data.id === 'string' ? data.id : null;
    const isRefundObject = objId?.startsWith('re_') ?? false;
    const intentFromObj = typeof data.payment_intent === 'string' ? data.payment_intent : objId?.startsWith('pi_') ? objId : null;
    const kind = type === 'refund.updated' ? refundUpdatedKind(String(data.status ?? '')) : (KIND_MAP[type] ?? type);
    // metadata[order_id] rides every intent we create — the fallback that
    // lets a webhook resolve its order even if payment.txnId was later
    // overwritten by a second intent (audit M-1).
    const metadata = (data.metadata as Record<string, unknown> | undefined) ?? {};
    const orderId = typeof metadata.order_id === 'string' ? metadata.order_id : null;
    return {
      providerId: 'stripe',
      providerEventId: String(verified.id ?? ''),
      kind,
      paymentIntentId: intentFromObj,
      refundId: isRefundObject ? objId : null,
      payload: { type, ...(orderId ? { orderId } : {}) },
    };
  },

  async intentStatus(intentId: string, credential: string): Promise<string> {
    const res = await fetch(`${API}/payment_intents/${encodeURIComponent(intentId)}`, {
      headers: { Authorization: `Bearer ${credential}` },
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Stripe ${res.status}`);
    return String(json.status);
  },
};
