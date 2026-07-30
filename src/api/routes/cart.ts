import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cartService } from '../../services/cart.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { resolveCustomer } from '../../counter/customerSession.js';
import { TooManyRequestsError } from '../../lib/errors.js';

const TOKEN = z.string().length(32);

const AddItemInput = z.object({
  cartToken: TOKEN.nullable().optional(),
  variantId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(999).default(1),
});

const SetQuantityInput = z.object({
  cartToken: TOKEN,
  quantity: z.number().int().min(0).max(999),
});

const IdentityInput = z.object({
  cartToken: TOKEN,
  email: z.string().email().max(320),
});

const CheckoutInput = z.object({
  cartToken: TOKEN,
  email: z.string().email().max(320).optional(),
});

// The cart token is the ONLY credential — it must never land in a URL path,
// where request logs / nginx access logs / Referer / browser history would
// capture it (audit M-3). Read/delete take it from the x-cart-token header.
function headerToken(req: FastifyRequest): string {
  const t = req.headers['x-cart-token'];
  return TOKEN.parse(Array.isArray(t) ? t[0] : t);
}

// Counter C2 — public cart surface. Anonymous by design: the cart token is
// the only credential (128-bit, Redis-backed, sliding TTL). No session
// exists until the first add-to-cart. All commerce-capability-gated.
export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('commerce'));

  app.post('/cart/items', async (req, reply) => {
    const input = AddItemInput.parse(req.body);
    // Rate-limit NEW cart creation per IP — an unbounded anonymous mint of
    // 7-day Redis keys is a memory-DoS vector (audit M-4). Adds to an
    // existing cart (token supplied) aren't throttled here.
    if (!input.cartToken) {
      const rl = await checkRateLimit(`cart-new:${req.ip}`, 30, 3600);
      if (!rl.allowed) throw new TooManyRequestsError('Too many new carts from this address — slow down.', rl.retryAfterSeconds);
    }
    const customer = await resolveCustomer(req);
    reply.status(input.cartToken ? 200 : 201).send(
      await cartService.addItem(input.cartToken ?? null, input.variantId, input.quantity, customer?.id ?? null),
    );
  });

  app.get('/cart', async (req, reply) => {
    // Reading the cart is also where a shopper who just signed in gets their
    // member pricing — the session is resolved on every read, not only on the
    // routes that mutate.
    const customer = await resolveCustomer(req);
    reply.send(await cartService.get(headerToken(req), customer?.id ?? null));
  });

  app.patch('/cart/items/:variantId', async (req, reply) => {
    const { variantId } = req.params as { variantId: string };
    const input = SetQuantityInput.parse(req.body);
    reply.send(await cartService.setQuantity(input.cartToken, variantId, input.quantity));
  });

  app.post('/cart/identity', async (req, reply) => {
    const input = IdentityInput.parse(req.body);
    reply.send(await cartService.setIdentity(input.cartToken, input.email));
  });

  app.delete('/cart', async (req, reply) => {
    await cartService.clear(headerToken(req));
    reply.send({ ok: true });
  });

  app.post('/cart/coupon', async (req, reply) => {
    const { cartToken, code } = z.object({ cartToken: TOKEN, code: z.string().min(1).max(40) }).parse(req.body);
    // Throttle coupon guessing per IP (audit F7) — the apply route is the
    // only validity probe, so an unbounded one is a code-enumeration oracle.
    const rl = await checkRateLimit(`cart-coupon:${req.ip}`, 20, 600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many coupon attempts — slow down.', rl.retryAfterSeconds);
    // A group-restricted code needs to know who is asking, and that has to be
    // the SESSION — see coupon.service.ts validate().
    const customer = await resolveCustomer(req);
    reply.send(await cartService.applyCoupon(cartToken, code, customer?.id ?? null));
  });

  app.delete('/cart/coupon', async (req, reply) => {
    reply.send(await cartService.removeCoupon(headerToken(req)));
  });

  // Cart → order. Returns the order number + guest access token — the
  // credentials the storefront needs for /api/checkout/intent and the
  // receipt. Double-submit safe: the cart token is the order idempotency key.
  app.post('/cart/checkout', async (req, reply) => {
    const input = CheckoutInput.parse(req.body);
    // A signed-in shopper's order belongs to their account, so it shows up in
    // their order history and earns any membership pricing. Resolved from the
    // SESSION, never from input.email — see cartService.checkout. Optional:
    // guest checkout stays exactly as it was.
    const customer = await resolveCustomer(req);
    reply.status(201).send(await cartService.checkout(input.cartToken, input.email, customer?.id));
  });
}
