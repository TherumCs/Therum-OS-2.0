import type { FastifyInstance } from 'fastify';
import { RunImportInput } from '../../schemas/import.schema.js';
import { importService } from '../../services/import.service.js';
import { importQueue } from '../../lib/queue.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // Synchronous: dryRun:true previews; dryRun:false commits inline. Best for small sets.
  app.post('/import', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await importService.run(RunImportInput.parse(req.body)));
  });

  // Async: enqueue a (large) import; the worker drains it. Returns a job id to poll.
  app.post('/import/async', { preHandler: app.authenticate }, async (req, reply) => {
    const input = RunImportInput.parse(req.body);
    const job = await importQueue.add('run', input, { removeOnComplete: 200, removeOnFail: 200 });
    reply.status(202).send({ jobId: job.id, queued: true });
  });

  // Poll an import job's status + audit result.
  app.get('/import/jobs/:id', { preHandler: app.authenticate }, async (req, reply) => {
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
