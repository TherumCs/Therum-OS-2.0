import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateOrderInput, TransitionOrderInput, ListOrdersQuery } from '../../schemas/order.schema.js';
import { orderService } from '../../services/order.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError } from '../../lib/errors.js';

const ProductionInput = z.object({
  status: z.enum(['pending', 'in_production', 'shipped', 'delivered', 'cancelled']),
  // Omit / empty = the whole order's items; otherwise just these lines.
  itemIds: z.array(z.string().min(1)).optional(),
});

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('commerce'));

  app.get('/orders', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await orderService.list(ListOrdersQuery.parse(req.query)));
  });

  app.get('/orders/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await orderService.get(idParam(req)));
  });

  // ADMIN-ONLY order creation. This is NOT the storefront checkout path — the
  // shopper checks out through /cart/checkout, which recomputes every total
  // (discount margin-clamped, shipping/tax from the real quote) server-side and
  // calls orderService.create INTERNALLY. This route exposes create() with its
  // full trusted schema (discountOverride, shippingTotal, taxTotal, customerId).
  // Leaving it unauthenticated let anyone POST an order with a discountOverride
  // of (subtotal - 0.50) and buy a full basket for pennies, then pay it with the
  // returned accessToken — a live money/goods-loss hole. Locked to an admin with
  // the storefront-manager bundle, same as /orders/:id/transition.
  app.post('/orders', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const rl = await checkRateLimit(`order-create:${req.ip}`, 10, 600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many orders from this address — try again shortly.', rl.retryAfterSeconds);
    reply.status(201).send(await orderService.create(CreateOrderInput.parse(req.body)));
  });

  app.post('/orders/:id/transition', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await orderService.transition(idParam(req), TransitionOrderInput.parse(req.body)));
  });

  // Per-line production stage (multi-vendor: each product advances on its own).
  // Entering 'in_production' emails the customer once per line.
  app.post('/orders/:id/production', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await orderService.setItemProduction(idParam(req), ProductionInput.parse(req.body)));
  });
}
