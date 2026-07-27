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

  app.post('/customers', async (req, reply) => {
    reply.status(201).send(await customerService.create(CreateCustomerInput.parse(req.body)));
  });
}
