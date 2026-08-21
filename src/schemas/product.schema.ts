import { z } from 'zod';
import { sortFields } from './listing.js';

/**
 * A media reference: an absolute http(s) URL, or a site-relative path.
 *
 * `z.string().url()` REJECTS site-relative paths, and this store's own media
 * library serves everything from `/api/uploads/...` — so every field that took
 * a picture refused the pictures the store itself had uploaded. Anything picked
 * from the library 400'd, while remote CDN urls sailed through.
 */
const MEDIA_URL = z.string().min(1).max(2000).refine(
  (v) => /^https?:\/\//i.test(v) || v.startsWith('/'),
  'must be a URL or a path beginning with /',
);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const VariantInput = z.object({
  sku: z.string().max(120).optional(),
  // Money in minor units (cents). Integers only.
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative().optional(),
  color: z.string().max(80).optional(),
  size: z.string().max(80).optional(),
  sourceVendorId: z.string().optional(),
  sourceId: z.string().optional(),
  inventory: z.number().int().nonnegative().default(0),
  // How availability is decided. 'tracked' counts `inventory`; the rest decide
  // by status — see counter/availability.ts.
  stockStatus: z.enum(['tracked', 'in_stock', 'out_of_stock', 'backorder']).default('tracked'),
  image: MEDIA_URL.nullish(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const CreateProductInput = z.object({
  name: z.string().min(1).max(240),
  slug: z.string().min(1).max(240).regex(SLUG, 'slug must be kebab-case').optional(),
  description: z.string().optional(),
  image: MEDIA_URL.optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  // A product can be created already unlisted or restricted — see
  // counter/visibility.ts. Public is the safe default.
  visibility: z.enum(['public', 'private', 'restricted']).default('public'),
  vendorId: z.string().optional(),
  sourceId: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
  variants: z.array(VariantInput).default([]),
});

// NOT CreateProductInput.partial(): .partial() keeps .default()s — a
// name-only PATCH would inject status:'draft' (un-publishing a live
// product) and meta:{} (wiping it). Same footgun as content/milieu; every
// Update schema must be plainly-optional fields with zero defaults.
export const UpdateProductInput = z.object({
  name: z.string().min(1).max(240).optional(),
  slug: z.string().min(1).max(240).regex(SLUG, 'slug must be kebab-case').optional(),
  description: z.string().optional(),
  image: MEDIA_URL.optional(),
  // Gallery (catalog presentation): ordered media — stills AND video. A
  // video entry should carry a poster (its still frame for non-hover
  // contexts); type defaults to image, or is inferred from the extension.
  images: z.array(z.object({
    url: MEDIA_URL,
    alt: z.string().max(200).optional(),
    type: z.enum(['image', 'video']).optional(),
    poster: MEDIA_URL.optional(),
  })).max(20).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  // WHO may see it — a separate axis from `status`. See counter/visibility.ts.
  visibility: z.enum(['public', 'private', 'restricted']).optional(),
  vendorId: z.string().optional(),
  sourceId: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const ListProductsQuery = z.object({
  // Show the TRASH instead of the live catalogue. Absent/false means the
  // normal list, which must never include trashed rows.
  trashed: z.coerce.boolean().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  // WHO may see it — a separate axis from `status`. See counter/visibility.ts.
  visibility: z.enum(['public', 'private', 'restricted']).optional(),
  vendorId: z.string().optional(),
  // Filter the admin list the same way the storefront filters: a category
  // brings its DESCENDANTS with it, so "show me Mens" answers with everything
  // filed under Mens rather than only what sits directly on it.
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  // Numbered-page (offset) paging for the admin catalog, alongside the cursor
  // paging other lists use. When present, `page` wins and the list jumps
  // straight to that page rather than walking a cursor trail.
  page: z.coerce.number().int().min(1).optional(),
  // Newest-first by default: a vendor re-sync bumps updatedAt on OLD products,
  // which under an updatedAt-default sort shoves them above genuinely-new pushes
  // and buries what the operator just added. createdAt is stable — a new push
  // always lands at the very top of the catalog list, immune to sync churn.
  ...sortFields(['createdAt', 'updatedAt', 'name', 'status'], 'createdAt'),
});

export const UpdateVariantInput = z.object({
  sku: z.string().max(120).nullable().optional(),
  price: z.number().int().nonnegative().optional(),
  cost: z.number().int().nonnegative().nullable().optional(),
  color: z.string().max(80).nullable().optional(),
  size: z.string().max(80).nullable().optional(),
  inventory: z.number().int().min(0).optional(),
  stockStatus: z.enum(['tracked', 'in_stock', 'out_of_stock', 'backorder']).optional(),
  image: MEDIA_URL.nullish(),
  // The variant's OWN gallery — the other angles of this colourway.
  images: z.array(z.object({ url: MEDIA_URL, alt: z.string().max(200).optional() })).max(20).optional(),
});
export type UpdateVariantInput = z.infer<typeof UpdateVariantInput>;

export type VariantInput = z.infer<typeof VariantInput>;
export type CreateProductInput = z.infer<typeof CreateProductInput>;
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;
export type ListProductsQuery = z.infer<typeof ListProductsQuery>;
