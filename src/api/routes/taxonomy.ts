import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taxonomyService } from '../../services/taxonomy.service.js';
import { requireBundle } from '../../middleware/bundle.js';
import { db } from '../../lib/db.js';

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

  /**
   * Who a restricted product is for: milieu groups and/or named accounts.
   *
   * Both are replaced wholesale, like taxonomy — a partial update would leave
   * the admin unable to REMOVE an audience, which is the operation that
   * actually matters for something gated.
   *
   * Accounts are addressed by EMAIL because that is what a merchant has in
   * front of them; unknown addresses are reported back rather than silently
   * dropped, or the merchant believes someone was granted access who was not.
   */
  const AudienceInput = z.object({
    milieuIds: z.array(z.string()).optional(),
    emails: z.array(z.string().email()).optional(),
  });

  app.put('/products/:id/audience', { preHandler: write }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = AudienceInput.parse(req.body);
    const product = await db.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    if (input.milieuIds) {
      await db.productAudience.deleteMany({ where: { productId: id } });
      const known = await db.milieu.findMany({ where: { id: { in: input.milieuIds } }, select: { id: true } });
      if (known.length) {
        await db.productAudience.createMany({ data: known.map((m) => ({ productId: id, milieuId: m.id })) });
      }
    }

    const missing: string[] = [];
    if (input.emails) {
      await db.productAccess.deleteMany({ where: { productId: id } });
      for (const email of input.emails) {
        const customer = await db.customer.findUnique({ where: { email }, select: { id: true } });
        if (!customer) { missing.push(email); continue; }
        await db.productAccess.create({ data: { productId: id, customerId: customer.id } });
      }
    }

    const [audiences, access] = await Promise.all([
      db.productAudience.findMany({ where: { productId: id }, select: { milieuId: true } }),
      db.productAccess.findMany({ where: { productId: id }, include: { customer: { select: { email: true } } } }),
    ]);
    reply.send({
      milieuIds: audiences.map((a) => a.milieuId),
      emails: access.map((a) => a.customer.email),
      // Named, not swallowed: the merchant must know these were not granted.
      unknownEmails: missing,
    });
  });
}
