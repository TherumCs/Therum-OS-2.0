import type { FastifyInstance } from 'fastify';
import { systemService } from '../../services/system.service.js';

// Distinct from the bare, unauthenticated `/health` liveness probe (used by
// load balancers / uptime checks) — this is the richer, admin-facing status
// the dashboard's Site Health card renders, gated behind real auth since it
// reveals things like "is the JWT secret still the dev default."
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/system/health', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(await systemService.health());
  });

  app.get('/system/about', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(systemService.about());
  });

  app.get('/system/runtime', { preHandler: app.authenticate }, async (_req, reply) => {
    reply.send(systemService.runtime());
  });
}
