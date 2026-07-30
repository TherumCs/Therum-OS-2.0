import type { FastifyInstance } from 'fastify';
import { CreateOrderInput, TransitionOrderInput, ListOrdersQuery } from '../../schemas/order.schema.js';
import { orderService } from '../../services/order.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError } from '../../lib/errors.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('commerce'));

  app.get('/orders', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await orderService.list(ListOrdersQuery.parse(req.query)));
  });

  app.get('/orders/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await orderService.get(idParam(req)));
  });

  // Public checkout — protected by idempotency + the inventory guard, not auth.
  // Idempotency stops a double-submit turning into two orders; it does nothing
  // about a script posting a thousand DISTINCT orders, which reserves stock and
  // fills the table. So the endpoint is also throttled per IP.
  app.post('/orders', async (req, reply) => {
    const rl = await checkRateLimit(`order-create:${req.ip}`, 10, 600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many orders from this address — try again shortly.', rl.retryAfterSeconds);
    reply.status(201).send(await orderService.create(CreateOrderInput.parse(req.body)));
  });

  app.post('/orders/:id/transition', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await orderService.transition(idParam(req), TransitionOrderInput.parse(req.body)));
  });
}
