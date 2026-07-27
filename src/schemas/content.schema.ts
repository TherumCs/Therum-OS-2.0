import { z } from 'zod';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Image fields need to accept both an absolute URL (an externally-hosted
// image) and a site-relative path (a locally-uploaded MediaAsset — those
// store `url` as `/api/uploads/...`, which plain z.string().url() rejects
// outright, so a cover/OG image could never point at the media library).
// `canonical` stays strict-absolute below — a relative canonical isn't
// meaningfully "the" canonical URL.
const imageRef = z
  .string()
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Must be an absolute URL or a site-relative path');

export const SeoInput = z
  .object({
    title: z.string().max(70),
    description: z.string().max(200),
    ogImage: imageRef,
    canonical: z.string().url(),
    noindex: z.boolean(),
  })
  .partial();

export const CreateContentInput = z.object({
  type: z.enum(['page', 'post', 'case_study']).default('page'),
  title: z.string().min(1).max(240),
  slug: z.string().min(1).max(240).regex(SLUG, 'slug must be kebab-case').optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  excerpt: z.string().max(500).optional(),
  coverImage: imageRef.optional(),
  // Builder canvas tree, markdown string, or html — bodyFormat says which.
  body: z.unknown().optional(),
  bodyFormat: z.enum(['canvas', 'markdown', 'html']).default('canvas'),
  seo: SeoInput.default({}),
  meta: z.record(z.string(), z.unknown()).default({}),
});

// NOT CreateContentInput.partial(): .partial() keeps .default()s, so a
// partial update like { meta } would silently inject type:'page',
// status:'draft', bodyFormat:'canvas', seo:{} and clobber the row (found
// live 2026-07-23 — a meta-only PATCH un-published a case study and wiped
// its SEO). Every field here is plainly optional with NO defaults; the
// service's `!== undefined` spreads then leave untouched fields alone.
export const UpdateContentInput = z.object({
  type: z.enum(['page', 'post', 'case_study']).optional(),
  title: z.string().min(1).max(240).optional(),
  slug: z.string().min(1).max(240).regex(SLUG, 'slug must be kebab-case').optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  excerpt: z.string().max(500).optional(),
  coverImage: imageRef.optional(),
  body: z.unknown().optional(),
  bodyFormat: z.enum(['canvas', 'markdown', 'html']).optional(),
  seo: SeoInput.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const ListContentQuery = z.object({
  type: z.enum(['page', 'post', 'case_study']).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateContentInput = z.infer<typeof CreateContentInput>;
export type UpdateContentInput = z.infer<typeof UpdateContentInput>;
export type ListContentQuery = z.infer<typeof ListContentQuery>;
