import type { FastifyInstance } from 'fastify';
import { CreateCustomerInput, ListCustomersQuery } from '../../schemas/customer.schema.js';
import { customerService } from '../../services/customer.service.js';
import { requireCapability } from '../../middleware/capability.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  // Customers belong to Commerce (cart/checkout) — same gate as products/orders.
  app.addHook('preHandler', requireCapability('commerce'));

  app.get('/customers', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await customerService.list(ListCustomersQuery.parse(req.query)));
  });

  app.get('/customers/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await customerService.get(idParam(req)));
  });

  // AUTHENTICATED, like every other route here. This was open: the file-level
  // hook is only a capability gate, which decides whether the FEATURE is on,
  // never who may call it — so an unauthenticated POST created customer rows
  // (verified: 201 with no token). Shoppers do not need this route; the
  // storefront signs people up through POST /shop/account/register, which is
  // rate limited and enforces the verified-email rule this one skips.
  app.post('/customers', { preHandler: app.authenticate }, async (req, reply) => {
    reply.status(201).send(await customerService.create(CreateCustomerInput.parse(req.body)));
  });

  // There was no way to remove a customer at all. This is an ERASE: personal
  // data goes, the order history stays, because those rows are accounting.
  // See customerService.erase for why that is the only honest "delete" here.
  app.delete('/customers/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await customerService.erase(idParam(req)));
  });
}
