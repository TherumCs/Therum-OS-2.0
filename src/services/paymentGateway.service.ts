import { createHash } from 'node:crypto';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors.js';
import { connectionService } from './connection.service.js';
import { orderService } from './order.service.js';
import { couponService } from './coupon.service.js';
import { commerceEmailService } from './commerceEmail.service.js';
import type { PaymentGateway, PspWebhookEvent } from '../lib/payments/gateway.js';
import { METHODS, METHOD_GROUPS } from '../lib/payments/methodRegistry.js';
import { mockGateway } from '../lib/payments/mockGateway.js';
import { stripeGateway } from '../lib/payments/stripeGateway.js';
import { squareGateway } from '../lib/payments/squareGateway.js';
import { paypalGateway } from '../lib/payments/paypalGateway.js';
import { sezzleGateway } from '../lib/payments/sezzleGateway.js';
import { woopayGateway } from '../lib/payments/woopayGateway.js';

// Counter C1 — the gateway orchestration layer. Gateways implement the 1.x
// PSPGateway contract (lib/payments/gateway.ts); this service owns:
//   - the registry + Nexus credential resolution ("available, setup
//     required" until the provider is connected in Nexus)
//   - guest auth on the public paths via Order.accessToken (constant-time)
//   - the canonical payment_events ledger (replay deduped on
//     UNIQUE(provider, provider_event_id); timestamp-less providers fall
//     back to sha256 of the raw signed body — 1.x provisions rule)
//   - refund accounting (atomic: refund row + refundedTotal + restock on
//     full refund)
// Doctrine: no check/eCheck gateway exists in this registry, ever.

const GATEWAYS: Record<string, PaymentGateway> = {
  mock: mockGateway,
  stripe: stripeGateway,
  square: squareGateway,
  paypal: paypalGateway,
  sezzle: sezzleGateway,
  woopay: woopayGateway,
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return ha.equals(hb);
}

async function requireGateway(providerId: string): Promise<{ gateway: PaymentGateway; credential: string }> {
  const gateway = GATEWAYS[providerId];
  if (!gateway) throw new NotFoundError('Unknown payment provider', 'provider');
  const credential = await connectionService.credentialFor(providerId);
  if (!credential) {
    throw new ConflictError(`${gateway.displayName()} is available but not set up — connect it in Nexus first.`, 'provider');
  }
  return { gateway, credential };
}

async function orderByNumberAndToken(orderNumber: string, accessToken: string) {
  const order = await db.order.findUnique({ where: { number: orderNumber }, include: { payment: true } });
  if (!order || !order.accessToken || !timingSafeEqualStr(order.accessToken, accessToken)) {
    // One error for both cases — no oracle for which part was wrong.
    throw new UnauthorizedError('Order not found or access token invalid.');
  }
  return order;
}

