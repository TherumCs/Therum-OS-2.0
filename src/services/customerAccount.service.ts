import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { notificationService } from './notification.service.js';
import { settingsService } from './settings.service.js';
import { capabilityService } from './capability.service.js';
import { milieuService } from './milieu.service.js';
import { messageEmailHtml } from './emailTemplate.js';
import { esc } from '../site/html.js';
import { unsubscribeUrl as buildUnsubscribeUrl } from '../lib/unsubscribe.js';

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
  async recommendations(customerId: string, limit = 8): Promise<{ sections: { key: string; title: string; basis: string; products: unknown[] }[] }> {
    const bought = await db.order.findMany({
      where: { customerId },
      select: { items: { select: { variant: { select: { productId: true } } } } },
      take: 50,
    });
    const boughtIds = [...new Set(bought.flatMap((o) => o.items.map((i) => i.variant?.productId).filter((id): id is string => !!id)))];

    // `meta` is selected only to honour the per-product noMemberDiscount flag —
    // it is stripped before the shape leaves this service (see enrich()).
    const select = {
      id: true,
      name: true,
      slug: true,
      image: true,
      meta: true,
      variants: { select: { price: true, id: true } },
    };

    // The account page is a store surface, so a Friends & Family shopper must
    // see their member price on these picks exactly as they do on /shop and the
    // PDP. Resolve the discount once for this signed-in customer and stamp every
    // card with it; the client (pickHtml) renders was/now the same way the grid
    // does. Same gate as storefront.ts: pricing mode on + memberships enabled.
    const counter = await settingsService.getCounter().catch(() => null);
    const basePct = counter && counter.memberPricing !== 'off' && (await capabilityService.isEnabled('memberships'))
      ? ((await milieuService.discountFor(customerId))?.pct ?? 0)
      : 0;
    const enrich = (products: { meta: unknown }[]): unknown[] => products.map((p) => {
      const noMember = (p.meta as Record<string, unknown> | null)?.noMemberDiscount === true;
      const { meta: _meta, ...rest } = p;
      return {
        ...rest,
        memberPct: noMember ? 0 : basePct,
        memberDisplay: counter?.memberPricing ?? 'off',
        memberLabel: counter?.memberPriceLabel ?? '',
      };
    });

    const sections: { key: string; title: string; basis: string; products: unknown[] }[] = [];
    // Dedupe ACROSS rails — a product shown once (or already owned) never repeats
    // in a later rail, so the page reads as distinct sections, not the same eight
    // items relabelled.
    const shown = new Set<string>(boughtIds);
    const addSection = (key: string, title: string, basis: string, rows: { id: string; meta: unknown }[]): void => {
      const fresh = rows.filter((p) => !shown.has(p.id)).slice(0, limit);
      if (!fresh.length) return;
      fresh.forEach((p) => shown.add(p.id));
      sections.push({ key, title, basis, products: enrich(fresh) });
    };

    // 1. Exclusive to you — the member-only drops this shopper can ACTUALLY see:
    // products gated to a milieu they belong to (Friends & Family) or granted to
    // their account directly. The real F&F-exclusive surface, not a public item
    // dressed up. No milieu + no grants → no such rail. (Empty until such products
    // exist — create a product with milieu/account visibility and it lights up.)
    const myMilieus = await db.milieuMembership.findMany({ where: { customerId }, select: { milieuId: true } });
    const milieuIds = myMilieus.map((m) => m.milieuId);
    // Canonical gated value is 'restricted' (milieu audiences + account grants
    // combined) — the same value src/counter/visibility.ts's gate honours, so the
    // account rail and the storefront grid agree on what's exclusive.
    addSection('exclusive', 'Exclusive to you', 'exclusive', await db.product.findMany({
      where: {
        status: 'active',
        OR: [
          // 'members' — visible to any signed-in shopper (this account qualifies).
          { visibility: 'members' },
          // 'restricted' — only when a milieu/account grant matches this shopper.
          { visibility: 'restricted', OR: [
            ...(milieuIds.length ? [{ audiences: { some: { milieuId: { in: milieuIds } } } }] : []),
            { access: { some: { customerId } } },
          ] },
        ],
      },
      select, orderBy: { createdAt: 'desc' }, take: limit,
    }));

    // 2. Picked for you — more from the categories they've bought into. Needs the
    // past purchases to be categorised (uncategorised orders yield no rail).
    if (boughtIds.length) {
      const cats = await db.productCategory.findMany({ where: { products: { some: { id: { in: boughtIds } } } }, select: { id: true } });
      if (cats.length) {
        addSection('foryou', 'Picked for you', 'history', await db.product.findMany({
          where: { status: 'active', visibility: 'public', categories: { some: { id: { in: cats.map((c) => c.id) } } } },
          select, orderBy: { createdAt: 'desc' }, take: limit + boughtIds.length,
        }));
      }
    }

    // 3. Trending now — the store's bestsellers by units sold. The reliable rail
    // that fills for everyone, so the page is never a single row of new arrivals.
    const trendRows = await db.orderItem.groupBy({ by: ['variantId'], _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 80 });
    const trendVarIds = trendRows.map((r) => r.variantId).filter((v): v is string => !!v);
    if (trendVarIds.length) {
      const vmap = new Map((await db.productVariant.findMany({ where: { id: { in: trendVarIds } }, select: { id: true, productId: true } })).map((v) => [v.id, v.productId]));
      const pidOrder: string[] = [];
      const seen = new Set<string>();
      for (const r of trendRows) {
        const pid = r.variantId ? vmap.get(r.variantId) : undefined;
        if (pid && !seen.has(pid)) { seen.add(pid); pidOrder.push(pid); }
      }
      const rows = await db.product.findMany({ where: { id: { in: pidOrder }, status: 'active', visibility: 'public' }, select });
      const byId = new Map(rows.map((p) => [p.id, p]));
      addSection('trending', 'Trending now', 'trending', pidOrder.map((id) => byId.get(id)).filter((p): p is (typeof rows)[number] => !!p));
    }

    // 4. New arrivals — the newest public drops, whatever hasn't been shown yet.
    addSection('new', 'New arrivals', 'new', await db.product.findMany({
      where: { status: 'active', visibility: 'public' },
      select, orderBy: { createdAt: 'desc' }, take: limit + 30,
    }));

    return { sections };
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
    const existing = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const emailById = new Map(existing.map((c) => [c.id, c.email]));
    const valid = existing.map((c) => c.id);

    let created = 0;
    let updated = 0;
    let skipped = ids.length - valid.length;
    const pushed: string[] = []; // customers who actually got the offer this call
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
      pushed.push(customerId);
    }

    // Tell each shopper an offer is waiting — best-effort, fire-and-forget so a
    // dead mail transport never fails the push. The offer already lives in their
    // account (that is the source of truth); this is just the nudge.
    if (pushed.length) {
      const site = await settingsService.getSite();
      const message = input.message || 'We put something in your account, just for you.';
      for (const customerId of pushed) {
        const to = emailById.get(customerId);
        if (!to) continue;
        const unsub = buildUnsubscribeUrl(to);
        const html = messageEmailHtml({
          eyebrow: 'Friends & Family', eyebrowColor: '#e83b3b',
          heading: input.title,
          paragraphs: [esc(message), 'It is waiting in your account &mdash; tap below to see it.'],
          cta: { label: 'View your account', url: `${process.env.PUBLIC_ORIGIN || ''}/account` },
          preheader: input.title,
          siteName: site.siteName,
          unsubscribeUrl: unsub,
        });
        void notificationService.sendToAddress(
          to,
          `${site.siteName} — ${input.title}`,
          `${input.title}\n\n${message}\n\nView it in your account: ${process.env.PUBLIC_ORIGIN || ''}/account\n\n— ${site.siteName}`,
          html,
          { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        ).catch(() => {});
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
