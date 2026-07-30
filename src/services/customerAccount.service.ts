import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Everything the signed-in shopper's own account page needs, and the merchant
// side of pushing an offer to one.
//
// Kept apart from order.service / coupon.service on purpose: those are ADMIN
// surfaces and return admin shapes (access tokens, internal ids, every field).
// A storefront account page must never hand a shopper more of their own order
// than a receipt shows, and must never see another customer's anything. Every
// read here is scoped by customerId in the query itself rather than filtered
// afterwards — an omitted `where` is then a compile-visible mistake, not a
// silent leak.

export interface AccountOrder {
  number: string;
  status: string;
  total: number;
  currency: string;
  placedAt: Date;
  discountLabel: string | null;
  items: { name: string; sku: string | null; quantity: number; lineTotal: number; image: string | null; slug: string | null }[];
}

export const customerAccountService = {
  /** The shopper's own order history. */
  async orders(customerId: string, limit = 20): Promise<AccountOrder[]> {
    const rows = await db.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        number: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        discountLabel: true,
        items: {
          select: {
            quantity: true,
            priceAtTime: true,
            variant: {
              select: {
                sku: true,
                product: { select: { name: true, slug: true, image: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((o) => ({
      number: o.number,
      status: o.status,
      total: o.total,
      currency: o.currency,
      placedAt: o.createdAt,
      discountLabel: o.discountLabel,
      items: o.items.map((i) => ({
        name: i.variant?.product?.name ?? 'Item',
        sku: i.variant?.sku ?? null,
        quantity: i.quantity,
        lineTotal: i.priceAtTime * i.quantity,
        image: i.variant?.product?.image ?? null,
        slug: i.variant?.product?.slug ?? null,
      })),
    }));
  },

  /**
   * "Products you might like."
   *
   * Deliberately simple and explainable rather than a recommender: the
   * categories this shopper has actually bought from, minus what they already
   * own, newest first. When there is no history to reason from it falls back to
   * new arrivals and SAYS so via `basis`, so the storefront can label the strip
   * honestly instead of implying a personalisation that did not happen.
   */
  async recommendations(customerId: string, limit = 4): Promise<{ basis: 'history' | 'new'; products: unknown[] }> {
    const bought = await db.order.findMany({
      where: { customerId },
      select: { items: { select: { variant: { select: { productId: true } } } } },
      take: 50,
    });
    const boughtIds = [...new Set(bought.flatMap((o) => o.items.map((i) => i.variant?.productId).filter((id): id is string => !!id)))];

    const select = {
      id: true,
      name: true,
      slug: true,
      image: true,
      variants: { select: { price: true } },
    };

    if (boughtIds.length) {
      const cats = await db.productCategory.findMany({
        where: { products: { some: { id: { in: boughtIds } } } },
        select: { id: true },
      });
      if (cats.length) {
        const products = await db.product.findMany({
          where: {
            status: 'active',
            id: { notIn: boughtIds },
            categories: { some: { id: { in: cats.map((c) => c.id) } } },
          },
          select,
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        if (products.length) return { basis: 'history', products };
      }
    }

    return {
      basis: 'new',
      products: await db.product.findMany({
        where: { status: 'active', ...(boughtIds.length ? { id: { notIn: boughtIds } } : {}) },
        select,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    };
  },

  // ── Offers ──────────────────────────────────────────────────────────────

  /**
   * The shopper's live offers.
   *
   * A coupon that has gone inactive or past its window is filtered out here
   * rather than left to fail at checkout — an offer the shopper cannot use is
   * worse than no offer.
   */
  async offers(customerId: string) {
    const now = new Date();
    const rows = await db.customerOffer.findMany({
      where: { customerId, status: { in: ['active', 'claimed'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        coupon: {
          select: {
            code: true, type: true, amount: true, minimumAmount: true,
            status: true, startsAt: true, expiresAt: true,
            usageLimit: true, usageCount: true,
          },
        },
      },
    });
    return rows
      .filter((o) => o.coupon.status === 'active')
      .filter((o) => !o.coupon.startsAt || o.coupon.startsAt <= now)
      .filter((o) => !o.coupon.expiresAt || o.coupon.expiresAt > now)
      .filter((o) => o.coupon.usageLimit === null || o.coupon.usageCount < o.coupon.usageLimit)
      .map((o) => ({
        id: o.id,
        title: o.title,
        message: o.message,
        status: o.status,
        claimedAt: o.claimedAt,
        // The code is only revealed once the shopper claims it — otherwise a
        // "personal" offer is one view-source away from being public.
        code: o.status === 'claimed' ? o.coupon.code : null,
        discount: { type: o.coupon.type, amount: o.coupon.amount },
        minimumAmount: o.coupon.minimumAmount,
        expiresAt: o.coupon.expiresAt,
      }));
  },

  /** Claim reveals the code. Idempotent — claiming twice returns the same one. */
  async claimOffer(customerId: string, offerId: string) {
    const offer = await db.customerOffer.findFirst({
      where: { id: offerId, customerId },
      include: { coupon: { select: { code: true, status: true, expiresAt: true } } },
    });
    if (!offer) throw new NotFoundError('Offer not found', 'offerId');
    if (offer.status === 'dismissed') throw new ValidationError('That offer was dismissed.', 'offerId');
    if (offer.coupon.status !== 'active' || (offer.coupon.expiresAt && offer.coupon.expiresAt <= new Date())) {
      throw new ValidationError('That offer has expired.', 'offerId');
    }
    if (offer.status !== 'claimed') {
      await db.customerOffer.update({ where: { id: offer.id }, data: { status: 'claimed', claimedAt: new Date() } });
    }
    return { code: offer.coupon.code };
  },

  async dismissOffer(customerId: string, offerId: string) {
    const { count } = await db.customerOffer.updateMany({
      where: { id: offerId, customerId, status: 'active' },
      data: { status: 'dismissed' },
    });
    if (count === 0) throw new NotFoundError('Offer not found', 'offerId');
    return { dismissed: true };
  },

  /** Marks everything currently shown as seen, so the account badge can clear. */
  async markOffersSeen(customerId: string) {
    await db.customerOffer.updateMany({
      where: { customerId, status: 'active', seenAt: null },
      data: { seenAt: new Date() },
    });
    return { ok: true };
  },

  // ── Merchant side ───────────────────────────────────────────────────────

  /**
   * Push one coupon to a set of customers.
   *
   * Upsert per customer, so re-running a campaign with better copy updates the
   * message instead of stacking duplicate cards in someone's account. A
   * customer who already CLAIMED the offer is left alone — rewriting the pitch
   * under someone who has already taken it just makes their account lie.
   */
  async pushOffer(input: { couponId: string; customerIds: string[]; title: string; message?: string | null }) {
    const coupon = await db.coupon.findUnique({ where: { id: input.couponId }, select: { id: true, status: true } });
    if (!coupon) throw new NotFoundError('Coupon not found', 'couponId');
    if (coupon.status !== 'active') throw new ValidationError('That coupon is not active — activate it before pushing.', 'couponId');

    const ids = [...new Set(input.customerIds)];
    if (!ids.length) throw new ValidationError('Pick at least one customer.', 'customerIds');
    const existing = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const valid = existing.map((c) => c.id);

    let created = 0;
    let updated = 0;
    let skipped = ids.length - valid.length;
    for (const customerId of valid) {
      const prior = await db.customerOffer.findUnique({
        where: { customerId_couponId: { customerId, couponId: coupon.id } },
        select: { id: true, status: true },
      });
      if (prior?.status === 'claimed') { skipped += 1; continue; }
      if (prior) {
        await db.customerOffer.update({
          where: { id: prior.id },
          data: { title: input.title, message: input.message ?? null, status: 'active', seenAt: null },
        });
        updated += 1;
      } else {
        await db.customerOffer.create({
          data: { customerId, couponId: coupon.id, title: input.title, message: input.message ?? null },
        });
        created += 1;
      }
    }
    return { created, updated, skipped };
  },

  /** Campaign view: every push of every coupon, newest first. */
  async listOffers(limit = 100) {
    return db.customerOffer.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, email: true, name: true } },
        coupon: { select: { code: true, type: true, amount: true } },
      },
    });
  },

  async revokeOffer(id: string) {
    const { count } = await db.customerOffer.deleteMany({ where: { id, status: { not: 'claimed' } } });
    if (count === 0) throw new ValidationError('That offer was already claimed and cannot be revoked.', 'id');
    return { revoked: true };
  },
};
