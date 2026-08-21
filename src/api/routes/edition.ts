import type { FastifyInstance } from 'fastify';
import { editionService } from '../../services/edition.service.js';

export async function editionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/edition', async (_req, reply) => {
    reply.send({ edition: await editionService.get() });
  });

  // Switch Pure ⟷ Unlocked (the entitlement gate). Admin only.
  app.patch('/edition', { preHandler: app.authenticate }, async (req, reply) => {
    const edition = (req.body as { edition?: string }).edition === 'unlocked' ? 'unlocked' : 'pure';
    reply.send(await editionService.set(edition));
  });
}
