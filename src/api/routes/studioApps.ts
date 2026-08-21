import type { FastifyInstance } from 'fastify';
import { studioAppService } from '../../services/studioApp.service.js';
import { requireBundle } from '../../middleware/bundle.js';

export async function studioAppRoutes(app: FastifyInstance): Promise<void> {
  app.get('/studio-apps', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await studioAppService.list());
  });

  app.patch('/studio-apps/:id', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { enabled } = req.body as { enabled?: boolean };
    reply.send(await studioAppService.setEnabled(id, Boolean(enabled)));
  });
}
