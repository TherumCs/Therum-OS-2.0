import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { paymentGatewayService } from '../../services/paymentGateway.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

const IntentInput = z.object({
  orderNumber: z.string().min(1),
  accessToken: z.string().min(1),
  provider: z.string().min(1),
});

const RefundInput = z.object({
  // Omitted = full remaining refund. Minor units.
  amount: z.number().int().min(1).optional(),
  reason: z.string().max(500).optional(),
  // Client-supplied idempotency key — retries with the same key return the
  // original refund instead of moving money twice (audit C-2).
  idempotencyKey: z.string().min(8).max(120).optional(),
});

// Counter C1 — checkout payment surface. The public routes are guest-safe
// by design: they authenticate with the ORDER's own access token (minted at
// creation, constant-time compared), never a session. The webhook is
// authenticated by the provider's cryptographic signature via the gateway
// contract. Admin refunds are bundle-gated like every other mutation.
export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  // What checkout can offer — gateways with their Nexus connection status.
  app.get('/checkout/gateways', { preHandler: requireCapability('commerce') }, async (_req, reply) => {
    reply.send(await paymentGatewayService.available());
  });

  // The method strip (1.x MethodRegistry port) — grouped methods with
  // availability + resolved provider. Drives the tabbed checkout selector.
  app.get('/checkout/methods', { preHandler: requireCapability('commerce') }, async (_req, reply) => {
    reply.send(await paymentGatewayService.methods());
  });

  app.post('/checkout/intent', { preHandler: requireCapability('commerce') }, async (req, reply) => {
    const input = IntentInput.parse(req.body);
    reply.send(await paymentGatewayService.createIntent(input.orderNumber, input.accessToken, input.provider));
  });

  // Redirect-gateway return leg (Zip/Sezzle/crypto/PayPal): verify with the
  // provider, finalize, and bounce to the receipt. The receipt page itself
  // ships with the storefront milestone (C4) — the contract and token are
  // stable now so provider return URLs never change.
  app.get('/checkout/return', { preHandler: requireCapability('commerce') }, async (req, reply) => {
    // `t` carries our access token. PayPal appends its own `token` (the PayPal
    // order id) to the return URL, so we read `t` first and fall back to
    // `token` for redirect gateways that don't collide.
    const q = req.query as { provider?: string; order?: string; token?: string; t?: string };
    const { provider, order } = q;
    const token = typeof q.t === 'string' ? q.t : (typeof q.token === 'string' ? q.token : undefined);
    if (!provider || !order || !token) {
      reply.status(422).send({ error: { code: 'validation', message: 'provider, order, and token are required.' } });
      return;
    }
    const result = await paymentGatewayService.finalizeReturn(provider, order, token);
    reply.redirect(`/order-received/?order=${encodeURIComponent(result.orderNumber)}&token=${encodeURIComponent(result.accessToken)}`, 303);
  });

  // PSP webhooks — separate from the generic Nexus logging receiver
  // (/api/webhooks/:provider): this one verifies through the gateway's own
  // scheme and drives real order state.
  app.post('/webhooks/psp/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    // Signature verification needs the provider's ORIGINAL bytes — a
    // re-serialized body can never match, so fail loudly instead of
    // producing a confusing signature mismatch (audit L-1).
    if (!req.rawBody) {
      reply.status(400).send({ error: { code: 'raw_body_required', message: 'PSP webhooks must be application/json (raw body unavailable for signature verification).' } });
      return;
    }
    reply.send(await paymentGatewayService.handleWebhook(provider, req.rawBody, req.headers));
  });

  app.post(
    '/orders/:id/refund',
    { preHandler: [app.authenticate, requireCapability('commerce'), requireBundle('storefront-manager')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const input = RefundInput.parse(req.body ?? {});
      reply.status(201).send(await paymentGatewayService.refund(id, input.amount, input.reason, input.idempotencyKey));
    },
  );
}
