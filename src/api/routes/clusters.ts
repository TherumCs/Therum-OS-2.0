import type { FastifyInstance } from 'fastify';
import { clusterService } from '../../services/cluster.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';
import { CreateClusterInput, SetPrimaryInput, UpdateClusterInput } from '../../schemas/cluster.schema.js';

export async function clusterRoutes(app: FastifyInstance): Promise<void> {
  // Reads open to any authenticated session; every mutation requires the
  // storefront-manager bundle (same convention as products/orders/milieus).
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', requireCapability('merged-products'));
  const write = requireBundle('storefront-manager');

  app.get('/clusters', async (_req, reply) => {
    reply.send(await clusterService.list());
  });

  app.get('/clusters/candidates', async (req, reply) => {
    const { q } = req.query as { q?: string };
    reply.send(await clusterService.candidates(q ?? ''));
  });

  app.post('/clusters', { preHandler: write }, async (req, reply) => {
    const input = CreateClusterInput.parse(req.body);
    reply.status(201).send(await clusterService.create(input));
  });

  app.get('/clusters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await clusterService.get(id));
  });

  app.patch('/clusters/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = UpdateClusterInput.parse(req.body);
    reply.send(await clusterService.update(id, input));
  });

  app.delete('/clusters/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await clusterService.remove(id);
    reply.send({ ok: true });
  });

  app.post('/clusters/:id/primary', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = SetPrimaryInput.parse(req.body);
    reply.send(await clusterService.setPrimary(id, input.productId));
  });

  app.get('/clusters/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await clusterService.resolveMerged(id));
  });

  app.get('/clusters/:id/drift', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await clusterService.detectDrift(id));
  });
}
