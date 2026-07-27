import { z } from 'zod';

// Maps a Therum product field → the source column name.
export const ImportMapping = z.object({
  name: z.string().min(1),
  price: z.string().min(1),
  sku: z.string().optional(),
  sourceId: z.string().optional(),
});

export const RunImportInput = z.object({
  vendorId: z.string().optional(),
  // Dry-run by default — preview before committing.
  dryRun: z.boolean().default(true),
  mapping: ImportMapping,
  rows: z.array(z.record(z.string(), z.string())).max(5000),
});

export type ImportMapping = z.infer<typeof ImportMapping>;
export type RunImportInput = z.infer<typeof RunImportInput>;
