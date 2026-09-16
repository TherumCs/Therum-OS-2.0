import type { FastifyInstance } from 'fastify';
import { RunImportInput } from '../../schemas/import.schema.js';
import { importService } from '../../services/import.service.js';
import { importQueue } from '../../lib/queue.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // Bulk product create/overwrite is a commerce mutation and was gated on plain
  // authentication only — any authenticated admin, INCLUDING a read-only custom
  // role, could mass create/overwrite the catalogue (audit). Gate the whole
  // surface like every other admin commerce surface: authenticate + commerce
  // capability as ordered hooks (authenticate first so req.user is set before the
  // capability check), then the storefront-manager bundle on the mutating routes.
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireCapability('commerce'));

  // Synchronous: dryRun:true previews; dryRun:false commits inline. Best for small sets.
  app.post('/import', { preHandler: requireBundle('storefront-manager') }, async (req, reply) => {
    reply.send(await importService.run(RunImportInput.parse(req.body)));
  });

  // Async: enqueue a (large) import; the worker drains it. Returns a job id to poll.
  app.post('/import/async', { preHandler: requireBundle('storefront-manager') }, async (req, reply) => {
    const input = RunImportInput.parse(req.body);
    const job = await importQueue.add('run', input, { removeOnComplete: 200, removeOnFail: 200 });
    reply.status(202).send({ jobId: job.id, queued: true });
  });

  // Poll an import job's status + audit result.
  app.get('/import/jobs/:id', async (req, reply) => {
    const job = await importQueue.getJob(idParam(req));
    if (!job) {
      reply.status(404).send({ error: { code: 'not_found', message: 'Import job not found' } });
      return;
    }
    reply.send({
      jobId: job.id,
      state: await job.getState(),
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    });
  });
}
