import { randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink, rename as renameFile, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { UPLOADS_DIR } from '../lib/uploads.js';
import sharp from 'sharp';
import { processImage, type ProcessOptions } from '../lib/imagePipeline.js';
import { checkUpload } from '../lib/uploadPolicy.js';
import { replaceCanvasSrc, isCanvasNode } from '../lib/render.js';
import { autoAltFromFilename } from '../lib/seo.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { orderByOf } from '../schemas/listing.js';
import type { CreateMediaInput, ListMediaQuery, TransformMediaInput } from '../schemas/media.schema.js';

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

// Settings > Uploads > "Auto-rename on upload": a clean slug plus a short
// uniquifier, rather than the full uuid-prefixed original name.
function slugStoredFilename(originalName: string): string {
  const ext = extname(originalName).toLowerCase();
  const base = originalName
    .slice(0, originalName.length - ext.length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
  return `${base}-${randomUUID().slice(0, 8)}${ext}`;
}

function thumbFilenameFor(storedFilename: string): string {
  const ext = extname(storedFilename);
  return `${storedFilename.slice(0, -ext.length)}-thumb${ext}`;
}

// Sibling of the stored file holding the bytes as uploaded, so an in-place
// crop/rotate stays undoable.
function originalFilenameFor(storedFilename: string): string {
  const ext = extname(storedFilename);
  return `${storedFilename.slice(0, -ext.length)}-original${ext}`;
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
    // Search matches the stored filename (which is what `url` ends with) and
    // any alt text an editor has written.
    if (query.q) {
      where.OR = [
        { url: { contains: query.q, mode: 'insensitive' } },
        { alt: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      db.mediaAsset.findMany({
        where,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: orderByOf(query.sort, query.order),
      }),
      db.mediaAsset.count({ where }),
    ]);
    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).map(withAutoAlt);
    return { items, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null, total };
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
      // An edited image also has an as-uploaded backup on disk (transform()).
      const originalStored = typeof meta.originalUrl === 'string' ? urlToStoredFilename(meta.originalUrl) : null;
      if (originalStored) await unlink(join(UPLOADS_DIR, originalStored)).catch(() => {});
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
    // Settings > Uploads decides whether this file is allowed at all, and how
    // an image is processed. Enforced here rather than in the route so every
    // caller of upload() is covered by the same rules.
    const policy = await checkUpload(file.filename, file.mimetype, file.buffer.length);
    const kind = kindForMime(file.mimetype);
    let stored = policy.autoRename ? slugStoredFilename(file.filename) : safeStoredFilename(file.filename);
    const meta: Record<string, unknown> = { originalName: file.filename, mimetype: file.mimetype };
    let width: number | undefined;
    let height: number | undefined;
    let buffer = file.buffer;

    // SVG is markup, not pixels. Running it through processImage() rasterised
    // it to PNG bytes while the stored file kept its .svg name — so it was
    // then served as image/svg+xml, and `nosniff` made the browser refuse to
    // render it at all. There is nothing to resize, strip or thumbnail here:
    // the vector file IS its own thumbnail, at any size.
    const isVector = file.mimetype === 'image/svg+xml' || extname(stored).toLowerCase() === '.svg';
    if (isVector) {
      meta.thumbnailUrl = `${UPLOADS_URL_PREFIX}${stored}`;
      meta.vector = true;
    } else if (kind === 'image') {
      try {
        const processOpts: ProcessOptions = {
          resizeMaxPx: policy.resizeMaxPx,
          stripExif: policy.stripExif,
          autoWebp: policy.autoWebp,
        };
        const processed = await processImage(file.buffer, processOpts);
        // Re-encoding to WebP has to rename the file too. Leaving it as
        // <name>.png meant WebP bytes served with the wrong extension and
        // content-type — the same trap the SVG crop guard exists for.
        if (policy.autoWebp) {
          const ext = extname(stored);
          stored = `${stored.slice(0, stored.length - ext.length)}.webp`;
          meta.mimetype = 'image/webp';
        }
        buffer = processed.buffer;
        width = processed.width;
        height = processed.height;
        // Reports what actually happened, not a constant: with stripExif off
        // the pipeline calls withMetadata() and the EXIF is deliberately kept.
        meta.exifStripped = policy.stripExif;
        // Drives the tile's hover-to-play behaviour — the grid shows the
        // still thumbnail and only swaps in the moving file when pointed at.
        meta.animated = processed.animated;
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

  // Crop / rotate / flip, applied in place so every page already pointing at
  // this URL keeps working — a new URL would mean rewriting every Bricks
  // canvas that references it, and a stale reference is a broken image.
  //
  // In-place is destructive, so the FIRST edit copies the untouched file to a
  // sibling `-original` and records it in meta; revert() puts it back. Later
  // edits leave that backup alone, so "revert" always means "back to the file
  // as uploaded", not "undo one step".
  async transform(id: string, input: TransformMediaInput) {
    const asset = await this.get(id);
    if (asset.kind !== 'image') throw new ValidationError('Only images can be edited.', 'id');
    const stored = urlToStoredFilename(asset.url);
    if (!stored) throw new ValidationError('This asset is not a locally-stored file.', 'id');
    // sharp rasterises SVG input, so a crop would silently replace vector
    // artwork with a bitmap still named .svg — served with the wrong
    // content-type and no longer scalable. Refuse rather than corrupt.
    if (extname(stored).toLowerCase() === '.svg') {
      throw new ValidationError('SVGs are vector artwork — edit the source file instead of cropping it here.', 'id');
    }
    // Same reasoning: the edit path below is single-frame, so cropping an
    // animated GIF/WebP would flatten it to one frame while keeping its name.
    if ((asset.meta as Record<string, unknown> | null)?.animated === true) {
      throw new ValidationError('Animated images can’t be edited here — it would flatten them to a single frame.', 'id');
    }

    const path = join(UPLOADS_DIR, stored);
    const current = await readFile(path);

    const meta = { ...((asset.meta ?? {}) as Record<string, unknown>) };
    if (typeof meta.originalUrl !== 'string') {
      const backupStored = originalFilenameFor(stored);
      await writeFile(join(UPLOADS_DIR, backupStored), current);
      meta.originalUrl = `${UPLOADS_URL_PREFIX}${backupStored}`;
    }

    // .rotate() with no args first so a crop rect drawn on what the browser
    // displayed lines up with the pixels sharp is about to cut.
    let pipeline = sharp(current).rotate();
    if (input.crop) {
      const source = await sharp(current).rotate().metadata();
      const sw = source.width ?? 0;
      const sh = source.height ?? 0;
      if (!sw || !sh) throw new ValidationError('Could not read this image’s dimensions.', 'id');
      // Round inward and keep at least 1px so a hairline selection is still a
      // valid extract rather than a sharp error.
      const left = Math.min(Math.round(input.crop.x * sw), sw - 1);
      const top = Math.min(Math.round(input.crop.y * sh), sh - 1);
      pipeline = pipeline.extract({
        left,
        top,
        width: Math.max(1, Math.min(Math.round(input.crop.width * sw), sw - left)),
        height: Math.max(1, Math.min(Math.round(input.crop.height * sh), sh - top)),
      });
    }
    // Order matters and matches what the editor previews: crop, then rotate,
    // then flip. `flop` is the horizontal one in sharp's naming.
    if (input.rotate) pipeline = pipeline.rotate(input.rotate);
    if (input.flipX) pipeline = pipeline.flop();
    if (input.flipY) pipeline = pipeline.flip();

    const edited = await pipeline.toBuffer();
    // Back through the standard pipeline so the result gets the same max
    // dimension, EXIF strip and thumbnail treatment as an upload.
    const processed = await processImage(edited);
    await writeFile(path, processed.buffer);
    const thumbStored = thumbFilenameFor(stored);
    await writeFile(join(UPLOADS_DIR, thumbStored), processed.thumbnail);
    meta.thumbnailUrl = `${UPLOADS_URL_PREFIX}${thumbStored}`;
    meta.exifStripped = true;
    meta.editedAt = new Date().toISOString();

    return db.mediaAsset.update({
      where: { id },
      data: {
        width: processed.width,
        height: processed.height,
        size: processed.buffer.length,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  },

  // Restores the as-uploaded file kept by the first transform().
  async revert(id: string) {
    const asset = await this.get(id);
    const meta = { ...((asset.meta ?? {}) as Record<string, unknown>) };
    const backupStored = typeof meta.originalUrl === 'string' ? urlToStoredFilename(meta.originalUrl) : null;
    if (!backupStored) throw new ValidationError('This image has no saved original to restore.', 'id');
    const stored = urlToStoredFilename(asset.url);
    if (!stored) throw new ValidationError('This asset is not a locally-stored file.', 'id');

    const original = await readFile(join(UPLOADS_DIR, backupStored));
    const processed = await processImage(original);
    await writeFile(join(UPLOADS_DIR, stored), processed.buffer);
    const thumbStored = thumbFilenameFor(stored);
    await writeFile(join(UPLOADS_DIR, thumbStored), processed.thumbnail);

    // Drop the backup pointer too — the file on disk IS the original again,
    // so leaving it would offer a revert that changes nothing.
    delete meta.originalUrl;
    delete meta.editedAt;
    meta.thumbnailUrl = `${UPLOADS_URL_PREFIX}${thumbStored}`;
    await unlink(join(UPLOADS_DIR, backupStored)).catch(() => {});

    return db.mediaAsset.update({
      where: { id },
      data: {
        width: processed.width,
        height: processed.height,
        size: processed.buffer.length,
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
    // A vector file is its own thumbnail — rasterising it here would write PNG
    // bytes into a .svg and break it, the same way upload() used to.
    if (extname(stored).toLowerCase() === '.svg') {
      const meta = { ...((asset.meta ?? {}) as Record<string, unknown>), thumbnailUrl: asset.url, vector: true };
      return db.mediaAsset.update({ where: { id }, data: { meta: meta as Prisma.InputJsonValue } });
    }
    const original = await readFile(join(UPLOADS_DIR, stored));
    const { thumbnail, width, height, animated } = await processImage(original);
    const thumbStored = thumbFilenameFor(stored);
    await writeFile(join(UPLOADS_DIR, thumbStored), thumbnail);
    const meta = { ...((asset.meta ?? {}) as Record<string, unknown>), thumbnailUrl: `${UPLOADS_URL_PREFIX}${thumbStored}`, exifStripped: true, animated };
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
