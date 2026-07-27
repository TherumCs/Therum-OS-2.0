import { z } from 'zod';

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
  kind: z.enum(['image', 'video', 'file']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(),
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

export type CreateMediaInput = z.infer<typeof CreateMediaInput>;
export type ListMediaQuery = z.infer<typeof ListMediaQuery>;
export type UpdateMediaInput = z.infer<typeof UpdateMediaInput>;
export type RenameMediaInput = z.infer<typeof RenameMediaInput>;
export type BulkRenameInput = z.infer<typeof BulkRenameInput>;
