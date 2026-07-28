import { z } from 'zod';
import { sortFields } from './listing.js';

// Register an already-hosted asset (URL-referenced). A binary upload pipeline
// (local disk / S3) is a follow-up — out of scope for this hardening pass.
export const CreateMediaInput = z.object({
  url: z.string().url(),
  alt: z.string().max(500).optional(),
  kind: z.enum(['image', 'video', 'file']).default('image'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  size: z.number().int().nonnegative().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const ListMediaQuery = z.object({
  // 'audio' was missing here while both the uploader (kindForMime) and the
  // library's own Audio filter pill produce it — selecting Audio 422'd.
  kind: z.enum(['image', 'video', 'audio', 'file']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(),
  ...sortFields(['createdAt', 'url', 'size', 'kind'], 'createdAt'),
});

export const UpdateMediaInput = z.object({
  alt: z.string().max(500).nullable(),
});

export const RenameMediaInput = z.object({
  basename: z.string().min(1).max(200),
});

export const BulkRenameInput = z.object({
  items: z
    .array(z.object({ id: z.string(), basename: z.string().min(1).max(200) }))
    .min(1)
    .max(200),
});

// Non-destructive image edits. The crop rect is normalised (0–1 fractions of
// the current image) rather than pixels so the client can send exactly what it
// drew on a scaled-down preview without doing the conversion — and so a rect
// stays meaningful if the stored image is ever re-encoded at another size.
export const TransformMediaInput = z
  .object({
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0.01).max(1),
        height: z.number().min(0.01).max(1),
      })
      .refine((c) => c.x + c.width <= 1.0001 && c.y + c.height <= 1.0001, {
        message: 'Crop rect falls outside the image.',
      })
      .optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    flipX: z.boolean().default(false),
    flipY: z.boolean().default(false),
  })
  .refine((t) => Boolean(t.crop) || t.rotate !== 0 || t.flipX || t.flipY, {
    message: 'Nothing to apply — set a crop, a rotation, or a flip.',
  });

export type CreateMediaInput = z.infer<typeof CreateMediaInput>;
export type TransformMediaInput = z.infer<typeof TransformMediaInput>;
export type ListMediaQuery = z.infer<typeof ListMediaQuery>;
export type UpdateMediaInput = z.infer<typeof UpdateMediaInput>;
export type RenameMediaInput = z.infer<typeof RenameMediaInput>;
export type BulkRenameInput = z.infer<typeof BulkRenameInput>;
