import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireCapability } from '../../middleware/capability.js';
import { customerAuth } from '../../counter/customerAuth.js';
import { socialSignIn, SOCIAL_PROVIDERS } from '../../counter/socialSignIn.js';
import { storeCredentials } from '../../counter/storeCredentials.js';
import { shipmentService } from '../../counter/shipmentService.js';
import { reviewService } from '../../counter/reviewService.js';
import { reportService } from '../../counter/reportService.js';
import { nexusBridge } from '../../counter/nexusBridge.js';
import { wooImporter } from '../../counter/wooImporter.js';
import { walletPayments, assertWalletProvider } from '../../counter/walletPayments.js';
import { customerTokenFrom, requireCustomer } from '../../counter/customerSession.js';
import { customerAccountService } from '../../services/customerAccount.service.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError } from '../../lib/errors.js';

// Counter — HTTP surface.
//
// Everything Counter can do existed only as service functions until now, which
// meant none of it was reachable from outside the process.
//
// The boundary that matters here is PUBLIC vs ADMIN, and it is enforced by
// putting them in two separate plugin scopes rather than by remembering to add
// a guard per route:
//
//   counterPublicRoutes  — storefront. No admin session. Customer sign-in,
//                          submitting a review, reading approved reviews.
//   counterAdminRoutes   — authenticated + commerce capability, like every
//                          other admin surface.
//
// A customer session token is NOT an admin token and is never accepted by the
// admin scope: they are different tables, different lifetimes, and a storefront
// login must never reach admin data.

const DateRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Defaults to the last 30 days when no range is given. */
function rangeOf(q: z.infer<typeof DateRange>): { from: Date; to: Date } {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

// Session reading moved to counter/customerSession.ts — the cart routes need
// the same logic to bind a signed-in shopper's order to their account.

// ─── Public / storefront ───────────────────────────────────────────────────

export async function counterPublicRoutes(app: FastifyInstance): Promise<void> {
  const RegisterInput = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
    name: z.string().max(120).optional(),
  });

  // The login and code paths are throttled inside customerAuth; registration
  // was not, so account creation itself was the unlimited door.
  app.post('/shop/account/register', async (req, reply) => {
    const rl = await checkRateLimit(`customer-register:${req.ip}`, 5, 900);
    if (!rl.allowed) throw new TooManyRequestsError('Too many sign-ups from this address — try again shortly.', rl.retryAfterSeconds);
    const input = RegisterInput.parse(req.body);
    const out = await customerAuth.registerWithPassword({ ...input, ip: req.ip });
    reply.status(201).send(publicSession(out));
  });

  app.post('/shop/account/login', async (req, reply) => {
    const input = z.object({ email: z.string().email(), password: z.string().max(200) }).parse(req.body);
    const out = await customerAuth.signInWithPassword({ ...input, userAgent: req.headers['user-agent'], ip: req.ip });
    reply.send(publicSession(out));
  });

  // Requesting a code deliberately returns the same shape for a known and an
  // unknown destination. The code itself is NOT in the response — delivery is
  // the transport's job (SMS via Nexus, or email) and returning it here would
  // let anyone sign in as anyone.
  app.post('/shop/account/code', async (req, reply) => {
    const input = z.object({
      destination: z.string().min(3).max(200),
      kind: z.enum(['phone', 'email']),
    }).parse(req.body);
    const { code, ...rest } = await customerAuth.requestCode({ ...input, ip: req.ip });
    void code; // handed to the delivery transport, never to the client
    reply.send({ sent: true, ...rest });
  });

  app.post('/shop/account/code/verify', async (req, reply) => {
    const input = z.object({
      destination: z.string().min(3).max(200),
      kind: z.enum(['phone', 'email']),
      code: z.string().length(6),
      name: z.string().max(120).optional(),
    }).parse(req.body);
    const out = await customerAuth.verifyCode({ ...input, userAgent: req.headers['user-agent'], ip: req.ip });
    reply.send(publicSession(out));
  });

  app.post('/shop/account/logout', async (req, reply) => {
    const token = customerTokenFrom(req);
    reply.send(token ? await customerAuth.signOut(token, req.ip) : { signedOut: true });
  });

  app.get('/shop/account/me', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      identities: await customerAuth.identitiesFor(customer.id),
    });
  });

  // ── Social sign-in ────────────────────────────────────────────────────
  //
  // The token is verified SERVER-SIDE against the provider's own published
  // keys before it becomes a session — see socialSignIn.ts. Nothing about the
  // shopper is taken from the request body; every field comes out of the
  // verified token.

  // Which buttons the storefront should render. A button for a provider that
  // is not connected in Nexus is a button that does nothing.
  app.get('/shop/account/oauth/providers', async (_req, reply) => {
    reply.send({ providers: await socialSignIn.available() });
  });

  app.post('/shop/account/oauth/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!SOCIAL_PROVIDERS.includes(provider as (typeof SOCIAL_PROVIDERS)[number])) {
      throw new ValidationError(`${provider} is not a supported sign-in provider.`, 'provider');
    }
    const { token } = z.object({ token: z.string().min(1).max(8000) }).parse(req.body);

    const profile = await socialSignIn.verify(provider as (typeof SOCIAL_PROVIDERS)[number], token);
    const out = await customerAuth.signInWithOAuth({
      ...profile,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    reply.send(publicSession(out));
  });

  // ── Managing your own sign-in methods ─────────────────────────────────

  // Sign out on every device. The thing you want after "was that really me?"
  app.post('/shop/account/logout-everywhere', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send(await customerAuth.signOutAll(customer.id, req.ip));
  });

  // Remove one sign-in method. The service refuses to remove the last one —
  // that would lock the customer out of their own order history permanently.
  app.delete('/shop/account/identities/:identityId', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { identityId } = req.params as { identityId: string };
    reply.send(await customerAuth.unlinkIdentity(customer.id, identityId, req.ip));
  });

  // ── The shopper's own account ─────────────────────────────────────────
  //
  // Every one of these is scoped by the SESSION's customer id, never by an id
  // in the request — there is deliberately no `/shop/account/:id/orders`.

  app.get('/shop/account/orders', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send({ orders: await customerAccountService.orders(customer.id) });
  });

  app.get('/shop/account/recommendations', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send(await customerAccountService.recommendations(customer.id));
  });

  app.get('/shop/account/offers', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send({ offers: await customerAccountService.offers(customer.id) });
  });

  app.post('/shop/account/offers/seen', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send(await customerAccountService.markOffersSeen(customer.id));
  });

  app.post('/shop/account/offers/:offerId/claim', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { offerId } = req.params as { offerId: string };
    reply.send(await customerAccountService.claimOffer(customer.id, offerId));
  });

  app.post('/shop/account/offers/:offerId/dismiss', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { offerId } = req.params as { offerId: string };
    reply.send(await customerAccountService.dismissOffer(customer.id, offerId));
  });

  // Approved reviews for a product, plus its rating summary.
  app.get('/shop/products/:productId/reviews', async (req, reply) => {
    const { productId } = req.params as { productId: string };
    const [reviews, summary] = await Promise.all([
      reviewService.listPublic(productId),
      reviewService.summary(productId),
    ]);
    reply.send({ reviews, summary });
  });

  // Anyone may submit; it lands pending and `verified` is computed, never
  // taken from the request.
  // Reviews land as 'pending' and only 'approved' ones are ever served, so spam
  // cannot publish itself. The limit is about the write, not the display: an
  // unthrottled public insert is still a way to fill the table.
  app.post('/shop/products/:productId/reviews', async (req, reply) => {
    const rl = await checkRateLimit(`review-submit:${req.ip}`, 5, 3600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many reviews from this address — try again later.', rl.retryAfterSeconds);
    const { productId } = req.params as { productId: string };
    const input = z.object({
      reviewerName: z.string().min(1).max(120),
      reviewerEmail: z.string().email(),
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      body: z.string().min(1).max(5000),
    }).parse(req.body);

    // If they happen to be signed in, attribute it — but never trust a
    // customerId supplied in the body.
    const token = customerTokenFrom(req);
    const signedIn = token ? await customerAuth.resolveSession(token) : null;

    const review = await reviewService.submit({ ...input, productId, customerId: signedIn?.id ?? null });
    reply.status(201).send({ id: review.id, status: review.status });
  });

  // ── Wallets ───────────────────────────────────────────────────────────
  // Authenticated by the ORDER's own access token, exactly like the rest of
  // the storefront checkout — a shopper paying for their order is not a
  // logged-in customer, and requiring an account here would break guest
  // checkout, which is the whole point of wallet payments being fast.
  app.post('/shop/checkout/wallet-session', async (req, reply) => {
    const input = z.object({
      orderNumber: z.string().min(1).max(60),
      accessToken: z.string().min(1).max(200),
      provider: z.enum(['stripe', 'square']),
    }).parse(req.body);
    assertWalletProvider(input.provider);
    reply.send(await walletPayments.session(input.orderNumber, input.accessToken, input.provider));
  });
}

