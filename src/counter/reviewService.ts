import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Counter — product reviews.
//
// Ported from Counter 0.45's Review model. Two decisions carried over, both
// places Woo gets it wrong out of the box:
//
//   Moderated by default. An unmoderated public review form is a spam
//   endpoint, and "approve later" is not a setting a store owner should have
//   to discover after the fact.
//
//   `verified` is COMPUTED, never supplied. Woo's verified-owner badge needs a
//   plugin or a setting; here it is derived from order history at submission
//   time, so a reviewer cannot self-declare it and it cannot be faked by
//   posting a crafted payload.

export type ReviewStatus = 'pending' | 'approved' | 'spam';

export interface SubmitReview {
  productId: string;
  reviewerName: string;
  reviewerEmail: string;
  rating: number;
  title?: string;
  body: string;
  customerId?: string | null;
}

export const reviewService = {
  /**
   * Public submission. Always lands as `pending`; `verified` is worked out
   * here rather than trusted from the caller.
   */
  async submit(input: SubmitReview) {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new ValidationError('Rating must be a whole number from 1 to 5.', 'rating');
    }
    if (!input.body.trim()) throw new ValidationError('A review needs some text.', 'body');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.reviewerEmail)) {
      throw new ValidationError('That email address does not look right.', 'reviewerEmail');
    }

    const product = await db.product.findUnique({ where: { id: input.productId }, select: { id: true } });
    if (!product) throw new NotFoundError('Product not found', 'productId');

    return db.productReview.create({
      data: {
        productId: input.productId,
        customerId: input.customerId ?? null,
        reviewerName: input.reviewerName.trim().slice(0, 120),
        reviewerEmail: input.reviewerEmail.trim().toLowerCase(),
        rating: input.rating,
        title: input.title?.trim().slice(0, 200) || null,
        body: input.body.trim(),
        status: 'pending',
        verified: await this.hasPurchased(input.reviewerEmail, input.productId),
      },
    });
  },

  /**
   * Did this email actually buy this product?
   *
   * Matches on the order's customer email OR the guest email, since a guest
   * checkout is still a real purchase — treating guests as unverified would
   * mark most real buyers on a typical store as unverified.
   */
  async hasPurchased(email: string, productId: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const count = await db.order.count({
      where: {
        status: { in: ['processing', 'shipped', 'delivered'] },
        OR: [{ guestEmail: normalized }, { customer: { email: normalized } }],
        items: { some: { variant: { productId } } },
      },
    });
    return count > 0;
  },

  /** Public listing — approved only. Never leaks pending or spam. */
  async listPublic(productId: string, limit = 20) {
    return db.productReview.findMany({
      where: { productId, status: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      // Emails are PII and never belong in a public response.
      select: { id: true, reviewerName: true, rating: true, title: true, body: true, verified: true, createdAt: true },
    });
  },

  /** Rating summary for a product card — approved reviews only. */
  async summary(productId: string): Promise<{ average: number; count: number; distribution: Record<number, number> }> {
    const rows = await db.productReview.findMany({
      where: { productId, status: 'approved' },
      select: { rating: true },
    });
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
    const count = rows.length;
    const average = count === 0 ? 0 : Math.round((rows.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10;
    return { average, count, distribution };
  },

  /** Moderation queue. */
  async listForModeration(status: ReviewStatus = 'pending', limit = 50) {
    return db.productReview.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: limit });
  },

  async setStatus(id: string, status: ReviewStatus) {
    const existing = await db.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Review not found', 'id');
    return db.productReview.update({ where: { id }, data: { status } });
  },

  async remove(id: string) {
    const existing = await db.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Review not found', 'id');
    await db.productReview.delete({ where: { id } });
    return { id, deleted: true as const };
  },
};
