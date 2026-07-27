import type { FastifyInstance } from 'fastify';
import { capabilityService } from '../../services/capability.service.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function capabilityRoutes(app: FastifyInstance): Promise<void> {
  // Public read — each capability with its enabled state + active provider.
  app.get('/capabilities', async (_req, reply) => {
    reply.send(await capabilityService.list());
  });

  // Toggle a capability and/or select its provider (native / ecosystem / custom).
  app.patch('/capabilities/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const body = req.body as { enabled?: boolean; provider?: string };
    const id = idParam(req);
    if (body.provider !== undefined) await capabilityService.setProvider(id, body.provider);
    if (body.enabled !== undefined) {
      reply.send(await capabilityService.setEnabled(id, body.enabled));
      return;
    }
    reply.send(await capabilityService.get(id));
  });
}