/** Only ever returns what a storefront needs — no internal fields. */
function publicSession(out: { customer: { id: string; email: string; name: string | null }; token: string; expiresAt: Date }) {
  return {
    token: out.token,
    expiresAt: out.expiresAt,
    customer: { id: out.customer.id, email: out.customer.email, name: out.customer.name },
  };
}

// ─── Admin ─────────────────────────────────────────────────────────────────

// ── Store keys: credentials that let a PARTNER read this store ────────────
//
// The other direction from every other Nexus connection. Printful, Printify
// and Tapstitch connect by pulling from your store against a WooCommerce- or
// Shopify-shaped API, so what they need is a key THIS store issues.
export async function storeKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-keys', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send({ keys: await storeCredentials.list() });
  });

  app.post('/store-keys', { preHandler: app.authenticate }, async (req, reply) => {
    const input = z
      .object({ label: z.string().min(1).max(80), scope: z.enum(['read', 'read_write']).default('read_write') })
      .parse(req.body);
    // The secret is in THIS response and nowhere else, ever.
    reply.status(201).send(await storeCredentials.issue(input.label, input.scope));
  });

  app.delete('/store-keys/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await storeCredentials.revoke(id));
  });
}

export async function counterAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireCapability('commerce'));

  // Offers: pushing a coupon to named customers ------------------------------
  app.get('/counter/offers', async (_req, reply) => {
    reply.send({ offers: await customerAccountService.listOffers() });
  });

  app.post('/counter/offers', async (req, reply) => {
    const input = z.object({
      couponId: z.string().min(1),
      customerIds: z.array(z.string().min(1)).min(1).max(5000),
      title: z.string().min(1).max(120),
      message: z.string().max(600).optional(),
    }).parse(req.body);
    reply.status(201).send(await customerAccountService.pushOffer(input));
  });

  app.delete('/counter/offers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await customerAccountService.revokeOffer(id));
  });

  // Fulfilment ---------------------------------------------------------------
  app.get('/counter/orders/:orderId/shipments', async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    reply.send(await shipmentService.listForOrder(orderId));
  });

  app.post('/counter/orders/:orderId/shipments/plan', async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    reply.status(201).send(await shipmentService.planForOrder(orderId));
  });

  app.post('/counter/shipments/:id/quote', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = z.object({
      provider: z.string().min(1).max(60),
      method: z.string().max(60).optional(),
      ref: z.string().max(120).optional(),
      shippingTotal: z.number().int().min(0),
      taxTotal: z.number().int().min(0).optional(),
    }).parse(req.body);
    reply.send(await shipmentService.recordQuote(id, input));
  });

  app.post('/counter/shipments/:id/route', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { podProvider } = z.object({ podProvider: z.string().max(60).nullable() }).parse(req.body);
    reply.send(await shipmentService.route(id, podProvider));
  });

  app.post('/counter/shipments/:id/shipped', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = z.object({ carrier: z.string().min(1).max(60), number: z.string().min(1).max(120) }).parse(req.body);
    reply.send(await shipmentService.markShipped(id, input));
  });

  app.post('/counter/shipments/:id/delivered', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await shipmentService.markDelivered(id));
  });

  app.post('/counter/shipments/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await shipmentService.cancel(id));
  });

  // Review moderation --------------------------------------------------------
  app.get('/counter/reviews', async (req, reply) => {
    const { status } = z.object({ status: z.enum(['pending', 'approved', 'spam']).default('pending') }).parse(req.query);
    reply.send(await reviewService.listForModeration(status));
  });

  app.patch('/counter/reviews/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(['pending', 'approved', 'spam']) }).parse(req.body);
    reply.send(await reviewService.setStatus(id, status));
  });

  app.delete('/counter/reviews/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await reviewService.remove(id));
  });

  // Reports ------------------------------------------------------------------
  // Richer than the existing /reports/sales (which stays): net-of-refunds,
  // daily series, best sellers, status breakdown, low stock.
  app.get('/counter/reports/summary', async (req, reply) => {
    const q = DateRange.extend({ currency: z.string().length(3).default('USD') }).parse(req.query);
    reply.send(await reportService.salesSummary(rangeOf(q), q.currency));
  });

  app.get('/counter/reports/series', async (req, reply) => {
    const q = DateRange.extend({ currency: z.string().length(3).default('USD') }).parse(req.query);
    reply.send(await reportService.salesSeries(rangeOf(q), q.currency));
  });

  app.get('/counter/reports/top-products', async (req, reply) => {
    const q = DateRange.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }).parse(req.query);
    reply.send(await reportService.topProducts(rangeOf(q), q.limit));
  });

  app.get('/counter/reports/orders-by-status', async (req, reply) => {
    reply.send(await reportService.ordersByStatus(rangeOf(DateRange.parse(req.query))));
  });

  app.get('/counter/reports/low-stock', async (req, reply) => {
    const q = z.object({
      threshold: z.coerce.number().int().min(0).max(1000).default(5),
      limit: z.coerce.number().int().min(1).max(200).default(20),
    }).parse(req.query);
    reply.send(await reportService.lowStock(q.threshold, q.limit));
  });

  // Nexus ---------------------------------------------------------------------
  app.get('/counter/providers/fulfillment', async (_req, reply) => {
    reply.send(await nexusBridge.fulfillmentProviders());
  });

  app.get('/counter/providers/payments', async (_req, reply) => {
    reply.send(await nexusBridge.paymentProviders());
  });

  // Wallets ------------------------------------------------------------------
  app.get('/counter/wallets/providers', async (_req, reply) => {
    reply.send(await walletPayments.availableProviders());
  });

  // WooCommerce migration -----------------------------------------------------
  const WooCreds = z.object({
    storeUrl: z.string().url(),
    consumerKey: z.string().min(1).max(200),
    consumerSecret: z.string().min(1).max(200),
  });

  app.post('/counter/import/woo/check', async (req, reply) => {
    reply.send(await wooImporter.check(WooCreds.parse(req.body)));
  });

  app.post('/counter/import/woo/products', async (req, reply) => {
    const input = WooCreds.extend({ dryRun: z.boolean().default(false) }).parse(req.body);
    reply.send(await wooImporter.importProducts(input, { dryRun: input.dryRun }));
  });

  // Orders = payment HISTORY. Saved cards cannot come off WooPayments, but
  // history must, or refunds and lifetime value start from zero.
  app.post('/counter/import/woo/orders', async (req, reply) => {
    const input = WooCreds.extend({ dryRun: z.boolean().default(false) }).parse(req.body);
    reply.send(await wooImporter.importOrders(input, { dryRun: input.dryRun }));
  });

  app.post('/counter/import/woo/customers', async (req, reply) => {
    const input = WooCreds.extend({ dryRun: z.boolean().default(false) }).parse(req.body);
    reply.send(await wooImporter.importCustomers(input, { dryRun: input.dryRun }));
  });
}
