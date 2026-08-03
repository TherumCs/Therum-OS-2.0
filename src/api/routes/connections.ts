import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { connectionService } from '../../services/connection.service.js';
import { ConnectInput } from '../../schemas/connection.schema.js';
import { requireBundle } from '../../middleware/bundle.js';
import { stripeMethods } from '../../counter/stripeMethods.js';
import { db } from '../../lib/db.js';

const requireConnectionsWrite = requireBundle('manage-settings');

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Which partners are subscribed to order events, and whether delivery works.
   *
   * This exists because the failure it surfaces is SILENT. A partner can hold a
   * read_write key, sync your whole catalogue, and never register a webhook —
   * so orders arrive in the store and nothing is ever printed. Nothing in the
   * admin said so, because "no webhooks" and "webhooks working" looked
   * identical: both are an empty error log.
   */
  app.get('/connections/order-routing', { preHandler: app.authenticate }, async (_req, reply) => {
    const hooks = await db.storeWebhook.findMany({ orderBy: { createdAt: 'desc' } });
    const partners = await db.storeCredential.findMany({ select: { id: true, label: true } });

    const rows = await Promise.all(hooks.map(async (h) => {
      const last = await db.webhookDelivery.findFirst({
        where: { webhookId: h.id }, orderBy: { createdAt: 'desc' },
      });
      const fails = await db.webhookDelivery.count({
        where: { webhookId: h.id, OR: [{ error: { not: null } }, { responseCode: { gte: 400 } }] },
      });
      return {
        id: h.id,
        topic: h.topic,
        deliveryUrl: h.deliveryUrl,
        status: h.status,
        partner: partners.find((p) => p.id === h.credentialId)?.label ?? null,
        lastDeliveryAt: last?.createdAt ?? null,
        lastResult: last ? (last.error ?? `HTTP ${last.responseCode ?? '?'}`) : null,
        failures: fails,
      };
    }));

    // The headline number: partners holding a key but subscribed to nothing.
    const subscribedIds = new Set(hooks.map((h) => h.credentialId).filter(Boolean));
    const unsubscribed = partners.filter((p) => !subscribedIds.has(p.id)).map((p) => p.label);

    reply.send({
      webhooks: rows,
      partnersWithoutWebhooks: unsubscribed,
      ordersWillReachNobody: rows.filter((r) => r.status === 'active').length === 0,
    });
  });

  /**
   * Stripe payment methods, managed from here rather than Stripe's dashboard.
   *
   * `drift` is the reason this is worth having: it names every method this
   * store will OFFER that Stripe will REFUSE, which is otherwise invisible
   * until a shopper picks one at checkout.
   */
  app.get('/connections/stripe/methods', { preHandler: app.authenticate }, async (_req, reply) => {
    const [listed, drift] = await Promise.all([stripeMethods.list(), stripeMethods.drift()]);
    reply.send({ ...listed, drift });
  });

  app.post('/connections/stripe/methods/pin', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { configId } = z.object({ configId: z.string().min(1).max(120) }).parse(req.body);
    await stripeMethods.pin(configId);
    reply.send(await stripeMethods.list());
  });

  app.post('/connections/stripe/methods/:methodId', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { methodId } = req.params as { methodId: string };
    const { configId, on } = z.object({
      configId: z.string().min(1).max(120),
      on: z.boolean(),
    }).parse(req.body);
    await stripeMethods.setMethod(configId, methodId, on);
    reply.send(await stripeMethods.list());
  });

  app.get('/connections', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await connectionService.list());
  });

  app.post('/connections/:provider', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { credential, method } = ConnectInput.parse(req.body);
    reply.status(201).send(await connectionService.connect(provider, credential, req.user.sub, method));
  });

  app.delete('/connections/:provider', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    reply.send(await connectionService.disconnect(provider, req.user.sub));
  });

  app.post('/connections/:provider/test', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    reply.send(await connectionService.test(provider, req.user.sub));
  });

  app.get('/connections/audit-log', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await connectionService.auditLog());
  });

  app.get('/connections/webhook-log', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await connectionService.webhookLog());
  });

  app.get('/connections/webhook-secrets', { preHandler: app.authenticate }, async (_req, reply) => {
    const entries = await Promise.all(
      ['github', 'stripe', 'slack'].map(async (p) => [p, await connectionService.hasWebhookSecret(p)] as const),
    );
    reply.send(Object.fromEntries(entries));
  });

  app.put('/connections/:provider/webhook-secret', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { secret } = req.body as { secret?: string };
    if (!connectionService.hasSignatureScheme(provider)) {
      reply.status(409).send({ error: { code: 'no_signature_scheme', message: 'No signature scheme wired for this provider yet.' } });
      return;
    }
    if (!secret?.trim()) {
      reply.status(400).send({ error: { code: 'bad_request', message: 'secret is required.' } });
      return;
    }
    await connectionService.setWebhookSecret(provider, secret);
    reply.send({ ok: true });
  });

  // Public — real third-party providers call this, not a browser session.
  // Signature verification is real for github/stripe/slack once a secret is
  // configured (src/lib/webhookSignatures.ts) — a configured secret that
  // fails verification is rejected outright (401), not just logged. No
  // secret configured yet, or no scheme wired for this provider, logs as
  // unverified (`verified: null`) rather than blocking — business logic
  // (what to actually DO with a verified event) is still real work landing
  // provider by provider.
  app.post('/webhooks/connections/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const body = req.body as Record<string, unknown> | undefined;
    const header = (name: string): string | undefined => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const verified = await connectionService.verifyWebhook(provider, req.rawBody ?? '', header);
    if (verified === false) {
      reply.status(401).send({ error: { code: 'invalid_signature', message: 'Webhook signature verification failed.' } });
      return;
    }
    const event = typeof body?.type === 'string' ? body.type : typeof body?.event === 'string' ? body.event : null;
    const summary = body ? JSON.stringify(body).slice(0, 2000) : null;
    await connectionService.recordWebhook(provider, event, summary, verified);
    reply.send({ ok: true });
  });
}
