import type { FastifyInstance } from 'fastify';
import { RedirectRuleInput } from '../../schemas/settings.schema.js';
import { redirectsService } from '../../services/redirects.service.js';
import { notFoundMonitorService } from '../../services/notFoundMonitor.service.js';
import { requireBundle } from '../../middleware/bundle.js';

// Mutations here were only ever gated by app.authenticate (no bundle check)
// until now — a real gap found while building the 404 monitor alongside
// this file: any custom-role session could create/toggle/delete redirect
// rules regardless of bundles, unlike every other settings-adjacent route
// this session already gated behind 'manage-settings'.
export async function redirectsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/redirects', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await redirectsService.list());
  });

  app.post('/redirects', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    reply.send(await redirectsService.create(RedirectRuleInput.parse(req.body)));
  });

  app.post('/redirects/:id/toggle', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    reply.send(await redirectsService.toggle((req.params as { id: string }).id));
  });

  app.delete('/redirects/:id', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    await redirectsService.remove((req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.get('/redirects/not-found', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await notFoundMonitorService.list());
  });

  app.delete('/redirects/not-found/:id', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    await notFoundMonitorService.remove((req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.post('/redirects/not-found/clear', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (_req, reply) => {
    await notFoundMonitorService.clear();
    reply.send({ ok: true });
  });
}
