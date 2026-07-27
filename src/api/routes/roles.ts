import type { FastifyInstance } from 'fastify';
import { roleService, BUNDLES } from '../../services/role.service.js';
import { CreateRoleInput, UpdateRoleInput } from '../../schemas/role.schema.js';
import { requireFullAdmin } from '../../middleware/bundle.js';

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  // Read access (the list + the bundle catalog) stays available to any
  // authenticated session — a custom-role user should be able to see what
  // role they're on. Creating/editing/deleting roles is full-admin only
  // (see requireFullAdmin's own comment: not delegable via any bundle).
  app.get('/roles', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await roleService.list());
  });

  app.get('/roles/bundles', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(BUNDLES);
  });

  app.post('/roles', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    reply.status(201).send(await roleService.create(CreateRoleInput.parse(req.body)));
  });

  app.patch('/roles/:id', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await roleService.update(id, UpdateRoleInput.parse(req.body)));
  });

  app.delete('/roles/:id', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await roleService.delete(id);
    reply.send({ ok: true });
  });
}
