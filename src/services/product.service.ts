import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { hookBus } from '../lib/hooks.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { CreateProductInput, UpdateProductInput, ListProductsQuery, VariantInput, UpdateVariantInput } from '../schemas/product.schema.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 240);
}

const productInclude = {
  variants: true,
  vendor: { select: { id: true, name: true, platform: true } },
  categories: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

export const productService = {
  async list(query: ListProductsQuery) {
    const where: Prisma.ProductWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    // Cursor pagination (not offset) — stable under inserts.
    const rows = await db.product.findMany({
      where,
      include: productInclude,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor };
  },

  async get(id: string) {
    const product = await db.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new NotFoundError('Product not found', 'id');
    return product;
  },

  // ── Variant CRUD (product editor) ──
  async addVariant(productId: string, input: VariantInput) {
    await this.get(productId);
    const { meta, ...rest } = input;
    return db.productVariant.create({ data: { ...rest, ...(meta !== undefined ? { meta: meta as Prisma.InputJsonValue } : {}), productId } });
  },

  async updateVariant(productId: string, variantId: string, input: UpdateVariantInput) {
    const v = await db.productVariant.findFirst({ where: { id: variantId, productId } });
    if (!v) throw new NotFoundError('Variant not found', 'variantId');
    return db.productVariant.update({ where: { id: variantId }, data: input });
  },

  async removeVariant(productId: string, variantId: string): Promise<void> {
    const v = await db.productVariant.findFirst({ where: { id: variantId, productId }, include: { _count: { select: { orderItems: true } } } });
    if (!v) throw new NotFoundError('Variant not found', 'variantId');
    // A variant referenced by orders is history, not deletable — the FK
    // would block it anyway; surface a clean message instead.
    if (v._count.orderItems > 0) throw new ConflictError('This variant has orders — it cannot be deleted.', 'variantId');
    await db.productVariant.delete({ where: { id: variantId } });
  },

  async create(input: CreateProductInput) {
    const slug = input.slug ?? slugify(input.name);
    const clash = await db.product.findUnique({ where: { slug }, select: { id: true } });
    if (clash) throw new ConflictError('A product with this slug already exists.', 'slug');

    const product = await db.product.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        image: input.image,
        status: input.status,
        vendorId: input.vendorId,
        sourceId: input.sourceId,
        meta: input.meta as Prisma.InputJsonValue,
        variants: {
          create: input.variants.map((v) => ({
            sku: v.sku,
            price: v.price,
            cost: v.cost,
            color: v.color,
            size: v.size,
            sourceVendorId: v.sourceVendorId,
            sourceId: v.sourceId,
            inventory: v.inventory,
            meta: v.meta as Prisma.InputJsonValue,
          })),
        },
      },
      include: productInclude,
    });
    await hookBus.run('onProductCreate', product);
    return product;
  },

  async update(id: string, input: UpdateProductInput) {
    await this.get(id); // throws NotFound if missing
    return db.product.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        image: input.image,
        ...(input.images !== undefined ? { images: input.images as Prisma.InputJsonValue } : {}),
        status: input.status,
        vendorId: input.vendorId,
        sourceId: input.sourceId,
        ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
      },
      include: productInclude,
    });
  },

  async remove(id: string) {
    await this.get(id);
    await db.product.delete({ where: { id } });
    return { id, deleted: true as const };
  },
};
