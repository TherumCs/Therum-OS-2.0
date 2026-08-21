import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from '../schemas/customer.schema.js';

// Groups (milieu memberships) + order count travel with the customer so the
// admin Customers list can show who's in which group and how many orders they
// carry, without a second round of queries per row.
const customerInclude = {
  addresses: true,
  memberships: { select: { id: true, pendingAt: true, expiresAt: true, milieu: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { orders: true } },
} satisfies Prisma.CustomerInclude;

export const customerService = {
  async list(query: ListCustomersQuery) {
    const where: Prisma.CustomerWhereInput = {};
    if (query.q) where.OR = [
      { email: { contains: query.q, mode: 'insensitive' } },
      { name: { contains: query.q, mode: 'insensitive' } },
      { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } },
    ];
    const rows = await db.customer.findMany({
      where,
      include: customerInclude,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  },

  async get(id: string) {
    const customer = await db.customer.findUnique({ where: { id }, include: customerInclude });
    if (!customer) throw new NotFoundError('Customer not found', 'id');
    return customer;
  },

  /**
   * ERASE, not delete — the distinction matters in a shop.
   *
   * A hard delete would take the shopper's ORDERS with it (or null them out),
   * and those rows are financial records: revenue reports, tax, refunds and
   * chargebacks all read them. So this strips every piece of personal data and
   * leaves the order history standing, attached to a customer row that no
   * longer identifies anybody. That is what an erasure request actually
   * requires, and it is the only version of "delete" a store can honour.
   *
   * Addresses, identities (social logins), live sessions and pushed offers all
   * go. Email becomes a unique tombstone, because the column is unique and
   * nulling it would collide on the second erasure.
   */
  async erase(id: string) {
    const customer = await db.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new NotFoundError('Customer not found', 'id');

    return db.$transaction(async (tx) => {
      await tx.address.deleteMany({ where: { customerId: id } });
      await tx.customerIdentity.deleteMany({ where: { customerId: id } });
      await tx.customerSession.deleteMany({ where: { customerId: id } });
      await tx.customerOffer.deleteMany({ where: { customerId: id } });
      const erased = await tx.customer.update({
        where: { id },
        data: {
          email: `erased-${id}@erased.invalid`,
          name: null,
          meta: { erased: true, erasedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
        select: { id: true, email: true, createdAt: true },
      });
      return { erased: true, customer: erased };
    });
  },

  // Edit the display name / username (freely, as often as they like) and the
  // real first/last name kept for the back office. Never touches email (that's
  // the login) or groups (those go through milieuService).
  async update(id: string, input: UpdateCustomerInput) {
    await this.get(id); // throws NotFound if missing
    return db.customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      },
      include: customerInclude,
    });
  },

  async create(input: CreateCustomerInput) {
    const clash = await db.customer.findUnique({ where: { email: input.email }, select: { id: true } });
    if (clash) throw new ConflictError('A customer with this email already exists.', 'email');
    return db.customer.create({
      data: {
        email: input.email,
        name: input.name,
        meta: input.meta as Prisma.InputJsonValue,
        addresses: { create: input.addresses },
      },
      include: customerInclude,
    });
  },
};
