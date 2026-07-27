import type { FastifyInstance } from 'fastify';
import { foundationService } from '../../services/foundation.service.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function foundationRoutes(app: FastifyInstance): Promise<void> {
  // Public read — the builder needs to know which foundations are active.
  app.get('/foundations', async (_req, reply) => {
    reply.send(await foundationService.list());
  });

  // Enable / disable a foundation (Studio). Admin only.
  app.patch('/foundations/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const enabled = Boolean((req.body as { enabled?: boolean }).enabled);
    reply.send(await foundationService.setEnabled(idParam(req), enabled));
  });
}