export const paymentGatewayService = {
  // What checkout offers. The PUBLIC list is connected gateways only —
  // anonymous callers don't get to enumerate which providers exist but
  // aren't set up (audit L-2). Admin surfaces (C6) use includeUnconnected.
  async available(includeUnconnected = false) {
    const out = [];
    for (const [id, g] of Object.entries(GATEWAYS)) {
      const connected = (await connectionService.credentialFor(id)) !== null;
      if (connected || includeUnconnected) {
        out.push({ id, name: g.displayName(), connected, setupRequired: !connected });
      }
    }
    return out;
  },

  // The checkout method strip (1.x MethodRegistry port): every method in the
  // registry, grouped, each resolved to the first CONNECTED provider on its
  // list. Unresolved methods still ship — rendered disabled as "setup
  // required" — so the full strip is always visible and lights up as
  // providers connect in Nexus. Public-safe: exposes method metadata and a
  // provider id, never connection details.
  async methods() {
    const connected = new Set<string>();
    for (const id of new Set(METHODS.flatMap((m) => m.providers))) {
      if ((await connectionService.credentialFor(id)) !== null) connected.add(id);
    }
    return {
      // Hidden methods are dropped here, not filtered in the browser — a
      // checkout that ships them and hides them with CSS still tells anyone
      // reading the response what the store does not offer.
      groups: METHOD_GROUPS.filter((g) => METHODS.some((m) => m.group === g.id && !m.hidden)),
      methods: METHODS.filter((m) => !m.hidden).map((m) => {
        const provider = m.providers.find((p) => connected.has(p)) ?? null;
        return { id: m.id, group: m.group, label: m.label, sub: m.sub ?? null, needsRedirect: m.needsRedirect, provider, available: provider !== null, comingSoon: m.comingSoon ?? false };
      }),
    };
  },

  // Guest-safe: authenticated by the order's own access token, not a session.
  /**
   * The shopper's Stripe customer id, created on first use and remembered.
   *
   * Stored on `Customer.meta` rather than a new column: it is one opaque
   * string, and a migration to hold it would have to be run on every
   * deployment before anyone could save a card. Nothing sensitive lives here
   * — the card itself never leaves Stripe.
   */
  async ensureVaultCustomer(customerId: string, email: string, name: string | null): Promise<string> {
    const row = await db.customer.findUnique({ where: { id: customerId }, select: { meta: true } });
    const meta = (row?.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
    const existingId = typeof meta.stripeCustomerId === 'string' ? meta.stripeCustomerId : null;
    const { credential } = await requireGateway('stripe');
    const { stripeEnsureCustomer } = await import('../lib/payments/stripeGateway.js');
    const stripeId = await stripeEnsureCustomer(credential, { existingId, email, name });
    if (stripeId !== existingId) {
      await db.customer.update({
        where: { id: customerId },
        data: { meta: { ...meta, stripeCustomerId: stripeId } },
      });
    }
    return stripeId;
  },

  /**
   * Forget one of a customer's saved cards.
   *
   * Ownership is checked HERE rather than trusted from the caller: a
   * PaymentMethod id is guessable enough that detaching by id alone would let
   * one signed-in shopper remove another's card.
   */
  async forgetCard(stripeCustomerId: string, providerId: string, paymentMethodId: string) {
    if (providerId !== 'stripe') throw new ValidationError('That provider does not store cards.', 'provider');
    const owned = await this.savedCards(stripeCustomerId, providerId);
    if (!owned.some((c) => c.id === paymentMethodId)) {
      throw new NotFoundError('That card is not on this account.', 'paymentMethodId');
    }
    const { credential } = await requireGateway('stripe');
    const { stripeDetachCard } = await import('../lib/payments/stripeGateway.js');
    await stripeDetachCard(credential, paymentMethodId);
    return { removed: paymentMethodId };
  },

  /** Saved cards for a Stripe customer — brand, last four, expiry only. */
  async savedCards(stripeCustomerId: string, providerId: string) {
    if (providerId !== 'stripe') return [];
    const { credential } = await requireGateway('stripe');
    const { stripeSavedCards } = await import('../lib/payments/stripeGateway.js');
    return stripeSavedCards(credential, stripeCustomerId);
  },

  async createIntent(
    orderNumber: string,
    accessToken: string,
    providerId: string,
    ctx?: { fundingMethod?: string; returnUrl?: string; cancelUrl?: string },
  ) {
    const order = await orderByNumberAndToken(orderNumber, accessToken);
    if (order.status !== 'pending') throw new ConflictError(`Order is ${order.status}, not payable.`, 'order');
    const { gateway, credential } = await requireGateway(providerId);
    let intent;
    try {
      intent = await gateway.createIntent(
        { id: order.id, number: order.number, total: order.total, currency: order.currency },
        credential,
        ctx,
      );
    } catch (err) {
      // A gateway rejection — Stripe declining Affirm under its minimum, a
      // missing field, a method the account never turned on — must reach the
      // shopper as a plain "pick another method", never a raw 500 that reads as
      // the whole site being broken.
      const s = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const msg = s.includes('postal') || s.includes('zip')
        ? 'A billing ZIP/postal code is required for this method — add it and try again.'
        : (s.includes('amount') && /minimum|too low|greater|at least|below/.test(s))
        ? 'This method has a minimum order amount this cart does not meet. Please choose another.'
        : (s.includes('us_bank_account') || s.includes('bank account'))
        ? 'Bank transfer is not available yet — please choose another method.'
        : (s.includes('not activated') || s.includes('not enabled') || s.includes('capability') || s.includes('does not support') || s.includes('no valid payment method'))
        ? 'That payment method is not available yet — please choose another.'
        : 'That payment method could not be started — please choose another.';
      throw new ValidationError(msg, 'payment');
    }
    // A redirect method that produced no redirect URL cannot be completed — send
    // the shopper to another method instead of a dead "did not return a link".
    // WooPayments is the exception: it confirms IN-PAGE from a client_secret and
    // never returns a redirect URL, so a client_secret counts as completable.
    if (ctx?.returnUrl && !intent.redirectUrl && !intent.clientSecret) {
      throw new ValidationError('That payment method is not available for this order — please choose another.', 'payment');
    }
    // Remember the intent on the payment row — refunds and the return path
    // both need it later.
    await db.payment.update({ where: { orderId: order.id }, data: { txnId: intent.intentId, method: providerId } });
    return intent;
  },

  /**
   * Settle an order from a browser-tokenised payment, without leaving the page.
   *
   * The order is re-read by number AND access token, so a token alone cannot
   * pay for someone else's order, and a non-pending order is refused rather
   * than charged twice.
   */
  /**
   * @param vault  Who to save the card against, and whether to. Only ever
   *               populated from a verified customer session — a caller
   *               cannot name someone else's Stripe customer.
   */
  async payWithToken(
    orderNumber: string,
    accessToken: string,
    providerId: string,
    token: string,
    vault?: { customerId?: string | null; save?: boolean; offSession?: boolean },
  ) {
    const order = await orderByNumberAndToken(orderNumber, accessToken);
    if (order.status !== 'pending') throw new ConflictError(`Order is ${order.status}, not payable.`, 'order');
    const { gateway, credential } = await requireGateway(providerId);
    if (!gateway.payWithToken) {
      throw new ValidationError(`${gateway.displayName()} cannot take an in-page payment — it uses a hosted checkout.`);
    }
    const paymentId = await gateway.payWithToken(
      { id: order.id, number: order.number, total: order.total, currency: order.currency },
      credential,
      token,
      `tok_${order.id}`,
      vault,
    );
    // Settle through the canonical paid path, not raw row writes. markPaid is
    // the one place that advances pending→processing, submits fulfilment, and
    // (now) sends the receipt + owner email — an in-page charge that wrote the
    // rows directly used to skip all three, so Stripe orders shipped nothing
    // and emailed no one. pspResponse records how it settled.
    await orderService.markPaid(order.id, paymentId, providerId, { via: 'in-page-token', status: 'paid' });
    return { orderNumber: order.number, paymentId, status: 'paid' as const };
  },

  // The /checkout/return path for redirect gateways — the endpoint 1.x's
  // providers built URLs to but never registered. Verifies with the
  // provider (never trusts the query string), finalizes, and hands back the
  // receipt target.
  async finalizeReturn(providerId: string, orderNumber: string, accessToken: string) {
    const order = await orderByNumberAndToken(orderNumber, accessToken);
    const { gateway, credential } = await requireGateway(providerId);
    const intentId = order.payment?.txnId;
    if (!intentId) throw new ConflictError('No payment intent on this order yet.', 'order');
    let status = await gateway.intentStatus(intentId, credential);

    // Stripe redirect methods (Klarna/Affirm/Afterpay/Cash App) are almost
    // always 'succeeded' the instant the shopper returns, but can sit on
    // 'processing' for a beat. Poll briefly so the order settles right here even
    // with no webhook configured, instead of being left pending. (Truly async
    // rails like ACH stay 'processing' and would still need the webhook.)
    // WooPayments confirms in-page (card/wallet) or redirects (BNPL) and settles
    // authoritatively through the engine webhook → markPaid; polling here is the
    // same belt-and-suspenders as the Stripe redirect rails, so a shopper who
    // lands back on the return URL settles immediately rather than waiting.
    if ((providerId === 'stripe' || providerId === 'woopay') && order.status === 'pending' && status !== 'succeeded') {
      for (let i = 0; i < 4 && status !== 'succeeded'; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        status = await gateway.intentStatus(intentId, credential);
      }
    }

    // PayPal approval is not payment. The payer approving in PayPal's window
    // leaves the order APPROVED — 'processing' here — and the money only
    // moves when the merchant captures it. `capturePaypalOrder` was exported
    // for this and never called from anywhere, so every PayPal checkout
    // stopped one step short: approved, never captured, never paid, and the
    // shopper believing they had bought something.
    // ...but only while the order is still PENDING. A cancelled/abandoned order
    // must never be captured on a stray return — that is exactly how a shopper
    // who already paid another way (or whom we abandoned to avoid a double
    // charge) would be charged a second time.
    if (providerId === 'paypal' && status === 'processing' && order.status === 'pending') {
      const { capturePaypalOrder } = await import('../lib/payments/paypalGateway.js');
      // Keyed on the ORDER, so a double return — a refreshed tab, a retried
      // poll — cannot capture the same approval twice.
      const cap = await capturePaypalOrder(intentId, credential, `capture-${order.id}`);
      // PayPal collected the email + shipping in its own window; fill any blanks
      // on the order so a formless PayPal checkout still has a receipt address
      // and a ship-to. Before markPaid, so fulfillment sees the address.
      await orderService.backfillContact(order.id, cap.contact);
      status = await gateway.intentStatus(intentId, credential);
    }

    if (status === 'succeeded' && order.status === 'pending') {
      await orderService.markPaid(order.id, intentId, providerId, { via: 'checkout-return', status });
    }
    return { orderNumber: order.number, accessToken, paid: status === 'succeeded', status };
  },

  // PSP webhook: verify via the gateway, dedupe on the ledger, apply kind.
  async handleWebhook(providerId: string, rawBody: string, headers: Record<string, string | string[] | undefined>) {
    const gateway = GATEWAYS[providerId];
    if (!gateway) throw new NotFoundError('Unknown payment provider', 'provider');

    // Verification secret: the provider's webhook signing secret from Nexus
    // (Stripe-style); falls back to the connection credential (mock, and
    // providers that sign with the API key).
    const signingSecret = (await connectionService.webhookSecretFor(providerId)) ?? (await connectionService.credentialFor(providerId));
    if (!signingSecret) throw new UnauthorizedError('Provider not configured.');

    const verified = await gateway.verifyWebhook(rawBody, headers, signingSecret); // throws on forgery
    if (verified === null) throw new UnauthorizedError('Webhook signature required.');

    const event = gateway.parseEvent(verified);
    // Timestamp-less/id-less providers: fall back to a hash of the signed body.
    const eventId = event.providerEventId || `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

    // Audit C-1: ledger-then-apply must not swallow apply failures. The row
    // is created applied:false; success is acknowledged ONLY after _apply
    // completes and flips it. If _apply throws, the row stays unapplied and
    // the provider's retry RE-RUNS apply instead of no-oping as a replay.
    let replay = false;
    try {
      await db.paymentEvent.create({
        data: {
          provider: providerId,
          providerEventId: eventId,
          kind: event.kind,
          paymentIntentId: event.paymentIntentId ?? null,
          refundId: event.refundId ?? null,
          payload: (event.payload ?? {}) as object,
          applied: false,
        },
      });
    } catch {
      const existing = await db.paymentEvent.findUnique({
        where: { provider_event: { provider: providerId, providerEventId: eventId } },
        select: { applied: true },
      });
      if (existing?.applied) return { ok: true, replay: true }; // genuinely done
      replay = true; // ledgered before but never applied — retry the apply
    }

    await this._apply(event, providerId); // throws → 500 → provider retries
    await db.paymentEvent.update({
      where: { provider_event: { provider: providerId, providerEventId: eventId } },
      data: { applied: true },
    });
    return { ok: true, replay };
  },

  async _apply(event: PspWebhookEvent, providerId: string): Promise<void> {
    if (event.kind === 'payment.succeeded') {
      // Primary match: the intent stored on the payment row. Fallback
      // (audit M-1): the order id the gateway carried in intent metadata —
      // covers a txnId overwritten by a later createIntent, so a success on
      // ANY intent this system issued still resolves its order.
      let payment = event.paymentIntentId
        ? await db.payment.findFirst({ where: { txnId: event.paymentIntentId }, select: { orderId: true, status: true } })
        : null;
      if (!payment) {
        const orderId = typeof event.payload?.orderId === 'string' ? event.payload.orderId : null;
        if (orderId) payment = await db.payment.findFirst({ where: { orderId }, select: { orderId: true, status: true } });
      }
      if (payment && payment.status !== 'paid') {
        // Receipt + owner email now fire INSIDE markPaid (the pending→paid edge
        // shared by every settlement path), so they are not duplicated here.
        await orderService.markPaid(payment.orderId, event.paymentIntentId ?? 'unknown', providerId, { via: 'psp-webhook', kind: event.kind });
      } else if (!payment) {
        logger.warn({ provider: providerId, intent: event.paymentIntentId }, 'payment.succeeded for unknown intent — reconcile manually');
      }
      return;
    }
    if ((event.kind === 'refund.succeeded' || event.kind === 'payment.refunded') && event.refundId) {
      await db.refund.updateMany({ where: { providerRefundId: event.refundId, status: 'pending' }, data: { status: 'succeeded' } });
      // Coupon release happens on CONFIRMED refund (audit F6) — only once the
      // provider says the money actually went back, and only when succeeded
      // refunds cover the whole order.
      const r = await db.refund.findFirst({ where: { providerRefundId: event.refundId }, select: { orderId: true } });
      if (r) {
        const order = await db.order.findUnique({ where: { id: r.orderId }, select: { total: true } });
        const succeeded = await db.refund.aggregate({ where: { orderId: r.orderId, status: 'succeeded' }, _sum: { amount: true } });
        if (order && (succeeded._sum.amount ?? 0) >= order.total) {
          await couponService.releaseForOrder(r.orderId);
          void commerceEmailService.sendRefundNotice(r.orderId); // C6, fire-and-forget
        }
      }
      return;
    }
    if (event.kind === 'refund.failed' && event.refundId) {
      // Roll the accounting back — the money never moved. Guarded update
      // (status flips exactly once, audit M-2): a refund already marked
      // failed can't decrement twice; a succeeded refund that the provider
      // later reverses is corrected by the same one-shot flip.
      const flipped = await db.refund.updateMany({
        where: { providerRefundId: event.refundId, status: { in: ['pending', 'succeeded'] } },
        data: { status: 'failed' },
      });
      if (flipped.count === 1) {
        const r = await db.refund.findFirst({ where: { providerRefundId: event.refundId }, select: { orderId: true, amount: true } });
        if (r) await db.order.update({ where: { id: r.orderId }, data: { refundedTotal: { decrement: r.amount } } });
      }
      return;
    }
    // Unknown kinds (disputes, refund.pending) are ledgered but not acted on.
    logger.info({ provider: providerId, kind: event.kind }, 'psp event ledgered, no handler');
  },

  // Admin refund — partial or full-remaining. Redesigned per audit C-2:
  //   1. Idempotency: the key is DETERMINISTIC — client-supplied, or derived
  //      from (orderId, amount, reason). A network retry reuses the key; the
  //      Refund.idempotencyKey unique constraint turns the second attempt
  //      into "return the existing refund" with NO second provider call.
  //   2. Over-refund race: the amount is RESERVED first via a conditional
  //      update (refundedTotal + amount <= total enforced in the WHERE) —
  //      two concurrent refunds can't both pass a stale read. The provider
  //      call happens after the reservation; on gateway failure the
  //      reservation is rolled back.
  async refund(orderId: string, amountMinor: number | undefined, reason: string | undefined, clientIdempotencyKey?: string, providerIdOverride?: string) {
    const order = await db.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order) throw new NotFoundError('Order not found', 'id');
    if (!order.payment?.txnId || order.payment.status !== 'paid') {
      throw new ConflictError('Order has no captured payment to refund.', 'id');
    }
    const intentId = order.payment.txnId;
    const providerId = providerIdOverride ?? order.payment.method ?? '';
    const { gateway, credential } = await requireGateway(providerId);
    if (!gateway.supports('refunds')) throw new ConflictError(`${gateway.displayName()} does not support refunds.`, 'provider');

    const refundable = order.total - order.refundedTotal;
    const amount = amountMinor ?? refundable;
    if (amount <= 0 || amount > refundable) {
      throw new ValidationError(`Refund must be between 1 and ${refundable} (minor units).`, 'amount');
    }
    if (amount < refundable && !gateway.supports('partial_refunds')) {
      throw new ConflictError(`${gateway.displayName()} does not support partial refunds.`, 'amount');
    }

    const idempotencyKey =
      clientIdempotencyKey ??
      `rf_${orderId}_${createHash('sha256').update(`${amount}|${reason ?? ''}`).digest('hex').slice(0, 24)}`;

    // Retry of an identical refund → hand back the existing row, no money moves.
    const existing = await db.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;

    // Reserve atomically — the WHERE enforces the cap against CURRENT state.
    const reserved = await db.order.updateMany({
      where: { id: orderId, refundedTotal: { lte: order.total - amount } },
      data: { refundedTotal: { increment: amount } },
    });
    if (reserved.count !== 1) {
      throw new ConflictError('Refund exceeds the refundable amount (concurrent refund in progress?).', 'amount');
    }

    let refund;
    try {
      refund = await db.refund.create({
        data: { orderId, amount, reason: reason ?? null, provider: providerId, idempotencyKey, status: 'pending' },
      });
    } catch (err) {
      // Unique-key race: an identical concurrent request won — release our
      // reservation and return the winner.
      await db.order.update({ where: { id: orderId }, data: { refundedTotal: { decrement: amount } } });
      const winner = await db.refund.findUnique({ where: { idempotencyKey } });
      if (winner) return winner;
      throw err;
    }

    let providerRefundId: string;
    try {
      providerRefundId = await gateway.refund(
        { id: order.id, number: order.number, total: order.total, currency: order.currency },
        amount,
        idempotencyKey,
        credential,
        { intentId },
      );
    } catch (err) {
      // Money never moved — roll the reservation and the row back.
      await db.$transaction([
        db.refund.update({ where: { id: refund.id }, data: { status: 'failed' } }),
        db.order.update({ where: { id: orderId }, data: { refundedTotal: { decrement: amount } } }),
      ]);
      throw err;
    }
    refund = await db.refund.update({ where: { id: refund.id }, data: { providerRefundId } });

    // Full refund cancels the order through the real state machine (which
    // owns the restock rules); partial refunds leave status alone. Coupon
    // redemptions are NOT released here — release happens only when the
    // provider CONFIRMS the refund (refund.succeeded webhook, see _apply),
    // so a refund that later fails doesn't free a usage slot for money that
    // never moved (audit F6).
    const after = await db.order.findUnique({ where: { id: orderId }, select: { refundedTotal: true, total: true, status: true } });
    if (after && after.refundedTotal >= after.total && (after.status === 'processing' || after.status === 'shipped')) {
      await orderService.transition(orderId, { status: 'cancelled' });
    }
    return refund;
  },
};
