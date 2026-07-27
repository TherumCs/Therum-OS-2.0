import type { FastifyInstance } from 'fastify';
import { CreateOrderInput, TransitionOrderInput, ListOrdersQuery } from '../../schemas/order.schema.js';
import { orderService } from '../../services/order.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

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
  app.post('/orders', async (req, reply) => {
    reply.status(201).send(await orderService.create(CreateOrderInput.parse(req.body)));
  });

  app.post('/orders/:id/transition', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await orderService.transition(idParam(req), TransitionOrderInput.parse(req.body)));
  });
}
