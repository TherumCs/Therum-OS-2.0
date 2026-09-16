import type { FastifyInstance, FastifyReply } from 'fastify';
import { RegisterExtensionInput, UpdateExtensionInput } from '../../schemas/extension.schema.js';
import { extensionService } from '../../services/extension.service.js';
import { requireFullAdmin } from '../../middleware/bundle.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

// Capability state (commerce on/off, etc.) is stored in the extension table
// under `capability:`-prefixed rows, but it has its OWN controlled entry point
// (PATCH /capabilities/:id). Editing or deleting those rows through the generic
// extension route would be a second, unguarded way to disable the storefront —
// refuse it so capability state changes only through the capability route.
function guardCapabilityRow(id: string, reply: FastifyReply): boolean {
  if (id.startsWith('capability:')) {
    reply.status(403).send({ error: { code: 'capability_row', message: 'Capability state is managed via /capabilities, not the extension route.' } });
    return false;
  }
  return true;
}

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/extensions', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await extensionService.list());
  });

  app.get('/extensions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await extensionService.get(idParam(req)));
  });

  app.post('/extensions', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    reply.status(201).send(await extensionService.register(RegisterExtensionInput.parse(req.body)));
  });

  app.patch('/extensions/:id', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    if (!guardCapabilityRow(idParam(req), reply)) return;
    reply.send(await extensionService.update(idParam(req), UpdateExtensionInput.parse(req.body)));
  });

  app.delete('/extensions/:id', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    if (!guardCapabilityRow(idParam(req), reply)) return;
    reply.send(await extensionService.remove(idParam(req)));
  });
}
