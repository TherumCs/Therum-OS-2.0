import type { FastifyInstance } from 'fastify';
import { couponService } from '../../services/coupon.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';
import { CreateCouponInput, UpdateCouponInput } from '../../schemas/coupon.schema.js';

// Counter C3 — admin coupon management. Reads open to any authenticated
// session; mutations require the storefront-manager bundle (convention).
// There is deliberately NO public coupon-lookup route — probing validity
// happens only inside the cart (POST /api/cart/coupon), so codes can't be
// enumerated the way the Milieus email path once could.
export async function couponRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireCapability('commerce'));
  const write = requireBundle('storefront-manager');

  app.get('/coupons', async (_req, reply) => {
    reply.send(await couponService.list());
  });

  app.post('/coupons', { preHandler: write }, async (req, reply) => {
    reply.status(201).send(await couponService.create(CreateCouponInput.parse(req.body)));
  });

  app.patch('/coupons/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await couponService.update(id, UpdateCouponInput.parse(req.body)));
  });

  app.delete('/coupons/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await couponService.remove(id);
    reply.send({ ok: true });
  });
}
