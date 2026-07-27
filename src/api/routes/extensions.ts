import type { FastifyInstance } from 'fastify';
import { RegisterExtensionInput, UpdateExtensionInput } from '../../schemas/extension.schema.js';
import { extensionService } from '../../services/extension.service.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/extensions', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await extensionService.list());
  });

  app.get('/extensions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await extensionService.get(idParam(req)));
  });

  app.post('/extensions', { preHandler: app.authenticate }, async (req, reply) => {
    reply.status(201).send(await extensionService.register(RegisterExtensionInput.parse(req.body)));
  });

  app.patch('/extensions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await extensionService.update(idParam(req), UpdateExtensionInput.parse(req.body)));
  });

  app.delete('/extensions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await extensionService.remove(idParam(req)));
  });
}
