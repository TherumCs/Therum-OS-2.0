import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { salesReportService } from '../../services/commerceEmail.service.js';

// Counter C6 — sales reporting. Read-only, any authenticated session.
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/reports/sales', async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    reply.send(await salesReportService.summary(days));
  });
}
