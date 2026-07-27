import { Prisma, type ContentStatus } from '@prisma/client';
import { db } from '../lib/db.js';
import { hookBus } from '../lib/hooks.js';
import { renderCanvas, isCanvasNode } from '../lib/render.js';
import { slugify } from '../lib/slug.js';
import { resolveSeo, buildMetaTags, buildJsonLd } from '../lib/seo.js';
import { settingsService } from './settings.service.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type { CreateContentInput, UpdateContentInput, ListContentQuery } from '../schemas/content.schema.js';

const asJson = (v: unknown): Prisma.InputJsonValue => (v ?? {}) as Prisma.InputJsonValue;

export const contentService = {
  async list(query: ListContentQuery) {
    const where: Prisma.ContentWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    const rows = await db.content.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { updatedAt: 'desc' },
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  },

  async get(id: string) {
    const item = await db.content.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('Content not found', 'id');
    return item;
  },

  // Public render lookup — only returns published content.
  async getBySlug(slug: string) {
    const item = await db.content.findUnique({ where: { slug } });
    if (!item || item.status !== 'published') throw new NotFoundError('Content not found', 'slug');
    return item;
  },

  async create(input: CreateContentInput) {
    const slug = input.slug ?? slugify(input.title);
    const clash = await db.content.findUnique({ where: { slug }, select: { id: true } });
    if (clash) throw new ConflictError('Content with this slug already exists.', 'slug');

    const status: ContentStatus = input.status;
    const item = await db.content.create({
      data: {
        type: input.type,
        title: input.title,
        slug,
        status,
        excerpt: input.excerpt,
        coverImage: input.coverImage,
        body: asJson(input.body),
        bodyFormat: input.bodyFormat,
        seo: asJson(input.seo),
        meta: asJson(input.meta),
        publishedAt: status === 'published' ? new Date() : null,
      },
    });
    await hookBus.run('onContentCreate', item);
    if (status === 'published') await hookBus.run('onContentPublish', item);
    return item;
  },

  async update(id: string, input: UpdateContentInput) {
    const current = await this.get(id);
    const goingLive = input.status === 'published' && current.status !== 'published';
    const item = await db.content.update({
      where: { id },
      data: {
        type: input.type,
        title: input.title,
        slug: input.slug,
        status: input.status,
        excerpt: input.excerpt,
        coverImage: input.coverImage,
        ...(input.body !== undefined ? { body: asJson(input.body) } : {}),
        bodyFormat: input.bodyFormat,
        ...(input.seo !== undefined ? { seo: asJson(input.seo) } : {}),
        ...(input.meta !== undefined ? { meta: asJson(input.meta) } : {}),
        ...(goingLive ? { publishedAt: new Date() } : {}),
      },
    });
    if (goingLive) await hookBus.run('onContentPublish', item);
    return item;
  },

  async setStatus(id: string, status: ContentStatus) {
    const current = await this.get(id);
    const goingLive = status === 'published' && current.status !== 'published';
    const item = await db.content.update({
      where: { id },
      data: { status, ...(goingLive ? { publishedAt: new Date() } : {}) },
    });
    if (goingLive) await hookBus.run('onContentPublish', item);
    return item;
  },

  async remove(id: string) {
    await this.get(id);
    await db.content.delete({ where: { id } });
    return { id, deleted: true as const };
  },

  // Copies title/type/body/excerpt/seo/meta into a new draft. Title gets
  // " (Copy)"; slug is deduped by suffix rather than left to the create()
  // slug-clash check, since we want a guaranteed-fresh row, not a 409.
  async duplicate(id: string) {
    const src = await this.get(id);
    const baseTitle = `${src.title} (Copy)`;
    const baseSlug = slugify(baseTitle) || `${src.slug}-copy`;
    let slug = baseSlug;
    for (let n = 2; await db.content.findUnique({ where: { slug }, select: { id: true } }); n++) {
      slug = `${baseSlug}-${n}`;
    }
    const item = await db.content.create({
      data: {
        type: src.type,
        title: baseTitle,
        slug,
        status: 'draft',
        excerpt: src.excerpt,
        coverImage: src.coverImage,
        body: asJson(src.body),
        bodyFormat: src.bodyFormat,
        seo: asJson(src.seo),
        meta: asJson(src.meta),
        publishedAt: null,
      },
    });
    await hookBus.run('onContentCreate', item);
    return item;
  },

  // Shared by the public (published-only) and admin (any-status) render
  // paths below — the only real difference between them is which lookup
  // gates on `status === 'published'`.
  _toHtml(item: { bodyFormat: string; body: unknown }): string {
    if (item.bodyFormat === 'canvas' && isCanvasNode(item.body)) return renderCanvas(item.body);
    if (typeof item.body === 'string') return item.body; // html, or markdown left raw until a md renderer is added
    return '';
  },

  // Auto-derivation + tag/JSON-LD assembly, shared by both render paths below
  // (src/lib/seo.ts's resolveSeo/buildMetaTags/buildJsonLd, matching
  // therum-seo.php's fallback chains exactly).
  async _resolveSeoFor(item: Parameters<typeof resolveSeo>[0], origin: string, url: string) {
    const [defaults, appearance] = await Promise.all([settingsService.getSeoDefaults(), settingsService.getAppearance()]);
    const resolved = resolveSeo(item, url, defaults, appearance.thumbnailSource === 'auto');
    const metaTags = buildMetaTags(resolved, url, defaults.siteName, { publishedAt: item.publishedAt, updatedAt: item.updatedAt });
    const jsonLd = buildJsonLd(item, resolved, url, origin, defaults.siteName);
    return { resolvedSeo: resolved, metaTags, jsonLd };
  },

  // Publish-time render: turns a canvas-tree body into HTML (the builder→Folio
  // loop). Public, published-only.
  async renderBySlug(slug: string, origin = '') {
    const item = await this.getBySlug(slug);
    const url = `${origin}/${item.slug}`;
    const { resolvedSeo, metaTags, jsonLd } = await this._resolveSeoFor(item, origin, url);
    return { title: item.title, slug: item.slug, html: this._toHtml(item), seo: item.seo, resolvedSeo, metaTags, jsonLd, type: item.type, status: item.status, publishedAt: item.publishedAt };
  },

  // Admin preview: same render, any status — lets an editor see a draft
  // before publishing it. Auth-gated at the route, not here.
  async renderById(id: string, origin = '') {
    const item = await this.get(id);
    const url = `${origin}/${item.slug}`;
    const { resolvedSeo, metaTags, jsonLd } = await this._resolveSeoFor(item, origin, url);
    return { title: item.title, slug: item.slug, html: this._toHtml(item), seo: item.seo, resolvedSeo, metaTags, jsonLd, type: item.type, status: item.status, publishedAt: item.publishedAt };
  },
};
