import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { CreateCustomerInput, ListCustomersQuery } from '../schemas/customer.schema.js';

const customerInclude = { addresses: true } satisfies Prisma.CustomerInclude;

export const customerService = {
  async list(query: ListCustomersQuery) {
    const where: Prisma.CustomerWhereInput = {};
    if (query.q) where.OR = [{ email: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }];
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
