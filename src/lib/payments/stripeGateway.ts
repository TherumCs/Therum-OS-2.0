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
  async payWithToken(
    order: OrderForPayment,
    credential: string,
    token: string,
    idempotencyKey: string,
    vault?: { customerId?: string | null; save?: boolean; offSession?: boolean },
  ): Promise<string> {
    // VAULTING happens as part of the charge, not as a second call.
    // `setup_future_usage` tells Stripe to keep the card against the customer
    // once this payment succeeds, so a shopper is never charged for a card
    // that then fails to save — the two outcomes cannot diverge.
    // `off_session` is the other direction: paying WITH an already-saved card,
    // where the shopper is not re-entering anything.
    const params: Record<string, string> = {
      amount: String(order.total),
      currency: order.currency.toLowerCase(),
      payment_method: token,
      confirm: 'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      description: `Order ${order.number}`,
    };
    if (vault?.customerId) params.customer = vault.customerId;
    if (vault?.save && vault.customerId) params.setup_future_usage = 'off_session';
    if (vault?.offSession) params.off_session = 'true';

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: new URLSearchParams(params),
    });
    const body = (await res.json()) as { id?: string; status?: string; error?: { message?: string } };
    if (!res.ok || !body.id) throw new Error(body.error?.message ?? `Stripe returned ${res.status}`);
    // NEVER report success for an intent that did not actually capture. A card
    // needing 3-D Secure comes back `requires_action` with an id but no money
    // taken; returning that id drove the order to PAID with nothing charged.
    if (body.status !== 'succeeded') {
      throw new Error(body.status === 'requires_action'
        ? 'This card needs extra authentication (3-D Secure) that this checkout cannot finish in-page. Try another card or use a wallet.'
        : `Payment not completed (status: ${body.status ?? 'unknown'}).`);
    }
    return body.id;
  },

  async createIntent(
    order: OrderForPayment,
    credential: string,
    ctx?: { fundingMethod?: string; returnUrl?: string; cancelUrl?: string },
  ): Promise<PaymentIntentResult> {
    const { settingsService } = await import('../../services/settings.service.js');

    // ── Redirect / off-card methods (Klarna, Affirm, Afterpay, Cash App, ACH) ──
    // These were OFFERED at checkout but had no settlement path: the client only
    // knew card, wallet and PayPal, so picking Klarna created an order and then
    // showed "success" without ever charging. Here Stripe CONFIRMS the intent
    // server-side against a single method type + a return_url and hands back the
    // redirect the shopper is sent to — the same shape PayPal already uses.
    // Billing + shipping come off the order because Klarna/Affirm/Afterpay
    // require them or refuse at confirmation.
    const STRIPE_TYPE: Record<string, string> = {
      klarna: 'klarna', affirm: 'affirm', afterpay: 'afterpay_clearpay',
      cashapp: 'cashapp', bank_ach: 'us_bank_account',
    };
    const pmType = ctx?.fundingMethod ? STRIPE_TYPE[ctx.fundingMethod] : undefined;

    if (pmType && ctx?.returnUrl) {
      const { db } = await import('../../lib/db.js');
      const o = await db.order.findUnique({ where: { id: order.id }, select: { guestEmail: true, shipAddress: true } });
      const a = (o?.shipAddress && typeof o.shipAddress === 'object' ? o.shipAddress : {}) as Record<string, string>;
      const email = o?.guestEmail ?? '';
      const country = (a.country ?? 'US').toUpperCase();
      const postal = a.postal ?? a.postalCode ?? '';
      const form: Record<string, string> = {
        amount: String(order.total),
        currency: order.currency.toLowerCase(),
        'metadata[order_id]': order.id,
        'metadata[order_number]': order.number,
        confirm: 'true',
        return_url: ctx.returnUrl,
        'payment_method_types[]': pmType,
        'payment_method_data[type]': pmType,
      };
      if (email) { form['payment_method_data[billing_details][email]'] = email; form.receipt_email = email; }
      if (a.name) form['payment_method_data[billing_details][name]'] = a.name;
      if (a.line1) {
        const bd = 'payment_method_data[billing_details][address]';
        form[`${bd}[line1]`] = a.line1;
        if (a.line2) form[`${bd}[line2]`] = a.line2;
        form[`${bd}[city]`] = a.city ?? '';
        if (a.region) form[`${bd}[state]`] = a.region;
        form[`${bd}[postal_code]`] = postal;
        form[`${bd}[country]`] = country;
        form['shipping[name]'] = a.name ?? email;
        form['shipping[address][line1]'] = a.line1;
        if (a.line2) form['shipping[address][line2]'] = a.line2;
        form['shipping[address][city]'] = a.city ?? '';
        if (a.region) form['shipping[address][state]'] = a.region;
        form['shipping[address][postal_code]'] = postal;
        form['shipping[address][country]'] = country;
      }
      const pi = await stripePost('/payment_intents', credential, form);
      // Different methods hand back the redirect in different shapes: Klarna/
      // Affirm/Afterpay use redirect_to_url; Cash App uses a hosted QR/redirect
      // instructions page. Take whichever is present.
      const next = pi.next_action as {
        redirect_to_url?: { url?: string };
        cashapp_handle_redirect_or_display_qr_code?: { hosted_instructions_url?: string };
      } | undefined;
      const redirectUrl = next?.redirect_to_url?.url
        ?? next?.cashapp_handle_redirect_or_display_qr_code?.hosted_instructions_url
        ?? null;
      return {
        providerId: 'stripe',
        intentId: String(pi.id),
        status: String(pi.status),
        clientSecret: typeof pi.client_secret === 'string' ? pi.client_secret : null,
        redirectUrl,
      };
    }

    // ── Default (card / PaymentElement): an unconfirmed intent + client secret ──
    // Pin the method configuration when one is set. Without it Stripe picks among
    // the account's configurations itself — this account has five, four flagged
    // default, from every Connect platform that ever onboarded the merchant.
    const configId = (await settingsService.getPayments()).stripePaymentMethodConfiguration;
    const pi = await stripePost('/payment_intents', credential, {
      amount: String(order.total),
      currency: order.currency.toLowerCase(),
      'metadata[order_id]': order.id,
      'metadata[order_number]': order.number,
      'automatic_payment_methods[enabled]': 'true',
      ...(configId ? { payment_method_configuration: configId } : {}),
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

// ─── Saved cards ──────────────────────────────────────────────────────────
//
// Deliberately NOT on the PaymentGateway interface. Vaulting is a Stripe
// shape here — a Customer with PaymentMethods attached — and Square's is a
// different model entirely. Widening the shared contract would make every
// gateway implement a concept it does not share.
//
// Nothing sensitive is stored on our side: the card lives at Stripe, and all
// this system ever holds is an opaque customer id plus the brand and last
// four for display.

/** Find or create the Stripe customer for this shopper. */
export async function stripeEnsureCustomer(
  credential: string,
  opts: { existingId?: string | null; email: string; name?: string | null },
): Promise<string> {
  if (opts.existingId) {
    // Confirm it still exists — a customer deleted in the Stripe dashboard
    // would otherwise fail every future charge for that shopper.
    const res = await fetch(`${API}/customers/${encodeURIComponent(opts.existingId)}`, {
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (res.ok) {
      const j = (await res.json()) as { deleted?: boolean };
      if (!j.deleted) return opts.existingId;
    }
  }
  const created = await stripePost('/customers', credential, {
    email: opts.email,
    ...(opts.name ? { name: opts.name } : {}),
  });
  return String(created.id);
}

/**
 * Forget a saved card.
 *
 * Detach, not delete: the PaymentMethod stops being usable for future
 * payments, and the charges already made with it keep their record — a
 * refund on last month's order still resolves. Deleting the history is not
 * something a "remove card" button should do.
 */
export async function stripeDetachCard(credential: string, paymentMethodId: string): Promise<void> {
  await stripePost(`/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, credential, {});
}

/** The cards this shopper has saved, for display only. */
export async function stripeSavedCards(
  credential: string,
  customerId: string,
): Promise<{ id: string; brand: string; last4: string; expMonth: number; expYear: number }[]> {
  const res = await fetch(
    `${API}/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=5`,
    { headers: { Authorization: `Bearer ${credential}` } },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { id: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } }[] };
  return (json.data ?? []).map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? 'card',
    last4: pm.card?.last4 ?? '••••',
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
  }));
}
