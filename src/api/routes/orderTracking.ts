import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderTrackingService } from '../../services/orderTracking.service.js';
import { resolveCustomer } from '../../counter/customerSession.js';
import { requireCapability } from '../../middleware/capability.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError, NotFoundError } from '../../lib/errors.js';

const TrackInput = z.object({
  number: z.string().min(3).max(60),
  // Optional only because a signed-in shopper does not need it.
  email: z.string().email().max(320).optional(),
});

export async function orderTrackingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('commerce'));

  app.post('/orders/track', async (req, reply) => {
    const input = TrackInput.parse(req.body);

    // This endpoint answers "does this number + email pair exist", which is
    // exactly the shape of a credential-stuffing probe. Throttled per IP for
    // the same reason the coupon apply route is.
    const rl = await checkRateLimit(`track:${req.ip}`, 12, 600);
    if (!rl.allowed) throw new TooManyRequestsError('Too many lookups — try again shortly.', rl.retryAfterSeconds);

    const customer = await resolveCustomer(req);
    const order = await orderTrackingService.track(input.number, input.email ?? null, customer?.id ?? null);

    // ONE error for "no such order" and "wrong email". Splitting them would
    // turn this into an order-number oracle: an attacker could confirm which
    // numbers are real without ever knowing an address.
    if (!order) throw new NotFoundError('No order found with that number and email.', 'number');

    reply.send({ order });
  });
}
