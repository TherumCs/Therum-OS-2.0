import type { FastifyInstance } from 'fastify';
import { hostAdvisorService } from '../../services/hostAdvisor.service.js';
import { requireBundle } from '../../middleware/bundle.js';

// The Host Advisor reads the machine this install runs on. Everything here is
// READ-ONLY — it reports and explains, it never applies a fix. That is not a
// phase-one limitation to be relaxed later; a tool that can both read a
// misconfiguration and change it is a different security proposition.
//
// Gated on manage-settings rather than plain auth: the payload names datastore
// hosts, file modes and (on a server) the SSH configuration. That is an
// operator's view of the box, not an editor's.
export async function hostRoutes(app: FastifyInstance): Promise<void> {
  app.get('/host/probes', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (_req, reply) => {
    reply.send({ probes: hostAdvisorService.probes() });
  });

  // POST because it executes work — several probes shell out or query the
  // database, so this is not a cacheable GET however much it reads like one.
  app.post('/host/scan', { preHandler: [app.authenticate, requireBundle('manage-settings')] }, async (_req, reply) => {
    reply.send(await hostAdvisorService.scan());
  });
}
