import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import type { CreateCouponInput, UpdateCouponInput } from '../schemas/coupon.schema.js';

// Counter C3 — coupons. Validation reasons ported verbatim from 1.x
// CouponService::validateForCart (status, date window, global usage limit,
// per-user limit, min/max subtotal gates). Validated on BOTH apply and every
// recalc, because a coupon can go invalid mid-session (another customer
// exhausts the global limit). Per-user counting is by guest email until
// customer accounts exist. A DomainException there = "silently drop on
// recalc, hard error on apply" — the caller decides which.

export interface CouponQuote {
  couponId: string;
  code: string;
  amount: number; // discount in minor units for this subtotal
  label: string;
}

// Codes are stored and matched uppercase so entry is case-insensitive
// (audit F8) — 'save10' and 'SAVE10' are one coupon.
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function discountAmount(type: 'percent' | 'fixed', amount: number, subtotal: number): number {
  const raw = type === 'percent' ? Math.round(subtotal * (amount / 100)) : amount;
  // Never discount below zero.
  return Math.min(raw, subtotal);
}

async function validate(
  coupon: { id: string; status: string; startsAt: Date | null; expiresAt: Date | null; usageLimit: number | null; usageCount: number; usageLimitPerUser: number | null; minimumAmount: number | null; maximumAmount: number | null },
  subtotal: number,
  email: string | null,
): Promise<void> {
  const now = new Date();
  if (coupon.status !== 'active') throw new ValidationError('Coupon is not active.', 'code');
  if (coupon.startsAt && now < coupon.startsAt) throw new ValidationError('Coupon is not yet valid.', 'code');
  if (coupon.expiresAt && now > coupon.expiresAt) throw new ValidationError('Coupon has expired.', 'code');
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) throw new ValidationError('Coupon usage limit reached.', 'code');
  if (coupon.usageLimitPerUser !== null) {
    // Only ACTIVE (unreleased) redemptions count — a refunded order frees a slot.
    const used = await db.couponRedemption.count({ where: { couponId: coupon.id, email: email ?? undefined, releasedAt: null } });
    if (email && used >= coupon.usageLimitPerUser) throw new ValidationError('You have already used this coupon the maximum number of times.', 'code');
  }
  if (coupon.minimumAmount !== null && subtotal < coupon.minimumAmount) {
    throw new ValidationError(`Spend at least ${coupon.minimumAmount} (minor units) to use this coupon.`, 'code');
  }
  if (coupon.maximumAmount !== null && subtotal > coupon.maximumAmount) {
    throw new ValidationError('Cart exceeds this coupon’s maximum — not applicable.', 'code');
  }
}

