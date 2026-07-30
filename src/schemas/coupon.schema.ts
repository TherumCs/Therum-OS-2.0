import { z } from 'zod';

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

export const CreateCouponInput = z.object({
  code: z.string().regex(CODE, 'letters, numbers, dash/underscore, 2–40 chars'),
  type: z.enum(['percent', 'fixed']),
  // percent: 1..100. fixed: minor units (>0).
  amount: z.number().int().min(1),
  minimumAmount: z.number().int().min(0).nullable().default(null),
  maximumAmount: z.number().int().min(0).nullable().default(null),
  usageLimit: z.number().int().min(1).nullable().default(null),
  usageLimitPerUser: z.number().int().min(1).nullable().default(null),
  startsAt: z.coerce.date().nullable().default(null),
  expiresAt: z.coerce.date().nullable().default(null),
  status: z.enum(['active', 'inactive']).default('active'),
  description: z.string().max(280).nullable().default(null),
  /** Restrict to members of one milieu. Null = anyone with the code. */
  milieuId: z.string().nullable().default(null),
}).refine((v) => v.type !== 'percent' || v.amount <= 100, { message: 'percent amount must be 1–100', path: ['amount'] });

// Update: plainly-optional, NO defaults (the CreateX.partial() footgun —
// a name-only PATCH must not reset status/limits). No refine here so a
// bare update stays valid; the percent<=100 check re-runs via the service
// re-reading the row if type/amount change together.
export const UpdateCouponInput = z.object({
  code: z.string().regex(CODE).optional(),
  type: z.enum(['percent', 'fixed']).optional(),
  amount: z.number().int().min(1).optional(),
  minimumAmount: z.number().int().min(0).nullable().optional(),
  maximumAmount: z.number().int().min(0).nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  usageLimitPerUser: z.number().int().min(1).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  description: z.string().max(280).nullable().optional(),
  milieuId: z.string().nullable().optional(),
});

export const ApplyCouponInput = z.object({
  cartToken: z.string().length(32),
  code: z.string().min(1).max(40),
});

export type CreateCouponInput = z.infer<typeof CreateCouponInput>;
export type UpdateCouponInput = z.infer<typeof UpdateCouponInput>;
