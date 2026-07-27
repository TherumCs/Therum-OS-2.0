import { db } from '../lib/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';

// Catalog taxonomy (Woo parity): hierarchical product categories + flat
// tags. Slugs are the public identity (shop filter URLs); names are labels.

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

export const taxonomyService = {
  // ── categories ──
  async listCategories() {
    return db.productCategory.findMany({
      include: { _count: { select: { products: true } }, children: { select: { id: true, name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });
  },

  async createCategory(input: { name: string; slug?: string; parentId?: string | null }) {
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw new ValidationError('Category needs a usable slug', 'name');
    const clash = await db.productCategory.findUnique({ where: { slug }, select: { id: true } });
    if (clash) throw new ConflictError('A category with this slug already exists', 'slug');
    if (input.parentId) {
      const parent = await db.productCategory.findUnique({ where: { id: input.parentId }, select: { id: true } });
      if (!parent) throw new NotFoundError('Parent category not found', 'parentId');
    }
    return db.productCategory.create({ data: { name: input.name, slug, parentId: input.parentId ?? null } });
  },

  async updateCategory(id: string, input: { name?: string; slug?: string; parentId?: string | null }) {
    const current = await db.productCategory.findUnique({ where: { id } });
    if (!current) throw new NotFoundError('Category not found', 'id');
    if (input.parentId) {
      if (input.parentId === id) throw new ValidationError('A category cannot be its own parent', 'parentId');
      // Reject cycles: walk up from the proposed parent.
      let cursor: string | null = input.parentId;
      while (cursor) {
        if (cursor === id) throw new ValidationError('That parent would create a category cycle', 'parentId');
        const row: { parentId: string | null } | null = await db.productCategory.findUnique({ where: { id: cursor }, select: { parentId: true } });
        cursor = row?.parentId ?? null;
      }
    }
    if (input.slug && input.slug !== current.slug) {
      const clash = await db.productCategory.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (clash) throw new ConflictError('A category with this slug already exists', 'slug');
    }
    return db.productCategory.update({ where: { id }, data: input });
  },

  async removeCategory(id: string): Promise<void> {
    const c = await db.productCategory.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundError('Category not found', 'id');
    await db.productCategory.delete({ where: { id } }); // children re-root via SetNull; product links drop
  },

  // ── tags ──
  async listTags() {
    return db.productTag.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
  },

  async createTag(input: { name: string; slug?: string }) {
    const slug = input.slug ?? slugify(input.name);
    if (!slug) throw new ValidationError('Tag needs a usable slug', 'name');
    const clash = await db.productTag.findUnique({ where: { slug }, select: { id: true } });
    if (clash) throw new ConflictError('A tag with this slug already exists', 'slug');
    return db.productTag.create({ data: { name: input.name, slug } });
  },

  async removeTag(id: string): Promise<void> {
    const t = await db.productTag.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundError('Tag not found', 'id');
    await db.productTag.delete({ where: { id } });
  },

  // ── product assignment ──
  async assign(productId: string, input: { categoryIds?: string[]; tagIds?: string[] }) {
    const p = await db.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!p) throw new NotFoundError('Product not found', 'id');
    return db.product.update({
      where: { id: productId },
      data: {
        ...(input.categoryIds ? { categories: { set: input.categoryIds.map((id) => ({ id })) } } : {}),
        ...(input.tagIds ? { tags: { set: input.tagIds.map((id) => ({ id })) } } : {}),
      },
      include: { categories: true, tags: true },
    });
  },
};
