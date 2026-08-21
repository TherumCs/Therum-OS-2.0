import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrderForPayment, PaymentGateway, PaymentIntentResult, PspWebhookEvent } from './gateway.js';

// Square via its real REST API — fetch only, no SDK, same posture as the
// Stripe gateway. This is the second real rail (C5a): cards, Cash App Pay,
// Afterpay all ride Square's hosted checkout. Doctrine note: WooPayments and
// Braintree are NOT separate integrations — their logic is absorbed
// (WooPayments = Stripe rails + instant payout; Braintree = aggregation the
// method registry's provider routing already does).
//
// Credential (Nexus vault) = "accessToken|locationId" — Square needs both
// for checkout; single-string credential keeps the vault convention.
// Optional third segment "|sandbox" targets the sandbox host.
//
// Flow: createIntent → Payment Link (hosted checkout) → redirectUrl; the
// visitor pays on Square; payment.updated webhook (COMPLETED) marks paid.
// The webhook signature is HMAC-SHA256(notificationUrl + rawBody) with the
// webhook signature key (stored as the provider's WebhookSecret in Nexus,
// formatted "signatureKey|notificationUrl").

interface SquareCredential {
  token: string;
  locationId: string;
  host: string;
}

function parseCredential(credential: string): SquareCredential {
  const [token, locationId, env] = credential.split('|');
  if (!token || !locationId) throw new Error('Square credential must be "accessToken|locationId" (add "|sandbox" for sandbox)');
  return { token, locationId, host: env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com' };
}

async function squareCall(cred: SquareCredential, method: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${cred.host}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cred.token}`,
      'content-type': 'application/json',
      'Square-Version': '2025-01-23',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errors = json.errors as { detail?: string; code?: string }[] | undefined;
    throw new Error(`Square ${res.status}: ${errors?.[0]?.detail ?? errors?.[0]?.code ?? 'request failed'}`);
  }
  return json;
}

// Square payment.status / refund.status → canonical event kinds.
function paymentKind(status: string): string {
  if (status === 'COMPLETED') return 'payment.succeeded';
  if (status === 'FAILED' || status === 'CANCELED') return 'payment.failed';
  return 'payment.pending';
}
function refundKind(status: string): string {
  if (status === 'COMPLETED') return 'refund.succeeded';
  if (status === 'FAILED' || status === 'REJECTED') return 'refund.failed';
  return 'refund.pending';
}

export const squareGateway: PaymentGateway = {
  id: () => 'square',
  displayName: () => 'Square',
  supports: (c) => ['refunds', 'partial_refunds', 'webhooks', 'card', 'cashapp', 'afterpay', 'redirect'].includes(c),

  // In-page card / Apple Pay / Google Pay. The Web Payments SDK tokenises in
  // the browser and only the token arrives here, so no card number ever
  // touches this system. idempotency_key is scoped to the order so a retried
  // submit settles the same payment instead of charging twice.
  async payWithToken(order: OrderForPayment, credential: string, token: string, idempotencyKey: string): Promise<string> {
    const cred = parseCredential(credential);
    const res = await squareCall(cred, 'POST', '/v2/payments', {
      idempotency_key: idempotencyKey.slice(0, 45),
      source_id: token,
      amount_money: { amount: order.total, currency: order.currency },
      ...(cred.locationId ? { location_id: cred.locationId } : {}),
      note: `order_id:${order.id}`,
    });
    const payment = res.payment as { id?: string; status?: string } | undefined;
    if (!payment?.id) throw new Error('Square accepted the request but returned no payment id.');
    return payment.id;
  },

  async createIntent(order: OrderForPayment, credential: string): Promise<PaymentIntentResult> {
    const cred = parseCredential(credential);
    // Payment Link = hosted checkout. idempotency_key scoped to the order so
    // a double-submitted intent re-mints the same link, not a second charge
    // surface. order_id in the payment note is the reconcile fallback.
    const link = await squareCall(cred, 'POST', '/v2/online-checkout/payment-links', {
      idempotency_key: `link_${order.id}`.slice(0, 45),
      quick_pay: {
        name: `Order ${order.number}`,
        price_money: { amount: order.total, currency: order.currency },
        location_id: cred.locationId,
      },
      payment_note: `order_id:${order.id}`,
      checkout_options: {
        redirect_url: undefined, // storefront return leg lands with provider-return config (C5b)
      },
    });
    const pl = link.payment_link as { id?: string; url?: string; order_id?: string } | undefined;
    if (!pl?.id || !pl.url) throw new Error('Square payment link response missing id/url');
    return {
      providerId: 'square',
      // The Square ORDER id is what payment webhooks reference
      // (payment.order_id) — store it as the intent so events resolve.
      intentId: pl.order_id ?? pl.id,
      status: 'requires_action',
      clientSecret: null,
      redirectUrl: pl.url,
      extra: { paymentLinkId: pl.id },
    };
  },

  async refund(order: OrderForPayment, amountMinor: number, idempotencyKey: string, credential: string, ctx: { intentId: string }): Promise<string> {
    const cred = parseCredential(credential);
    /**
     * Resolve the PAYMENT to refund — and the stored intent id is one of TWO
     * kinds.
     *
     * A hosted payment link records the Square ORDER id, whose tenders name the
     * payment. A direct card charge (payWithToken) already IS a payment id.
     * Assuming the order shape made every card-charged order un-refundable
     * with "Order not found" — which reads as a missing order rather than as
     * the wrong lookup.
     */
    const id = encodeURIComponent(ctx.intentId);
    let paymentId: string | undefined;
    try {
      const pay = await squareCall(cred, 'GET', `/v2/payments/${id}`);
      paymentId = (pay.payment as { id?: string } | undefined)?.id;
    } catch {
      const ord = await squareCall(cred, 'GET', `/v2/orders/${id}`);
      const tenders = (ord.order as { tenders?: { payment_id?: string }[] } | undefined)?.tenders ?? [];
      paymentId = tenders[0]?.payment_id;
    }
    if (!paymentId) throw new Error('Square order has no payment to refund');
    const re = await squareCall(cred, 'POST', '/v2/refunds', {
      idempotency_key: idempotencyKey.slice(0, 45),
      payment_id: paymentId,
      amount_money: { amount: amountMinor, currency: order.currency },
      reason: `Refund for order ${order.number}`,
    });
    const refund = re.refund as { id?: string } | undefined;
    if (!refund?.id) throw new Error('Square refund response missing id');
    return refund.id;
  },

  // credential = "signatureKey|notificationUrl" (Nexus WebhookSecret).
  // Square signs HMAC-SHA256(notificationUrl + rawBody), base64.
  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const header = headers['x-square-hmacsha256-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!sig) return null;
    const [signatureKey, notificationUrl] = credential.split('|');
    if (!signatureKey || !notificationUrl) throw new Error('Square webhook credential must be "signatureKey|notificationUrl"');
    const expected = createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Square webhook signature mismatch');
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    const type = String(verified.type ?? '');
    const data = (verified.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};

    if (type === 'payment.created' || type === 'payment.updated') {
      const p = (data.payment as Record<string, unknown> | undefined) ?? {};
      // payment.order_id ties back to the intent (the Square order id).
      const note = typeof p.note === 'string' ? p.note : '';
      const orderId = /order_id:([\w-]+)/.exec(note)?.[1] ?? null;
      return {
        providerId: 'square',
        providerEventId: String(verified.event_id ?? ''),
        kind: paymentKind(String(p.status ?? '')),
        paymentIntentId: typeof p.order_id === 'string' ? p.order_id : null,
        refundId: null,
        payload: { type, ...(orderId ? { orderId } : {}) },
      };
    }
    if (type === 'refund.created' || type === 'refund.updated') {
      const r = (data.refund as Record<string, unknown> | undefined) ?? {};
      return {
        providerId: 'square',
        providerEventId: String(verified.event_id ?? ''),
        kind: refundKind(String(r.status ?? '')),
        paymentIntentId: typeof r.order_id === 'string' ? r.order_id : null,
        refundId: typeof r.id === 'string' ? r.id : null,
        payload: { type },
      };
    }
    return {
      providerId: 'square',
      providerEventId: String(verified.event_id ?? ''),
      kind: type,
      paymentIntentId: null,
      refundId: null,
      payload: { type },
    };
  },

  /**
   * Status of whatever id we were given — and there are TWO kinds.
   *
   * `createIntent` (hosted payment link) records the Square ORDER id, because
   * that is what payment webhooks reference. `payWithToken` (a direct card
   * charge) returns a PAYMENT id. They are different namespaces, so looking
   * one up in the other's endpoint returns "Order not found" — which reads as
   * a missing order rather than as the wrong lookup, and left every
   * card-charged order stuck at its pre-payment status.
   *
   * Payment is tried first: it is the one a customer's card produces.
   */
  async intentStatus(intentId: string, credential: string): Promise<string> {
    const cred = parseCredential(credential);
    const id = encodeURIComponent(intentId);

    try {
      const res = await squareCall(cred, 'GET', `/v2/payments/${id}`);
      const status = String((res.payment as { status?: string } | undefined)?.status ?? '');
      // APPROVED is authorised but not captured — money has not moved, so it
      // must not read as succeeded.
      if (status === 'COMPLETED') return 'succeeded';
      if (status === 'CANCELED' || status === 'FAILED') return 'failed';
      if (status) return 'requires_action';
    } catch {
      // Not a payment id — fall through to the order lookup below.
    }

    const ord = await squareCall(cred, 'GET', `/v2/orders/${id}`);
    const state = String((ord.order as { state?: string } | undefined)?.state ?? '');
    if (state === 'COMPLETED') return 'succeeded';
    if (state === 'CANCELED') return 'failed';
    return 'requires_action';
  },
};
