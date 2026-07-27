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
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  // .rotate() with no args reads the EXIF orientation tag and bakes it into
  // the pixel data before the metadata (including that same tag) is dropped.
  const base = sharp(input).rotate();
  const meta = await base.metadata();

  const oversized = (meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION;
  const main = oversized
    ? base.clone().resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    : base.clone();
  const buffer = await main.toBuffer();
  const outMeta = await sharp(buffer).metadata();

  const thumbnail = await base.clone().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).toBuffer();

  return { buffer, width: outMeta.width ?? 0, height: outMeta.height ?? 0, thumbnail };
}
