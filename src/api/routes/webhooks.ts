import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../lib/env.js';
import { verifyHmac } from '../../lib/webhook.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { orderService } from '../../services/order.service.js';

const WebhookEvent = z.object({
  type: z.enum(['payment.succeeded', 'payment.failed']),
  orderId: z.string().min(1),
  txnId: z.string().optional(),
  method: z.string().optional(),
});

// Payment webhook receiver. Auth is the HMAC signature over the raw body
// (constant-time). Idempotent: markPaid only advances pending → processing once.
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/:provider', async (req, reply) => {
    if (!env.WEBHOOK_SECRET) {
      reply.status(503).send({ error: { code: 'webhooks_disabled', message: 'WEBHOOK_SECRET is not configured.' } });
      return;
    }
    const header = req.headers['x-therum-signature'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!verifyHmac(req.rawBody ?? '', sig, env.WEBHOOK_SECRET)) {
      throw new UnauthorizedError('Invalid webhook signature');
    }

    const event = WebhookEvent.parse(req.body);
    const psp = (req.body ?? {}) as Prisma.InputJsonValue;

    if (event.type === 'payment.succeeded') {
      const order = await orderService.markPaid(event.orderId, event.txnId ?? null, event.method ?? null, psp);
      reply.send({ ok: true, status: order.status });
      return;
    }

    const order = await orderService.transition(event.orderId, { status: 'failed' });
    reply.send({ ok: true, status: order.status });
  });
}
