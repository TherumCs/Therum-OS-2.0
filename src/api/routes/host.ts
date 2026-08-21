import type { FastifyInstance } from 'fastify';
import { hostAdvisorService } from '../../services/hostAdvisor.service.js';
import { hostActionService } from '../../services/hostAction.service.js';
import { hostConsoleService } from '../../services/hostConsole.service.js';
import { hostingProviderService } from '../../services/hostingProvider.service.js';
import { requireBundle } from '../../middleware/bundle.js';

// The Host Advisor reads the machine this install runs on; the Server panel
// acts on it. Those are two different security propositions and they stay two
// surfaces: `/host/scan` cannot change anything, and `/host/actions/:id/run`
// can only run one of a fixed list compiled into this server.
//
// An earlier version of this file said read-only was permanent. That changed by
// decision: this panel replaces cPanel/Plesk on Bam's box, and a panel that can
// only describe a broken firewall is worse than the terminal it replaces. What
// carried over is the part that actually mattered — there is still no endpoint
// anywhere that accepts a command. See hostAction.service.ts.
//
// Gated on manage-settings rather than plain auth: the payload names datastore
// hosts, file modes and (on a server) the SSH configuration, and the actions
// restart services. That is an operator's view of the box, not an editor's.
export async function hostRoutes(app: FastifyInstance): Promise<void> {
  const operator = { preHandler: [app.authenticate, requireBundle('manage-settings')] };

  app.get('/host/probes', operator, async (_req, reply) => {
    reply.send({ probes: hostAdvisorService.probes() });
  });

  // POST because it executes work — several probes shell out or query the
  // database, so this is not a cacheable GET however much it reads like one.
  app.post('/host/scan', operator, async (_req, reply) => {
    reply.send(await hostAdvisorService.scan());
  });

  app.get('/host/actions', operator, async (_req, reply) => {
    reply.send({ actions: hostActionService.list(), log: await hostActionService.log() });
  });

  app.get('/host/console', operator, async (_req, reply) => {
    reply.send({ commands: hostConsoleService.commands() });
  });

  // The console is read-only by construction — see hostConsole.service.ts. The
  // line is PARSED here, never passed to a shell, so `rm -rf /` is not a
  // dangerous string to receive; it is an unknown command name.
  app.post<{ Body: { line?: string } }>('/host/console/run', operator, async (req, reply) => {
    try {
      const result = await hostConsoleService.run(
        req.body?.line ?? '',
        (req.user as { sub?: string } | undefined)?.sub ?? null,
      );
      reply.send(result);
    } catch (e) {
      reply.status(400).send({ error: { code: 'not_a_command', message: e instanceof Error ? e.message : String(e) } });
    }
  });

  // The hosting provider's own API — reachable when the box is not, which is
  // the only reason it exists. Everything else on this router runs ON the
  // machine and goes down with it.
  app.get('/host/hosting', operator, async (_req, reply) => {
    const providers = await hostingProviderService.providers();
    const connected = providers.find((p) => p.connected);
    if (!connected) return reply.send({ providers, machines: [] });
    try {
      reply.send({ providers, machines: await hostingProviderService.list(connected.id) });
    } catch (e) {
      // A failed list is reported WITH the provider list, so the panel can
      // still say who is connected while explaining why it has no machines.
      reply.send({ providers, machines: [], error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Params: { provider: string; id: string; action: string } }>(
    '/host/hosting/:provider/:id/:action',
    operator,
    async (req, reply) => {
      const { provider, id, action } = req.params;
      if (!['start', 'stop', 'restart', 'snapshot'].includes(action)) {
        return reply.status(404).send({ error: { code: 'not_found', message: `Unknown action "${action}".` } });
      }
      const result = await hostingProviderService.act(
        provider,
        id,
        action as 'start' | 'stop' | 'restart' | 'snapshot',
        (req.user as { sub?: string } | undefined)?.sub ?? null,
      );
      reply.status(result.ok ? 200 : 400).send(result);
    },
  );

  app.post<{ Params: { id: string }; Body: { dryRun?: boolean } }>('/host/actions/:id/run', operator, async (req, reply) => {
    try {
      // `id` is a LOOKUP KEY, not a command fragment: an unknown id is a 404
      // and never reaches a process.
      const result = await hostActionService.run(req.params.id, {
        dryRun: req.body?.dryRun === true,
        actorId: (req.user as { sub?: string } | undefined)?.sub ?? null,
      });
      reply.send(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      reply.status(message.startsWith('Unknown action') ? 404 : 400).send({ error: { code: 'action_refused', message } });
    }
  });
}
