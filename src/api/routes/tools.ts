import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findReplaceService } from '../../services/findReplace.service.js';
import { requireBundle } from '../../middleware/bundle.js';

const FindReplaceInput = z.object({ find: z.string().min(1), replace: z.string() });

export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tools/find-replace/preview', { preHandler: app.authenticate }, async (req, reply) => {
    const { find, replace } = FindReplaceInput.parse(req.body);
    reply.send(await findReplaceService.preview(find, replace));
  });

  // A bulk, site-wide content mutation triggered from Settings > Tools — a
  // power-user capability, not routine per-item editing, so it's gated the
  // same way every other Settings mutation is (execute() only; preview()
  // above is read-only, same principle as every other GET-equivalent route).
  app.post('/tools/find-replace/execute', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (req, reply) => {
    const { find, replace } = FindReplaceInput.parse(req.body);
    reply.send(await findReplaceService.execute(find, replace));
  });
}
