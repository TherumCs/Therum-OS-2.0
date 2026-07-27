import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taxonomyService } from '../../services/taxonomy.service.js';
import { requireBundle } from '../../middleware/bundle.js';

const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional();
const CreateCategoryInput = z.object({ name: z.string().min(1).max(80), slug: SLUG, parentId: z.string().nullable().optional() });
const UpdateCategoryInput = z.object({ name: z.string().min(1).max(80).optional(), slug: SLUG, parentId: z.string().nullable().optional() });
const CreateTagInput = z.object({ name: z.string().min(1).max(80), slug: SLUG });
const AssignInput = z.object({ categoryIds: z.array(z.string()).max(50).optional(), tagIds: z.array(z.string()).max(100).optional() });

// Catalog taxonomy admin — reads for any authenticated session, writes for
// storefront managers (same convention as products/coupons). The public
// shop reads taxonomy through the server-rendered storefront directly.
export async function taxonomyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = requireBundle('storefront-manager');

  app.get('/catalog/categories', async (_req, reply) => {
    reply.send(await taxonomyService.listCategories());
  });
  app.post('/catalog/categories', { preHandler: write }, async (req, reply) => {
    reply.status(201).send(await taxonomyService.createCategory(CreateCategoryInput.parse(req.body)));
  });
  app.patch('/catalog/categories/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await taxonomyService.updateCategory(id, UpdateCategoryInput.parse(req.body)));
  });
  app.delete('/catalog/categories/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await taxonomyService.removeCategory(id);
    reply.send({ ok: true });
  });

  app.get('/catalog/tags', async (_req, reply) => {
    reply.send(await taxonomyService.listTags());
  });
  app.post('/catalog/tags', { preHandler: write }, async (req, reply) => {
    reply.status(201).send(await taxonomyService.createTag(CreateTagInput.parse(req.body)));
  });
  app.delete('/catalog/tags/:id', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await taxonomyService.removeTag(id);
    reply.send({ ok: true });
  });

  app.put('/products/:id/taxonomy', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await taxonomyService.assign(id, AssignInput.parse(req.body)));
  });
}