export const couponService = {
  // ── admin CRUD ──
  async list() {
    return db.coupon.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { redemptions: true } } } });
  },

  async create(input: CreateCouponInput) {
    const code = normalizeCode(input.code);
    const existing = await db.coupon.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new ConflictError('A coupon with that code already exists', 'code');
    return db.coupon.create({ data: { ...input, code } });
  },

  async update(id: string, input: UpdateCouponInput) {
    const current = await db.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundError('Coupon not found', 'id');
    const type = input.type ?? current.type;
    const amount = input.amount ?? current.amount;
    if (type === 'percent' && amount > 100) throw new ValidationError('percent amount must be 1–100', 'amount');
    const nextCode = input.code ? normalizeCode(input.code) : undefined;
    if (nextCode && nextCode !== current.code) {
      const clash = await db.coupon.findUnique({ where: { code: nextCode }, select: { id: true } });
      if (clash) throw new ConflictError('A coupon with that code already exists', 'code');
    }
    return db.coupon.update({ where: { id }, data: { ...input, ...(nextCode ? { code: nextCode } : {}) } });
  },

  async remove(id: string): Promise<void> {
    const c = await db.coupon.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundError('Coupon not found', 'id');
    await db.coupon.delete({ where: { id } }); // redemptions cascade
  },

  // ── cart/checkout ──
  // Hard-error quote (apply path): throws a UNIFORM invalid message whether
  // the code doesn't exist or exists-but-unusable (audit F7 — a 404-vs-422
  // split is a code-enumeration + config-leak oracle). Codes are normalized
  // to uppercase so 'save10' and 'SAVE10' are the same coupon (audit F8).
  async quote(code: string, subtotal: number, email: string | null): Promise<CouponQuote> {
    const coupon = await db.coupon.findUnique({ where: { code: normalizeCode(code) } });
    if (!coupon) throw new ValidationError('That coupon code is not valid.', 'code');
    try {
      await validate(coupon, subtotal, email);
    } catch {
      throw new ValidationError('That coupon code is not valid.', 'code');
    }
    const amount = discountAmount(coupon.type, coupon.amount, subtotal);
    return { couponId: coupon.id, code: coupon.code, amount, label: `Coupon ${coupon.code}` };
  },

  // Soft quote (recalc path): returns null instead of throwing when the
  // stored coupon has gone invalid (1.x silently drops it on recalc).
  async quoteOrNull(code: string, subtotal: number, email: string | null): Promise<CouponQuote | null> {
    try {
      return await this.quote(code, subtotal, email);
    } catch {
      return null;
    }
  },

  // Atomically RESERVE a usage slot for a coupon and record the redemption
  // against the order — the fix for the F1/F2/F4 usage-limit races. The
  // conditional increment (usageCount < usageLimit, guarded per-user too)
  // is the real gate: N concurrent checkouts of a limit:1 coupon → exactly
  // one wins the UPDATE, the rest get null and no discount. Returns true if
  // the slot was reserved, false if the coupon is now exhausted — the caller
  // (checkout) uses that to decide whether the discount actually applies.
  // Idempotent per order via UNIQUE(couponId, orderId): a retry of the SAME
  // order returns true without double-counting.
  async reserveForOrder(orderId: string, couponId: string, amount: number, email: string | null): Promise<boolean> {
    // Already recorded for this order? (checkout retry / same-order dedupe)
    const already = await db.couponRedemption.findUnique({ where: { coupon_order: { couponId, orderId } }, select: { id: true } });
    if (already) return true;

    return db.$transaction(async (tx) => {
      // Conditional global-limit increment — the atomic slot claim.
      const claimed = await tx.$executeRaw`
        UPDATE coupons SET usage_count = usage_count + 1, updated_at = now()
        WHERE id = ${couponId} AND (usage_limit IS NULL OR usage_count < usage_limit)`;
      if (claimed !== 1) return false; // exhausted between quote and record

      // Per-user cap, re-checked inside the transaction against unreleased rows.
      const coupon = await tx.coupon.findUnique({ where: { id: couponId }, select: { usageLimitPerUser: true } });
      if (coupon?.usageLimitPerUser != null && email) {
        const used = await tx.couponRedemption.count({ where: { couponId, email, releasedAt: null } });
        if (used >= coupon.usageLimitPerUser) {
          // Roll the global claim back — this user is over their per-user cap.
          await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { decrement: 1 } } });
          return false;
        }
      }

      try {
        await tx.couponRedemption.create({ data: { couponId, orderId, amount, email } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Concurrent same-order insert won — release our extra claim.
          await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { decrement: 1 } } });
          return true;
        }
        throw err; // real fault — surface it, don't swallow (audit F3)
      }
      return true;
    });
  },

  // On full refund: release this order's redemptions so per-user limits
  // don't permanently burn a slot (1.x releaseRedemptionsForOrder). The
  // release is a GUARDED one-shot (audit F5): the updateMany's WHERE carries
  // releasedAt:null, so two concurrent releases (e.g. two partial refunds
  // that both complete the total at once) can't both flip the same row —
  // usageCount is decremented ONLY for the release that actually won,
  // never below zero.
  async releaseForOrder(orderId: string): Promise<void> {
    const rows = await db.couponRedemption.findMany({ where: { orderId, releasedAt: null }, select: { id: true, couponId: true } });
    for (const r of rows) {
      await db.$transaction(async (tx) => {
        const flipped = await tx.couponRedemption.updateMany({ where: { id: r.id, releasedAt: null }, data: { releasedAt: new Date() } });
        if (flipped.count === 1) {
          await tx.coupon.update({ where: { id: r.couponId }, data: { usageCount: { decrement: 1 } } });
        }
      });
    }
  },
};
