import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CreateProductInput, UpdateProductInput, ListProductsQuery, VariantInput, UpdateVariantInput } from '../../schemas/product.schema.js';
import { productService } from '../../services/product.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

// One selection, one action. Every mutation the row menu offers, applied to a
// set — publish/unpublish/archive (status), trash, restore, delete-forever,
// and category/tag assignment. Capped so a runaway request can't sweep the
// whole catalogue in one call.
const BulkProductInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(['status', 'trash', 'restore', 'purge', 'assign']),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  categoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
});

// Soft auth: is this a signed-in staff request (JWT session)? Unlike
// app.authenticate it never throws — an anonymous storefront call falls through
// to the public projection. This is what lets GET /products stay open to the
// storefront (search / wishlist / account picks) while never leaking variant
// cost, supplier ids, grantee-email PII, or restricted/private products to the
// public: only a real admin JWT gets the full record.
async function isStaff(req: FastifyRequest): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    await req.jwtVerify();
    const role = (req.user as { role?: string } | undefined)?.role;
    return role === 'admin' || role === 'custom';
  } catch {
    return false;
  }
}

// Every route parses input before touching the DB; every mutation returns the
// entity. Extensions hook into the service, not these routes.
export async function productRoutes(app: FastifyInstance): Promise<void> {
  // Plugin-scoped hook — applies to every route below, public or authenticated.
  // Disabling "commerce" in Studio takes the whole capability offline, not just its admin UI.
  app.addHook('preHandler', requireCapability('commerce'));

  app.get('/products', async (req, reply) => {
    const query = ListProductsQuery.parse(req.query);
    reply.send(await productService.list(query, (await isStaff(req)) ? undefined : { public: true }));
  });

  app.get('/products/:id', async (req, reply) => {
    reply.send(await productService.get(idParam(req), (await isStaff(req)) ? undefined : { public: true }));
  });

  app.post('/products', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const input = CreateProductInput.parse(req.body);
    reply.status(201).send(await productService.create(input));
  });

  app.patch('/products/:id', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const input = UpdateProductInput.parse(req.body);
    reply.send(await productService.update(idParam(req), input));
  });

  // Variant CRUD (product editor).
  app.post('/products/:id/variants', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.status(201).send(await productService.addVariant(id, VariantInput.parse(req.body)));
  });
  app.patch('/products/:id/variants/:variantId', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const { id, variantId } = req.params as { id: string; variantId: string };
    reply.send(await productService.updateVariant(id, variantId, UpdateVariantInput.parse(req.body)));
  });
  app.delete('/products/:id/variants/:variantId', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    const { id, variantId } = req.params as { id: string; variantId: string };
    await productService.removeVariant(id, variantId);
    reply.send({ ok: true });
  });

  const manage = { preHandler: [app.authenticate, requireBundle('storefront-manager')] };

  // DELETE /products/:id is the TRASH (see product.service.remove). These are
  // the other two thirds of the lifecycle.
  // Trash. A POST alias for the DELETE below, because the admin's Server
  // Actions issue plain POSTs — a form cannot send DELETE without JS, and the
  // trash button must work whether or not the bundle has hydrated.
  app.post('/products/:id/trash', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await productService.remove(id));
  });

  app.post('/products/:id/restore', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await productService.restore(id));
  });

  // Permanent, and only for something already trashed — the service refuses
  // otherwise, so a stray call cannot destroy a live product in one step.
  app.post('/products/:id/purge', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await productService.purge(id));
  });

  app.post('/products/:id/duplicate', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.status(201).send(await productService.duplicate(id));
  });

  app.delete('/products/:id', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await productService.remove(idParam(req)));
  });

  // BULK. The same lifecycle actions as the single-row menu, applied to a
  // selection. Each id runs through the SAME service method a one-off would,
  // so cache invalidation, trash rules ("purge only what's already trashed")
  // and status validation are identical — a bulk op can't do anything a single
  // op can't. Failures are collected per-id rather than aborting the batch, so
  // one bad row (already deleted upstream, say) doesn't strand the other 40.
  app.post('/products/bulk', manage, async (req, reply) => {
    const input = BulkProductInput.parse(req.body);
    const { taxonomyService } = await import('../../services/taxonomy.service.js');
    let ok = 0;
    const failed: { id: string; error: string }[] = [];
    for (const id of input.ids) {
      try {
        if (input.action === 'status') {
          if (!input.status) throw new Error('status is required for the status action');
          await productService.update(id, { status: input.status });
        } else if (input.action === 'trash') {
          await productService.remove(id);
        } else if (input.action === 'restore') {
          await productService.restore(id);
        } else if (input.action === 'purge') {
          await productService.purge(id);
        } else if (input.action === 'assign') {
          await taxonomyService.assign(id, { categoryIds: input.categoryIds, tagIds: input.tagIds });
        }
        ok += 1;
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    reply.send({ ok, failed, total: input.ids.length });
  });
}
