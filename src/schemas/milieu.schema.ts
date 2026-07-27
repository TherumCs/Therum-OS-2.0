import { z } from 'zod';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const MilieuFields = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(SLUG, 'lowercase letters, numbers, and hyphens'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
  discountPct: z.number().min(0).max(100).default(0),
  // ISO datetime or null; null = the group lives forever.
  expiresAt: z.coerce.date().nullable().default(null),
  memberDurationDays: z.number().int().min(0).max(3650).default(0),
  // Public registration link (M4).
  regEnabled: z.boolean().default(false),
  regSlug: z.string().regex(SLUG).nullable().default(null),
  regRequiresApproval: z.boolean().default(false),
  regMaxSignups: z.number().int().min(0).default(0),
});

// An enabled registration link without a slug would be unreachable — reject
// at the boundary rather than storing a claim the API can't honor.
const regConsistent = { message: 'A registration slug is required when the registration link is enabled', path: ['regSlug'] };

export const CreateMilieuInput = MilieuFields.refine((v) => !v.regEnabled || Boolean(v.regSlug), regConsistent);

// NOT MilieuFields.partial(): .partial() keeps .default()s, so a name-only
// PATCH would inject discountPct:0, regEnabled:false, memberDurationDays:0,
// etc. and silently reset the group (same footgun already fixed in
// content.schema.ts — every Update schema in this codebase must be built
// from plainly-optional fields with zero defaults).
export const UpdateMilieuInput = z
  .object({
    name: z.string().min(1).max(80).optional(),
    slug: z.string().regex(SLUG, 'lowercase letters, numbers, and hyphens').optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    discountPct: z.number().min(0).max(100).optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    memberDurationDays: z.number().int().min(0).max(3650).optional(),
    regEnabled: z.boolean().optional(),
    regSlug: z.string().regex(SLUG).nullable().optional(),
    regRequiresApproval: z.boolean().optional(),
    regMaxSignups: z.number().int().min(0).optional(),
  })
  .refine((v) => !(v.regEnabled === true && v.regSlug === null), regConsistent);

export const AddMemberInput = z
  .object({
    customerId: z.string().min(1).optional(),
    email: z.string().email().optional(),
    source: z.enum(['manual', 'link', 'csv', 'api']).default('manual'),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.email), {
    message: 'Provide exactly one of customerId or email',
    path: ['customerId'],
  });

export const ExtendMemberInput = z.object({
  seconds: z.number().int().min(1).max(10 * 365 * 24 * 3600),
});

export const BulkMembersInput = z.object({
  action: z.enum(['revoke', 'extend_30', 'reset_expiry']),
  customerIds: z.array(z.string().min(1)).min(1).max(500),
});

export const ListMembersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().max(200).default(''),
});

// Public signup (M4). `website` is the honeypot — humans never see it, bots
// fill it; a filled honeypot gets a fake success and no membership (1.x
// spam.php behavior).
export const PublicRegisterInput = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  website: z.string().optional(),
});

export type PublicRegisterInput = z.infer<typeof PublicRegisterInput>;

export type CreateMilieuInput = z.infer<typeof CreateMilieuInput>;
export type UpdateMilieuInput = z.infer<typeof UpdateMilieuInput>;
export type AddMemberInput = z.infer<typeof AddMemberInput>;
export type ExtendMemberInput = z.infer<typeof ExtendMemberInput>;
export type BulkMembersInput = z.infer<typeof BulkMembersInput>;
export type ListMembersQuery = z.infer<typeof ListMembersQuery>;
