import type { FastifyInstance } from 'fastify';
import { adminUserService } from '../../services/adminUser.service.js';
import { AssignRoleInput } from '../../schemas/role.schema.js';
import { requireFullAdmin } from '../../middleware/bundle.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await adminUserService.list());
  });

  // Full-admin only — see requireFullAdmin's own comment (roles.ts): who
  // can assign a role is itself a privilege-escalation surface, not
  // something to gate behind the roles/bundles system it's assigning.
  app.patch('/users/:id/role', { preHandler: [app.authenticate, requireFullAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = AssignRoleInput.parse(req.body);
    reply.send(await adminUserService.assignRole(id, input.roleId));
  });
}
