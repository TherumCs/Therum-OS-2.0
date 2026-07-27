import type { FastifyInstance } from 'fastify';
import { connectionService } from '../../services/connection.service.js';
import { ConnectInput } from '../../schemas/connection.schema.js';
import { requireBundle } from '../../middleware/bundle.js';

const requireConnectionsWrite = requireBundle('manage-settings');

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/connections', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await connectionService.list());
  });

  app.post('/connections/:provider', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { credential } = ConnectInput.parse(req.body);
    reply.status(201).send(await connectionService.connect(provider, credential, req.user.sub));
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
