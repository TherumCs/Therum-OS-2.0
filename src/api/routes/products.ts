import type { FastifyInstance } from 'fastify';
import { CreateProductInput, UpdateProductInput, ListProductsQuery, VariantInput, UpdateVariantInput } from '../../schemas/product.schema.js';
import { productService } from '../../services/product.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

// Every route parses input before touching the DB; every mutation returns the
// entity. Extensions hook into the service, not these routes.
export async function productRoutes(app: FastifyInstance): Promise<void> {
  // Plugin-scoped hook — applies to every route below, public or authenticated.
  // Disabling "commerce" in Studio takes the whole capability offline, not just its admin UI.
  app.addHook('preHandler', requireCapability('commerce'));

  app.get('/products', async (req, reply) => {
    const query = ListProductsQuery.parse(req.query);
    reply.send(await productService.list(query));
  });

  app.get('/products/:id', async (req, reply) => {
    reply.send(await productService.get(idParam(req)));
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

  app.delete('/products/:id', { preHandler: [app.authenticate, requireBundle('storefront-manager')] }, async (req, reply) => {
    reply.send(await productService.remove(idParam(req)));
  });
}
