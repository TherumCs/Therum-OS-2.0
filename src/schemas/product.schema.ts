import { z } from 'zod';
import { sortFields } from './listing.js';

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
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const CreateProductInput = z.object({
  name: z.string().min(1).max(240),
  slug: z.string().min(1).max(240).regex(SLUG, 'slug must be kebab-case').optional(),
  description: z.string().optional(),
  image: z.string().url().optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
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
  image: z.string().url().optional(),
  // Gallery (catalog presentation): ordered media — stills AND video. A
  // video entry should carry a poster (its still frame for non-hover
  // contexts); type defaults to image, or is inferred from the extension.
  images: z.array(z.object({
    url: z.string().url(),
    alt: z.string().max(200).optional(),
    type: z.enum(['image', 'video']).optional(),
    poster: z.string().url().optional(),
  })).max(20).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  vendorId: z.string().optional(),
  sourceId: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const ListProductsQuery = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  vendorId: z.string().optional(),
  // Filter the admin list the same way the storefront filters: a category
  // brings its DESCENDANTS with it, so "show me Mens" answers with everything
  // filed under Mens rather than only what sits directly on it.
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  ...sortFields(['updatedAt', 'createdAt', 'name', 'status'], 'updatedAt'),
});

export const UpdateVariantInput = z.object({
  sku: z.string().max(120).nullable().optional(),
  price: z.number().int().nonnegative().optional(),
  cost: z.number().int().nonnegative().nullable().optional(),
  color: z.string().max(80).nullable().optional(),
  size: z.string().max(80).nullable().optional(),
  inventory: z.number().int().min(0).optional(),
});
export type UpdateVariantInput = z.infer<typeof UpdateVariantInput>;

export type VariantInput = z.infer<typeof VariantInput>;
export type CreateProductInput = z.infer<typeof CreateProductInput>;
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;
export type ListProductsQuery = z.infer<typeof ListProductsQuery>;
