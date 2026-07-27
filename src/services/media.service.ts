import { randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink, rename as renameFile, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { UPLOADS_DIR } from '../lib/uploads.js';
import { processImage } from '../lib/imagePipeline.js';
import { replaceCanvasSrc, isCanvasNode } from '../lib/render.js';
import { autoAltFromFilename } from '../lib/seo.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { CreateMediaInput, ListMediaQuery } from '../schemas/media.schema.js';

const UPLOADS_URL_PREFIX = '/api/uploads/';

function kindForMime(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// Strip everything but a safe basename — no path separators, no leading dot,
// bounded length — then prefix with a random id so two uploads of the same
// filename never collide on disk. A deliberate rename (below) is what earns
// a file a clean, uuid-free name.
function safeStoredFilename(originalName: string): string {
  const base = originalName.replace(/[/\\]/g, '_').replace(/^\.+/, '').slice(-100) || 'file';
  return `${randomUUID()}-${base}`;
}

// What an explicit rename actually stores — deliberately NOT slugify().
// "Rename one.jpg to anything.jpg" means the stored file becomes exactly
// `anything.jpg`, not a forced-lowercase, hyphens-only slug. Only strips
// what would actually break the filesystem or escape the uploads dir (path
// separators, null/control bytes, a leading dot); case, spaces, and
// punctuation all pass through untouched. suggestRename()'s own suggestions
// still come out slug-shaped (a sane default), but this is what governs
// what actually lands on disk once the user edits that suggestion.
function sanitizeFilename(input: string): string {
  return input
    .replace(/[/\\\0]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
}

function thumbFilenameFor(storedFilename: string): string {
  const ext = extname(storedFilename);
  return `${storedFilename.slice(0, -ext.length)}-thumb${ext}`;
}

function urlToStoredFilename(url: string): string | null {
  return url.startsWith(UPLOADS_URL_PREFIX) ? url.slice(UPLOADS_URL_PREFIX.length) : null;
}

// Read-time fallback, not a stored mutation — matches Therum_Auto_SEO::
// auto_alt(), a wp_get_attachment_image_attributes filter that computes alt
// text whenever an image is rendered rather than writing it back. The real
// `alt` column stays null until a human (or a future upload-time default)
// actually sets it.
function withAutoAlt<T extends { alt: string | null; url: string }>(asset: T): T {
  if (asset.alt) return asset;
  const stored = urlToStoredFilename(asset.url);
  const derived = stored ? autoAltFromFilename(stored) : '';
  return derived ? { ...asset, alt: derived } : asset;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Rewrites Content.coverImage + canvas image-node `src` after a rename.
// Scoped to these two concrete places media URLs are known to live in 2.0
// today — unlike 1.9.44's WP-era sweep across post_content/postmeta/options,
// there's no evidence yet of media URLs living in Settings values, and the
// Content table is small enough right now for a plain findMany() rather than
// 1.9.44's keyset-paginated batches.
async function rewriteContentReferences(oldUrl: string, newUrl: string): Promise<number> {
  let updated = 0;
  const rows = await db.content.findMany();
  for (const row of rows) {
    const data: Prisma.ContentUpdateInput = {};
    let dirty = false;
    if (row.coverImage === oldUrl) {
      data.coverImage = newUrl;
      dirty = true;
    }
    if (row.bodyFormat === 'canvas' && isCanvasNode(row.body) && replaceCanvasSrc(row.body, oldUrl, newUrl)) {
      data.body = row.body as Prisma.InputJsonValue;
      dirty = true;
    }
    if (dirty) {
      await db.content.update({ where: { id: row.id }, data });
      updated++;
    }
  }
  return updated;
}

export const mediaService = {
  async list(query: ListMediaQuery) {
    const where: Prisma.MediaAssetWhereInput = {};
    if (query.kind) where.kind = query.kind;
    const rows = await db.mediaAsset.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map(withAutoAlt);
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
  },

  async get(id: string) {
    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError('Media asset not found', 'id');
    return withAutoAlt(asset);
  },

  async create(input: CreateMediaInput) {
    return db.mediaAsset.create({
      data: {
        url: input.url,
        alt: input.alt,
        kind: input.kind,
        width: input.width,
        height: input.height,
        size: input.size,
        meta: input.meta as Prisma.InputJsonValue,
      },
    });
  },

  async updateAlt(id: string, alt: string | null) {
    await this.get(id);
    return db.mediaAsset.update({ where: { id }, data: { alt } });
  },

  async remove(id: string) {
    const asset = await this.get(id);
    await db.mediaAsset.delete({ where: { id } });
    const stored = urlToStoredFilename(asset.url);
    if (stored) {
      await unlink(join(UPLOADS_DIR, stored)).catch(() => {});
      const meta = (asset.meta ?? {}) as Record<string, unknown>;
      const thumbStored = typeof meta.thumbnailUrl === 'string' ? urlToStoredFilename(meta.thumbnailUrl) : null;
      if (thumbStored) await unlink(join(UPLOADS_DIR, thumbStored)).catch(() => {});
    }
    return { id, deleted: true as const };
  },

  // Real local-disk upload — distinct from create() (URL-reference only).
  // Images get run through the real EXIF-strip/resize/thumbnail pipeline;
  // width/height are the actual processed dimensions, not guessed. A file
  // sharp can't parse still uploads (stored raw, unprocessed) rather than
  // failing outright — the error is recorded in meta, not swallowed silently.
  async upload(file: { filename: string; mimetype: string; buffer: Buffer }, alt?: string) {
    if (file.buffer.length === 0) throw new ValidationError('Uploaded file is empty.', 'file');
    const kind = kindForMime(file.mimetype);
    const stored = safeStoredFilename(file.filename);
    const meta: Record<string, unknown> = { originalName: file.filename, mimetype: file.mimetype };
    let width: number | undefined;
    let height: number | undefined;
    let buffer = file.buffer;

    if (kind === 'image') {
      try {
        const processed = await processImage(file.buffer);
        buffer = processed.buffer;
        width = processed.width;
        height = processed.height;
        meta.exifStripped = true;
        const thumbStored = thumbFilenameFor(stored);
        await writeFile(join(UPLOADS_DIR, thumbStored), processed.thumbnail);
        meta.thumbnailUrl = `${UPLOADS_URL_PREFIX}${thumbStored}`;
      } catch (e) {
        meta.processingError = e instanceof Error ? e.message : String(e);
      }
    }

    await writeFile(join(UPLOADS_DIR, stored), buffer);
    return db.mediaAsset.create({
      data: {
        url: `${UPLOADS_URL_PREFIX}${stored}`,
        alt: alt ?? null,
        kind,
        width,
        height,
        size: buffer.length,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  },

  // Regenerates the thumbnail from the stored original — useful after a
  // corrupted/missing thumbnail, or if the thumbnail size preference ever
  // changes.
  async regenerateThumbnail(id: string) {
    const asset = await this.get(id);
    if (asset.kind !== 'image') throw new ValidationError('Only images have thumbnails.', 'id');
    const stored = urlToStoredFilename(asset.url);
    if (!stored) throw new ValidationError('This asset is not a locally-stored file.', 'id');
    const original = await readFile(join(UPLOADS_DIR, stored));
    const { thumbnail, width, height } = await processImage(original);
    const thumbStored = thumbFilenameFor(stored);
    await writeFile(join(UPLOADS_DIR, thumbStored), thumbnail);
    const meta = { ...((asset.meta ?? {}) as Record<string, unknown>), thumbnailUrl: `${UPLOADS_URL_PREFIX}${thumbStored}`, exifStripped: true };
    return db.mediaAsset.update({ where: { id }, data: { width, height, meta: meta as Prisma.InputJsonValue } });
  },

  // Executes a batch of renames sequentially (real filesystem operations —
  // safer one at a time than racing them) and reports per-item success so a
  // handful of failures don't hide behind an otherwise-successful batch.
  async bulkRename(items: { id: string; basename: string }[]): Promise<{ results: { id: string; ok: boolean; error?: string; url?: string }[] }> {
    const results: { id: string; ok: boolean; error?: string; url?: string }[] = [];
    for (const item of items) {
      try {
        const r = await this.rename(item.id, item.basename);
        results.push({ id: item.id, ok: true, url: r.url });
      } catch (e) {
        results.push({ id: item.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results };
  },

  // The real NeoRename engine: validate (extension can't change) → plan
  // (collision-checked target name, main file + thumbnail) → execute, with
  // rollback if the thumbnail step fails after the main file already moved →
  // rewrite every known reference to the old URL.
  async rename(id: string, newBasename: string) {
    const asset = await this.get(id);
    const stored = urlToStoredFilename(asset.url);
    if (!stored) throw new ValidationError('This asset is not a locally-stored file.', 'id');

    const ext = extname(stored);
    const clean = sanitizeFilename(newBasename);
    if (!clean) throw new ValidationError('Invalid filename.', 'basename');

    let candidate = `${clean}${ext}`;
    if (candidate !== stored) {
      for (let n = 2; await fileExists(join(UPLOADS_DIR, candidate)); n++) {
        candidate = `${clean}-${n}${ext}`;
      }
    }
    if (candidate === stored) return { id, renamed: false as const, refsUpdated: 0 };

    const oldMainPath = join(UPLOADS_DIR, stored);
    const newMainPath = join(UPLOADS_DIR, candidate);
    const meta = (asset.meta ?? {}) as Record<string, unknown>;
    const oldThumbStored = typeof meta.thumbnailUrl === 'string' ? urlToStoredFilename(meta.thumbnailUrl) : null;
    const newThumbStored = oldThumbStored ? thumbFilenameFor(candidate) : null;

    await renameFile(oldMainPath, newMainPath);
    if (oldThumbStored && newThumbStored) {
      try {
        await renameFile(join(UPLOADS_DIR, oldThumbStored), join(UPLOADS_DIR, newThumbStored));
      } catch (e) {
        await renameFile(newMainPath, oldMainPath); // roll back the main rename
        throw e;
      }
    }

    const newUrl = `${UPLOADS_URL_PREFIX}${candidate}`;
    const newMeta = { ...meta, ...(newThumbStored ? { thumbnailUrl: `${UPLOADS_URL_PREFIX}${newThumbStored}` } : {}) };
    await db.mediaAsset.update({ where: { id }, data: { url: newUrl, meta: newMeta as Prisma.InputJsonValue } });

    const refsUpdated = await rewriteContentReferences(asset.url, newUrl);
    return { id, renamed: true as const, refsUpdated, url: newUrl };
  },
};
