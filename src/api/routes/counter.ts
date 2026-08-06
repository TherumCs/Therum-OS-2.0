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
import { stripePayments } from '../../counter/stripePayments.js';
import { shippingRateService } from '../../counter/shippingRates.js';
import { wooImporter } from '../../counter/wooImporter.js';
import { db } from '../../lib/db.js';
import { walletPayments, assertWalletProvider } from '../../counter/walletPayments.js';
import { customerTokenFrom, requireCustomer, resolveCustomer } from '../../counter/customerSession.js';
import { plaidApp, createLinkToken, exchangePublicToken, saveLink, linksFor, unlink } from '../../counter/plaid.js';
import { customerAccountService } from '../../services/customerAccount.service.js';
import { UnauthorizedError, ValidationError, NotFoundError } from '../../lib/errors.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError } from '../../lib/errors.js';
import * as catalogImport from '../../counter/catalogImport.js';
import * as catalogFiles from '../../counter/catalogFiles.js';
import { requireBundle } from '../../middleware/bundle.js';

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

  // "Tell me when you open", from the coming-soon page.
  //
  // Its own table, not a Customer: someone who wants a launch email has not
  // bought anything and must not turn up in customer counts or in marketing
  // that assumes a purchase.
  app.post('/shop/notify', async (req, reply) => {
    const rl = await checkRateLimit(`notify:${req.ip}`, 10, 3600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many sign-ups from this address — try again shortly.', rl.retryAfterSeconds);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).parse(req.body);
    // Idempotent by design: a visitor who submits twice gets a thank-you, not
    // a duplicate-key error they have to interpret. It also means the response
    // does not reveal whether an address was already on the list.
    await db.emailSignup.upsert({
      where: { email },
      update: {},
      create: { email, source: 'coming-soon' },
    });
    reply.status(201).send({ ok: true });
  });

  // Shipping options for a cart + destination. Live vendor rates (Printful et al.)
  // first, the configured manual methods as the floor — a store must always be
  // able to offer SOMETHING or it cannot sell. US only for now. The line carries
  // sourceVariantId (the vendor's variant id) so a provider can actually quote;
  // a plain cart line doesn't have it.
  app.post('/shop/shipping/rates', async (req, reply) => {
    const body = z
      .object({
        items: z
          .array(z.object({ variantId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
          .min(1)
          .max(50),
        address: z.object({
          name: z.string().max(120).optional(),
          line1: z.string().min(1).max(200),
          line2: z.string().max(200).optional(),
          city: z.string().min(1).max(120),
          region: z.string().max(60).optional(),
          postalCode: z.string().max(20).optional(),
          country: z.string().length(2),
        }),
      })
      .parse(req.body);

    const variants = await db.productVariant.findMany({
      where: { id: { in: body.items.map((i) => i.variantId) } },
      select: { id: true, price: true, productId: true, sourceId: true },
    });
    const vById = new Map(variants.map((v) => [v.id, v]));
    let subtotal = 0;
    const lines = body.items.flatMap((i) => {
      const v = vById.get(i.variantId);
      if (!v) return [];
      const lineTotal = v.price * i.quantity;
      subtotal += lineTotal;
      return [
        {
          itemId: v.id,
          productId: v.productId,
          variantId: v.id,
          quantity: i.quantity,
          unitPrice: v.price,
          lineTotal,
          sourceVariantId: v.sourceId ?? undefined,
        },
      ];
    });
    if (lines.length === 0) {
      reply.send({ rates: [] });
      return;
    }

    const rates = await shippingRateService.rates({ lines, subtotal, currency: 'USD', address: body.address });
    reply.send({ rates });
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
    // The default address travels with the session so a returning shopper is
    // not retyping something the store already holds. Quick checkout signs in
    // mid-purchase precisely to avoid that typing, and without this the sign
    // in filled a name and left five address fields blank.
    const address = await db.address.findFirst({
      where: { customerId: customer.id },
      orderBy: [{ isDefault: 'desc' }],
      select: { line1: true, line2: true, city: true, region: true, postalCode: true, country: true },
    });
    reply.send({
      id: customer.id,
      email: customer.email,
      name: customer.name,
      address,
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

  /**
   * Bank linking (Plaid).
   *
   * Every route here requires the SHOPPER's own session and scopes to their own
   * customer id — there is no route that takes a customer id from the request,
   * because that is how one shopper ends up reading another's bank accounts.
   *
   * The access token never appears in any response on this file.
   */
  app.get('/shop/account/banks', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send({ links: await linksFor(customer.id), ready: (await plaidApp()) !== null });
  });

  app.post('/shop/account/banks/link-token', async (req, reply) => {
    const customer = await requireCustomer(req);
    const app_ = await plaidApp();
    if (!app_) throw new ValidationError('Bank linking is not set up for this store yet.', 'plaid');
    reply.send({ linkToken: await createLinkToken(app_, customer.id) });
  });

  app.post('/shop/account/banks/exchange', async (req, reply) => {
    const customer = await requireCustomer(req);
    const app_ = await plaidApp();
    if (!app_) throw new ValidationError('Bank linking is not set up for this store yet.', 'plaid');
    const { publicToken } = z.object({ publicToken: z.string().min(1).max(500) }).parse(req.body);
    const linked = await exchangePublicToken(app_, publicToken);
    await saveLink(customer.id, linked);
    // Deliberately returns the LIST, not the linked item — so no response on
    // this path can ever be the one that accidentally carries a token.
    reply.send({ links: await linksFor(customer.id) });
  });

  app.delete('/shop/account/banks/:id', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { id } = req.params as { id: string };
    const removed = await unlink(customer.id, id);
    if (!removed) throw new NotFoundError('No such linked account', 'id');
    reply.send({ links: await linksFor(customer.id) });
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
  // Public, because the shop CARD needs to know which wallets it can offer
  // before any order exists — the admin-only /counter/wallets/providers cannot
  // be called from a storefront page. Nothing secret leaves: a publishable key
  // is publishable by definition, and a not-ready provider returns its reason
  // so the card can say why instead of showing a button that cannot work.
  app.get('/shop/wallets', async (_req, reply) => {
    const providers = await walletPayments.availableProviders();
    // Include the client config: the card cannot load a provider's SDK
    // without its publishable key, and that key is public by definition.
    const withClient = await Promise.all(
      providers.map(async (p) => ({ ...p, client: await walletPayments.clientConfig(p.provider) })),
    );
    reply.send({ providers: withClient });
  });

  // Settle in place, from a token the provider's browser SDK produced. Public
  // like the rest of the storefront checkout: the order's own access token is
  // the credential, exactly as wallet-session works.
  app.post('/shop/checkout/pay-token', async (req, reply) => {
    const input = z.object({
      orderNumber: z.string().min(1).max(60),
      accessToken: z.string().min(1).max(200),
      provider: z.enum(['stripe', 'square']),
      token: z.string().min(1).max(500),
      // "Save this card for next time". Honoured ONLY for a request that
      // carries a valid customer session — a guest cannot vault a card, and
      // nobody can vault one against somebody else's account, because the
      // customer is resolved from the session rather than the body.
      saveCard: z.boolean().optional(),
      // Paying WITH an already-saved card: the id came from this customer's
      // own saved list, and is re-checked against it below.
      savedMethodId: z.string().max(200).optional(),
    }).parse(req.body);
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');

    const vault = await resolveVault(req, input.provider, input.saveCard === true);
    let token = input.token;
    if (input.savedMethodId) {
      if (!vault.customerId) throw new ValidationError('Sign in to use a saved card.', 'savedMethodId');
      const owned = await paymentGatewayService.savedCards(vault.customerId, input.provider);
      if (!owned.some((c) => c.id === input.savedMethodId)) {
        throw new ValidationError('That saved card does not belong to this account.', 'savedMethodId');
      }
      token = input.savedMethodId;
    }
    reply.send(await paymentGatewayService.payWithToken(
      input.orderNumber, input.accessToken, input.provider, token,
      { customerId: vault.customerId, save: vault.save, offSession: Boolean(input.savedMethodId) },
    ));
  });

  // The shopper's own saved cards. Session-authenticated, and it returns only
  // what is safe to render: brand, last four, expiry.
  app.get('/shop/account/payment-methods', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');
    const customerId = stripeIdOf(customer);
    reply.send({ cards: customerId ? await paymentGatewayService.savedCards(customerId, 'stripe') : [] });
  });

  // Remove one. A shopper who can add a card must be able to take it off the
  // account — otherwise "saved payment methods" is a one-way door.
  app.delete('/shop/account/payment-methods/:id', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(req.params);
    const customerId = stripeIdOf(customer);
    if (!customerId) throw new NotFoundError('No saved cards on this account.', 'id');
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');
    reply.send(await paymentGatewayService.forgetCard(customerId, 'stripe', id));
  });

  // ── Credentials ───────────────────────────────────────────────────────
  //
  // Both throttled per IP like every other unauthenticated-ish write: a
  // session token is not a licence to brute-force the password that protects
  // the account it belongs to.
  app.post('/shop/account/password', async (req, reply) => {
    const customer = await requireCustomer(req);
    const input = z.object({
      current: z.string().min(1).max(200),
      next: z.string().min(8).max(200),
    }).parse(req.body);
    const rl = await checkRateLimit(`pwchange:${req.ip}`, 5, 900);
    if (!rl.allowed) throw new TooManyRequestsError('Too many attempts — try again shortly.', rl.retryAfterSeconds);
    const out = await customerAuth.changePassword({
      customerId: customer.id, current: input.current, next: input.next, ip: req.ip,
    });
    // A new session comes back because changing the password drops every
    // other one — including, without this, the tab it was changed in.
    reply.send({ changed: true, token: out.token, expiresAt: out.expiresAt });
  });

  app.post('/shop/account/email', async (req, reply) => {
    const customer = await requireCustomer(req);
    const input = z.object({
      email: z.string().email().max(320),
      password: z.string().max(200).optional(),
    }).parse(req.body);
    const rl = await checkRateLimit(`emchange:${req.ip}`, 5, 900);
    if (!rl.allowed) throw new TooManyRequestsError('Too many attempts — try again shortly.', rl.retryAfterSeconds);
    const out = await customerAuth.requestEmailChange({
      customerId: customer.id, newEmail: input.email, password: input.password, ip: req.ip,
    });
    reply.send({ sent: true, to: out.to });
  });

  app.post('/shop/account/email/confirm', async (req, reply) => {
    const customer = await requireCustomer(req);
    const input = z.object({
      email: z.string().email().max(320),
      code: z.string().min(4).max(12),
    }).parse(req.body);
    const out = await customerAuth.confirmEmailChange({
      customerId: customer.id, newEmail: input.email, code: input.code, ip: req.ip,
    });
    reply.send({ changed: true, email: out.email });
  });

  // ── Addresses ─────────────────────────────────────────────────────────
  //
  // The Address model has existed since the schema was written and had no
  // HTTP surface at all: a shopper could have an address saved for them by a
  // paid order and then never see, change or delete it.
  const AddressInput = z.object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().min(1).max(120),
    region: z.string().trim().max(120).optional().nullable(),
    postalCode: z.string().trim().max(40).optional().nullable(),
    country: z.string().trim().length(2).toUpperCase(),
    isDefault: z.boolean().optional(),
  });

  app.get('/shop/account/addresses', async (req, reply) => {
    const customer = await requireCustomer(req);
    reply.send({
      addresses: await db.address.findMany({
        where: { customerId: customer.id },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
    });
  });

  app.post('/shop/account/addresses', async (req, reply) => {
    const customer = await requireCustomer(req);
    const input = AddressInput.parse(req.body);
    // The first address a customer saves is their default whether they asked
    // or not — an account with addresses and no default has nothing to
    // pre-fill a checkout with.
    const count = await db.address.count({ where: { customerId: customer.id } });
    const makeDefault = input.isDefault === true || count === 0;
    if (makeDefault) {
      await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    }
    reply.status(201).send(await db.address.create({
      data: { ...input, isDefault: makeDefault, customerId: customer.id },
    }));
  });

  app.patch('/shop/account/addresses/:id', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(req.params);
    const input = AddressInput.partial().parse(req.body);
    // Scoped by customerId as well as id, so a guessed id edits nothing.
    const owned = await db.address.findFirst({ where: { id, customerId: customer.id }, select: { id: true } });
    if (!owned) throw new NotFoundError('Address not found.', 'id');
    if (input.isDefault === true) {
      await db.address.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    }
    reply.send(await db.address.update({ where: { id }, data: input }));
  });

  app.delete('/shop/account/addresses/:id', async (req, reply) => {
    const customer = await requireCustomer(req);
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(req.params);
    const row = await db.address.findFirst({ where: { id, customerId: customer.id }, select: { id: true, isDefault: true } });
    if (!row) throw new NotFoundError('Address not found.', 'id');
    await db.address.delete({ where: { id } });
    // Deleting the default promotes the next one, rather than leaving the
    // account with addresses and nothing marked.
    if (row.isDefault) {
      const next = await db.address.findFirst({ where: { customerId: customer.id }, select: { id: true } });
      if (next) await db.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    reply.send({ removed: id });
  });

  // ── Profile ───────────────────────────────────────────────────────────
  //
  // Name only. Email is the account's identity and its login, so changing it
  // is a verification flow rather than a text field, and doing it silently
  // here would let a session takeover lock the real owner out.
  app.patch('/shop/account/profile', async (req, reply) => {
    const customer = await requireCustomer(req);
    const input = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    const updated = await db.customer.update({
      where: { id: customer.id },
      data: { name: input.name },
      select: { id: true, email: true, name: true },
    });
    reply.send(updated);
  });

  // Start a redirect payment (PayPal today) and hand back the approval URL.
  // Public for the same reason pay-token is: the order's own access token is
  // the credential, so this can only ever act on an order the caller already
  // holds the token for.
  app.post('/shop/checkout/redirect-start', async (req, reply) => {
    const input = z.object({
      orderNumber: z.string().min(1).max(60),
      accessToken: z.string().min(1).max(200),
      provider: z.enum(['paypal']),
      // Which PayPal funding the shopper picked. Only 'venmo' changes anything
      // downstream (it needs payment_source.venmo); the rest use the plain
      // PayPal flow. Optional so older clients keep working.
      method: z.string().max(40).optional(),
    }).parse(req.body);
    // Venmo's payment_source needs return URLs. Build them from the request's
    // own origin so this works on any host without a hardcoded base URL.
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'https';
    const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host ?? '';
    const origin = host ? `${proto}://${host}` : '';
    const ctx = origin
      ? {
          fundingMethod: input.method,
          returnUrl: `${origin}/order-received/?order=${encodeURIComponent(input.orderNumber)}&token=${encodeURIComponent(input.accessToken)}`,
          cancelUrl: `${origin}/cart`,
        }
      : { fundingMethod: input.method };
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');
    const intent = await paymentGatewayService.createIntent(input.orderNumber, input.accessToken, input.provider, ctx);
    reply.send({ redirectUrl: intent.redirectUrl, intentId: intent.intentId, status: intent.status });
  });

  // Finish one. The card polls this after the approval window closes: unlike
  // /checkout/return it answers in JSON instead of redirecting, because the
  // shopper never left the page to begin with.
  app.post('/shop/checkout/redirect-finish', async (req, reply) => {
    const input = z.object({
      orderNumber: z.string().min(1).max(60),
      accessToken: z.string().min(1).max(200),
      provider: z.enum(['paypal']),
    }).parse(req.body);
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');
    reply.send(await paymentGatewayService.finalizeReturn(input.provider, input.orderNumber, input.accessToken));
  });

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

/** The Stripe customer id kept on a shopper's meta, or null. */
function stripeIdOf(customer: { meta?: unknown }): string | null {
  const meta = (customer.meta && typeof customer.meta === 'object' ? customer.meta : {}) as Record<string, unknown>;
  return typeof meta.stripeCustomerId === 'string' ? meta.stripeCustomerId : null;
}

/**
 * Who, if anyone, is this payment being saved against?
 *
 * The customer comes from the SESSION, never from the request body, so a
 * crafted request cannot attach a card to another shopper's account. A guest,
 * or a request with no session, gets `{ customerId: null, save: false }` and
 * pays exactly as before — vaulting is additive and never a precondition.
 *
 * Never throws: failing to resolve a vault must not stop someone paying.
 */
async function resolveVault(
  req: FastifyRequest,
  provider: string,
  wantsSave: boolean,
): Promise<{ customerId: string | null; save: boolean }> {
  if (provider !== 'stripe') return { customerId: null, save: false };
  try {
    const customer = await resolveCustomer(req);
    if (!customer) return { customerId: null, save: false };
    const meta = (customer.meta && typeof customer.meta === 'object' ? customer.meta : {}) as Record<string, unknown>;
    const existing = typeof meta.stripeCustomerId === 'string' ? meta.stripeCustomerId : null;
    // Only reach Stripe when there is a reason to: an existing id is enough
    // to charge against, and a new one is only worth creating if this payment
    // is actually going to be saved.
    if (!existing && !wantsSave) return { customerId: null, save: false };
    const { paymentGatewayService } = await import('../../services/paymentGateway.service.js');
    const customerId = await paymentGatewayService.ensureVaultCustomer(customer.id, customer.email, customer.name);
    return { customerId, save: wantsSave };
  } catch {
    return { customerId: null, save: false };
  }
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
  // Pull a catalog FROM any connected provider. Provider-agnostic on purpose:
  // adding one is a registry entry in catalogSync.ts, not another route.
  app.get('/counter/sync/providers', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (_req, reply) => {
    const { catalogSyncService } = await import('../../counter/catalogSync.js');
    reply.send({ providers: await catalogSyncService.providers() });
  });

  app.post('/counter/sync/:provider', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { catalogSyncService } = await import('../../counter/catalogSync.js');
    reply.send(await catalogSyncService.run(provider));
  });

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

  // Payments & Transactions — WooPayments-equivalent surfaces. Read-only Stripe
  // (balance, payouts, ledger, disputes) behind the Counter > Payments screens.
  // Admin scope: the authenticate + commerce hooks above already guard these.
  app.get('/counter/payments/overview', async (_req, reply) => {
    reply.send(await stripePayments.overview());
  });
  app.get('/counter/payments/payouts', async (req, reply) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 20, 100);
    reply.send(await stripePayments.payouts(limit));
  });
  app.get('/counter/payments/payouts/:id', async (req, reply) => {
    reply.send(await stripePayments.payout((req.params as { id: string }).id));
  });
  app.get('/counter/payments/transactions', async (req, reply) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 25, 100);
    reply.send(await stripePayments.transactions(limit));
  });
  app.get('/counter/payments/disputes', async (req, reply) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 25, 100);
    reply.send(await stripePayments.disputes(limit));
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

  // ── Catalogue import (any file, mapped by hand) ───────────────────────
  //
  // Two steps on purpose. ANALYSE is read-only: it reads the headers, guesses
  // what each column means and hands back a sample, so the mapping can be
  // corrected before anything exists. COMMIT is the only call that writes.
  // Upload a FILE — PDF, spreadsheet or delimited text. Read-only: it returns
  // the rows it found, the mapping it guesses, and any images it pulled out of
  // a PDF. Nothing is written until commit.
  app.post('/counter/import/catalog/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new ValidationError('No file was uploaded.', 'file');
    const buffer = await file.toBuffer();
    if (!buffer.length) throw new ValidationError('That file is empty.', 'file');

    const extracted = await catalogFiles.extract(buffer, file.filename, file.mimetype);
    if (extracted.rows.length < 2) {
      throw new ValidationError(
        extracted.notes[0] ?? 'Nothing readable was found in that file.',
        'file',
      );
    }
    const headers = extracted.rows[0] ?? [];
    reply.send({
      kind: extracted.kind,
      headers,
      // Sampled rows, not just the headers — the values are what identify a
      // column, and a header may be in any language or absent entirely.
      suggested: catalogImport.suggestMapping(headers, extracted.rows.slice(1, 41)),
      sample: extracted.rows.slice(1, 6),
      totalRows: extracted.rows.length - 1,
      images: extracted.images,
      notes: extracted.notes,
      fields: catalogImport.TARGET_FIELDS,
      // Handed back so commit works on exactly what was shown, rather than
      // re-parsing and possibly reaching a different answer.
      rows: extracted.rows,
    });
  });

  app.post('/counter/import/catalog/analyze', async (req, reply) => {
    const input = z.object({ text: z.string().min(1).max(20 * 1024 * 1024) }).parse(req.body);
    reply.send({ ...catalogImport.analyze(input.text), fields: catalogImport.TARGET_FIELDS });
  });

  app.post('/counter/import/catalog/commit', async (req, reply) => {
    const input = z.object({
      text: z.string().max(20 * 1024 * 1024).optional(),
      rows: z.array(z.array(z.string())).max(50_000).optional(),
      // Data URLs lifted out of a PDF, one per row. Capped so a pathological
      // file cannot post a hundred megabytes of base64 back at us.
      rowImages: z.array(z.string().max(12 * 1024 * 1024).nullable()).max(5_000).optional(),
      mapping: z.array(z.enum(['name', 'description', 'price', 'sku', 'image', 'category', 'tags', 'status', 'stock', 'ignore'])),
      withImages: z.boolean().optional(),
      onDuplicate: z.enum(['skip', 'update']).optional(),
      defaultStatus: z.enum(['draft', 'active']).optional(),
    }).parse(req.body);

    // Rows arrive already extracted when the source was a PDF or a spreadsheet
    // — re-parsing those is not possible from text alone.
    const rows = input.rows ?? catalogImport.parseDelimited(input.text ?? '');
    if (rows.length < 2) throw new ValidationError('That file has a header but no rows.', 'text');
    const result = await catalogImport.commit({
      mapping: input.mapping,
      rows: rows.slice(1),
      withImages: input.withImages,
      rowImages: input.rowImages,
      onDuplicate: input.onDuplicate,
      defaultStatus: input.defaultStatus,
    });
    reply.send(result);
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
