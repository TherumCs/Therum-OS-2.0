import sharp from 'sharp';

// The gap media.service.ts's own comment already flagged ("no image-processing
// dependency yet") — and the exact thing 1.9.44's own upload UI advertised
// ("Auto-renames + EXIF strip honored from settings") but never actually
// implemented anywhere in its source (confirmed during the inventory read).
// sharp drops EXIF/ICC/XMP by default on re-encode (no .withMetadata() call
// below), so processing an image through this at all *is* the strip.

const MAX_DIMENSION = 2560;
const THUMB_WIDTH = 480;

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  thumbnail: Buffer;
  /** True when the source has more than one frame (GIF, animated WebP). */
  animated: boolean;
}

export interface ProcessOptions {
  /** Longest-edge bound; 0 means "do not resize". Settings > Uploads. */
  resizeMaxPx?: number;
  /** false keeps EXIF/ICC — sharp drops it by default on re-encode. */
  stripExif?: boolean;
  /** Re-encode to WebP. */
  autoWebp?: boolean;
}

export async function processImage(input: Buffer, opts: ProcessOptions = {}): Promise<ProcessedImage> {
  // Animated formats have to be opened with `animated: true` or sharp reads
  // only the first page and re-encodes a single still — which is exactly what
  // happened to every GIF uploaded before this: they went in animated and came
  // out as one frame, silently. Detected off the input's own page count rather
  // than the extension, so an animated WebP is handled the same way.
  const probe = await sharp(input).metadata();
  const animated = (probe.pages ?? 1) > 1;

  // .rotate() with no args reads the EXIF orientation tag and bakes it into
  // the pixel data before the metadata (including that same tag) is dropped.
  // Skipped for animated input: there is no EXIF orientation on a GIF, and
  // rotate() on a multi-page image operates on the stacked filmstrip.
  const opened = sharp(input, animated ? { animated: true } : {});
  const base = animated ? opened : opened.rotate();
  const meta = await base.metadata();

  // For an animated image `meta.height` is the height of the whole stacked
  // filmstrip, so the per-frame height (pageHeight) is what to measure.
  const height = animated ? meta.pageHeight ?? meta.height ?? 0 : meta.height ?? 0;
  const bound = opts.resizeMaxPx ?? MAX_DIMENSION;
  const oversized = bound > 0 && ((meta.width ?? 0) > bound || (meta.height ?? 0) > bound);
  const main = oversized
    ? base.clone().resize({ width: bound, height: bound, fit: 'inside', withoutEnlargement: true })
    : base.clone();
  // withMetadata() puts EXIF/ICC back; without it sharp has already dropped
  // them, which is what makes "strip EXIF" the default rather than a step.
  const kept = opts.stripExif === false ? main.withMetadata() : main;
  const buffer = await (opts.autoWebp ? kept.webp() : kept).toBuffer();
  const outMeta = await sharp(buffer, animated ? { animated: true } : {}).metadata();

  // The thumbnail is deliberately a single still even when the source moves:
  // a grid of 48 playing GIFs is a CPU fire, and a static poster is what lets
  // the tile swap to the real animated file only on hover.
  const thumbnail = await sharp(input).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).toBuffer();

  return {
    buffer,
    width: outMeta.width ?? 0,
    height: animated ? outMeta.pageHeight ?? outMeta.height ?? 0 : outMeta.height ?? 0,
    thumbnail,
    animated,
  };
}
