import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentRunService } from '../../services/agentRun.service.js';
import { editProposalService } from '../../services/editProposal.service.js';
import { requireBundle } from '../../middleware/bundle.js';
import { NotFoundError } from '../../lib/errors.js';

const StartInput = z.object({ prompt: z.string().min(1).max(4000) });
const ApplyInput = z.object({ proposalId: z.string().min(1) });

// The assistant. Gated on manage-settings rather than plain auth: a run can
// read the host and the editable files, which is an operator's view, not an
// editor's.
//
// Applying an edit is a SEPARATE route from the run, on purpose. The agent
// never applies its own proposal — a human posts the id here after reading the
// diff. Keeping it off the run makes that impossible to skip by accident.
export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const gate = { preHandler: [app.authenticate, requireBundle('manage-settings')] };

  app.get('/agent/status', gate, async (_req, reply) => {
    reply.send(await agentRunService.available());
  });

  app.get('/agent/runs', gate, async (_req, reply) => {
    reply.send({ runs: agentRunService.list() });
  });

  app.post('/agent/runs', gate, async (req, reply) => {
    const { prompt } = StartInput.parse(req.body);
    const run = await agentRunService.start(prompt);
    reply.code(201).send(run);
  });

  // Polled by the card. The run continues regardless of whether anyone is
  // watching, so collapsing or navigating away does not kill it.
  app.get('/agent/runs/:id', gate, async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = agentRunService.get(id);
    if (!run) throw new NotFoundError('No such run.');
    reply.send(run);
  });

  app.get('/agent/proposals/:id', gate, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = editProposalService.get(id);
    if (!p) throw new NotFoundError('No such proposal — it may have expired.');
    // The full before/after is withheld; the diff is what a human reviews.
    reply.send({ id: p.id, label: p.label, diff: p.diff, stats: p.stats, warnings: p.warnings, appliedAt: p.appliedAt });
  });

  app.post('/agent/proposals/apply', gate, async (req, reply) => {
    const { proposalId } = ApplyInput.parse(req.body);
    reply.send(await editProposalService.apply(proposalId));
  });
}
