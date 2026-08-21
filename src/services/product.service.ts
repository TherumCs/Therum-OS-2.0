import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { hookBus } from '../lib/hooks.js';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors.js';
import type { CreateProductInput, UpdateProductInput, ListProductsQuery, VariantInput, UpdateVariantInput } from '../schemas/product.schema.js';
import { orderByOf } from '../schemas/listing.js';
import { categoryAndDescendantIds } from '../counter/categoryTree.js';
import { slugify } from '../lib/slug.js';
import { lifecycleService } from './lifecycle.service.js';

const productInclude = {
  variants: true,
  vendor: { select: { id: true, name: true, platform: true } },
  categories: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  audiences: { select: { milieuId: true } },
  access: { include: { customer: { select: { email: true } } } },
} satisfies Prisma.ProductInclude;

// Public projection for the UNAUTHENTICATED storefront (search / wishlist /
// account picks). Everything a shopper renders, and NOTHING sensitive: no
// variant `cost` (margins), no `sourceVendorId`/`sourceId`/vendor.platform
// (supplier), no `access` (grantee-email PII), no `audiences`. Callers MUST
// pair this with a visibility=public + status=active gate — see list()/get().
const publicProductInclude = {
  variants: { select: { id: true, productId: true, sku: true, price: true, color: true, size: true, image: true, images: true, colorCodes: true, stockStatus: true, inventory: true, reserved: true } },
  vendor: { select: { id: true, name: true } },
  categories: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductInclude;

export const productService = {
  async list(query: ListProductsQuery, opts?: { public?: boolean }) {
    const where: Prisma.ProductWhereInput = {};
    // The trash is a separate view. Anything in it is invisible to every
    // normal listing — leaving trashed rows in the default list is how a
    // "deleted" product keeps turning up in the admin and on the storefront.
    where.deletedAt = query.trashed ? { not: null } : null;
    if (opts?.public) {
      // Anonymous callers only ever see live, public products — never draft,
      // private, or restricted (which is how the raw API was leaking the
      // restricted crewneck and its grantee's email).
      where.visibility = 'public';
      where.status = 'active';
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.vendorId) where.vendorId = query.vendorId;
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    // Descendants included, matching the storefront. A category manager that
    // reports "0 products" for Mens while its children hold twenty is worse
    // than no count at all.
    if (query.categoryId) {
      const ids = await categoryAndDescendantIds(query.categoryId);
      where.categories = { some: { id: { in: ids } } };
    }
    if (query.tagId) where.tags = { some: { id: query.tagId } };

    // Two paging modes: numbered-page OFFSET for the admin catalog (jump to any
    // page), and forward CURSOR for everything else (stable under inserts).
    const paging = query.page != null
      ? { skip: (query.page - 1) * query.limit, take: query.limit }
      : { take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) };
    const [rows, total] = await Promise.all([
      db.product.findMany({ where, include: opts?.public ? publicProductInclude : productInclude, ...paging, orderBy: orderByOf(query.sort, query.order) }),
      db.product.count({ where }),
    ]);

    // Offset mode returns exactly the page; the caller derives page count from total.
    if (query.page != null) return { items: rows, nextCursor: null, total };
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    return { items, nextCursor, total };
  },

  async get(id: string, opts?: { public?: boolean }) {
    const product = await db.product.findUnique({ where: { id }, include: opts?.public ? publicProductInclude : productInclude });
    if (!product) throw new NotFoundError('Product not found', 'id');
    // A restricted/private/draft product must not be revealed to an anonymous
    // caller — same 404 as a nonexistent id, no hint that it exists.
    if (opts?.public && (product.visibility !== 'public' || product.status !== 'active')) {
      throw new NotFoundError('Product not found', 'id');
    }
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
    const updated = await db.productVariant.update({ where: { id: variantId }, data: input });
    // Back-in-stock: if this edit flipped the variant from unavailable to
    // available, alert its subscribers. Best-effort — never blocks the edit.
    const avail = (x: { stockStatus: string; inventory: number }): boolean =>
      x.stockStatus === 'in_stock' || x.stockStatus === 'backorder' || (x.stockStatus === 'tracked' && x.inventory > 0);
    if (!avail(v) && avail(updated)) void lifecycleService.notifyBackInStock(variantId).catch(() => {});
    return updated;
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
        // Validated by the schema but never written — the API answered 200 and
        // dropped it, so the admin's Visibility control appeared to save and a
        // restricted product stayed public. Every field in this object has to
        // be listed by hand, which is exactly how one goes missing.
        visibility: input.visibility,
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
    const product = await db.product.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        image: input.image,
        ...(input.images !== undefined ? { images: input.images as Prisma.InputJsonValue } : {}),
        status: input.status,
        // Validated by the schema but never written here — the API answered
        // 200 and dropped it, so Visibility appeared to save and a restricted
        // product stayed public. Every field is listed by hand in this object,
        // which is exactly how one goes missing.
        visibility: input.visibility,
        vendorId: input.vendorId,
        sourceId: input.sourceId,
        ...(input.meta !== undefined ? { meta: input.meta as Prisma.InputJsonValue } : {}),
      },
      include: productInclude,
    });
    // Mirror create()'s onProductCreate — extensions subscribing to
    // onProductUpdate (re-index, cache-bust, webhook) never fired without this.
    await hookBus.run('onProductUpdate', product);
    return product;
  },

  /**
   * To the trash, not gone.
   *
   * `remove` used to delete the row outright, taking its variants, images,
   * category assignments and order-line references with it. There was no undo
   * and no warning — one misclick and a product with sales history was gone.
   */
  async remove(id: string) {
    await this.get(id);
    await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, trashed: true as const };
  },

  async restore(id: string) {
    const found = await db.product.findUnique({ where: { id } });
    if (!found) throw new NotFoundError('Product not found', 'id');
    // Status is untouched, so it returns as whatever it was — the whole reason
    // the trash is a timestamp rather than a status value.
    await db.product.update({ where: { id }, data: { deletedAt: null } });
    return { id, restored: true as const };
  },

  /**
   * Permanent. Only reachable for something already in the trash, so a stray
   * DELETE cannot destroy a live product in one step.
   */
  async purge(id: string) {
    const found = await db.product.findUnique({ where: { id } });
    if (!found) throw new NotFoundError('Product not found', 'id');
    if (!found.deletedAt) {
      throw new ValidationError('Move it to the trash first — this deletes it permanently.', 'id');
    }
    await db.product.delete({ where: { id } });
    return { id, deleted: true as const };
  },

  /**
   * Vendor drafts don't belong on the storefront. A vendor (Printful/Printify/
   * Tapstitch/…) creates a product as a draft then publishes it seconds later;
   * a FAILED publish leaves that draft stuck on our site forever. This removes
   * vendor-origin drafts — `sourceId` set means it came from a vendor platform —
   * that have sat unchanged past the grace window, so a normal create→publish
   * (seconds apart) is never caught but a stuck one is. Manual drafts (no
   * `sourceId` — made in the admin) are left untouched: those are the only
   * drafts allowed to live on the site.
   *
   * Hard delete on purpose. A later vendor publish re-creates the product fresh
   * and active; a soft delete (deletedAt) would be re-hidden by the sync update
   * path and keep the product invisible forever. Single deletes in a loop so the
   * onDelete: Cascade on variants fires per row, exactly as `purge` above.
   */
  async purgeStaleVendorDrafts(graceMinutes = 15) {
    const cutoff = new Date(Date.now() - graceMinutes * 60_000);
    const stale = await db.product.findMany({
      where: { status: 'draft', deletedAt: null, sourceId: { not: null }, updatedAt: { lt: cutoff } },
      select: { id: true, name: true },
    });
    for (const p of stale) await db.product.delete({ where: { id: p.id } });
    return { deleted: stale.length, names: stale.map((p) => p.name) };
  },

  /**
   * Copy a product, variants and all.
   *
   * The copy is a DRAFT with a fresh slug. Duplicating straight to `active`
   * would put an unfinished product in front of shoppers the moment the button
   * is clicked, and the slug is unique so it cannot be copied verbatim.
   *
   * `sourceId` is deliberately NOT copied: it is the id at Printful/Printify,
   * and two local products claiming the same remote one makes the next sync
   * overwrite whichever it reaches second.
   */
  async duplicate(id: string) {
    const src = await db.product.findUnique({
      where: { id },
      include: { variants: true, categories: { select: { id: true } }, tags: { select: { id: true } } },
    });
    if (!src) throw new NotFoundError('Product not found', 'id');

    return db.product.create({
      data: {
        name: `${src.name} (copy)`,
        slug: `${src.slug}-copy-${Date.now().toString(36)}`,
        description: src.description,
        status: 'draft',
        visibility: src.visibility,
        image: src.image,
        images: src.images as Prisma.InputJsonValue,
        meta: src.meta as Prisma.InputJsonValue,
        categories: { connect: src.categories.map((c) => ({ id: c.id })) },
        tags: { connect: src.tags.map((t) => ({ id: t.id })) },
        variants: {
          create: src.variants.map((v) => ({
            // SKU is left blank rather than copied: two variants sharing a SKU
            // breaks every fulfilment match, which is silent until an order.
            sku: null,
            price: v.price,
            color: v.color,
            size: v.size,
            image: v.image,
            images: v.images as Prisma.InputJsonValue,
            inventory: v.inventory,
            stockStatus: v.stockStatus,
          })),
        },
      },
      include: productInclude,
    });
  },
};
