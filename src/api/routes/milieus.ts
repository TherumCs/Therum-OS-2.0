import type { FastifyInstance } from 'fastify';
import { milieuService } from '../../services/milieu.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';
import {
  AddMemberInput,
  BulkMembersInput,
  CreateMilieuInput,
  ExtendMemberInput,
  ListMembersQuery,
  PublicRegisterInput,
  UpdateMilieuInput,
} from '../../schemas/milieu.schema.js';

// Public signup endpoint (M4) — deliberately UNauthenticated (it's the whole
// point of a registration link), but still capability-gated: memberships off
// = link surface off. Registered as its own plugin so the admin routes'
// authenticate hook doesn't apply here.
export async function publicMilieuRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('memberships'));

  app.post('/public/register/:regSlug', async (req, reply) => {
    const { regSlug } = req.params as { regSlug: string };
    const input = PublicRegisterInput.parse(req.body);
    reply.status(201).send(await milieuService.register(regSlug, input, req.ip));
  });
}

export async function milieuRoutes(app: FastifyInstance): Promise<void> {
  // Whole surface gated on the memberships capability + admin auth. Reads
  // stay open to any authenticated session (codebase convention — see
  // bundle.ts's own comment); every MUTATION additionally requires the
  // storefront-manager bundle (customer-group management is storefront
  // work, same bundle as products/orders/customers — audit finding #3).
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireCapability('memberships'));
  const write = requireBundle('storefront-manager');

  app.get('/milieus', async (_req, reply) => {
    reply.send(await milieuService.list());
  });

  app.post('/milieus', { preHandler: write }, async (req, reply) => {
    const input = CreateMilieuInput.parse(req.body);
    reply.status(201).send(await milieuService.create(input));
  });

  app.get('/milieus/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await milieuService.get(id));
  });

  app.patch('/milieus/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = UpdateMilieuInput.parse(req.body);
    reply.send(await milieuService.update(id, input));
  });

  app.delete('/milieus/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await milieuService.remove(id);
    reply.send({ ok: true });
  });

  app.get('/milieus/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = ListMembersQuery.parse(req.query);
    reply.send(await milieuService.listMembers(id, q.page, q.search));
  });

  app.get('/milieus/:id/candidates', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { q } = req.query as { q?: string };
    reply.send(await milieuService.searchCandidates(id, q ?? ''));
  });

  app.post('/milieus/:id/members', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = AddMemberInput.parse(req.body);
    reply.status(201).send(await milieuService.assign(id, input));
  });

  app.delete('/milieus/:id/members/:customerId', { preHandler: write }, async (req, reply) => {
    const { id, customerId } = req.params as { id: string; customerId: string };
    await milieuService.revoke(id, customerId);
    reply.send({ ok: true });
  });

  app.post('/milieus/:id/members/:customerId/extend', { preHandler: write }, async (req, reply) => {
    const { id, customerId } = req.params as { id: string; customerId: string };
    const input = ExtendMemberInput.parse(req.body);
    const expiresAt = await milieuService.extend(id, customerId, input.seconds);
    reply.send({ expiresAt }); // null = membership is permanent, nothing to extend (1.x rule)
  });

  app.post('/milieus/:id/members/:customerId/approve', { preHandler: write }, async (req, reply) => {
    const { id, customerId } = req.params as { id: string; customerId: string };
    reply.send(await milieuService.approve(id, customerId));
  });

  app.post('/milieus/:id/members/bulk', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = BulkMembersInput.parse(req.body);
    reply.send({ count: await milieuService.bulk(id, input) });
  });

  app.post('/milieus/sweep', { preHandler: write }, async (_req, reply) => {
    reply.send(await milieuService.runSweep());
  });
}
