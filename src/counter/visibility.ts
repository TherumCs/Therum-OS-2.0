import type { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';

// WHO may see a product.
//
// Separate from `status`, which is the lifecycle. A product can be Active and
// private at the same time, and folding the two into one dropdown would lose
// that combination.
//
// The rule that matters: this is enforced at the CART and the CHECKOUT, not
// only in listings. Hiding a product from /shop while `POST /api/cart/items`
// still accepts its variant id is not privacy — it is obscurity, and anyone who
// has ever seen the id keeps their access forever. Stock had exactly this shape
// of bug (page said one thing, checkout another), which is why availability
// ended up with a single shared definition too.

/**
 * Confirmed with Bam, 2026-08-01 — not inferred:
 *
 *   public     — everyone.
 *   private    — UNLISTED. Absent from listings, but the direct link works for
 *                anyone who has it, and they can buy. Sharing the URL is the
 *                whole mechanism, so the link IS the credential.
 *   restricted — must match at least one milieu OR one named account. Milieus
 *                and accounts COMBINE: a shopper who matches either gets in.
 *                Anyone else sees nothing at all — absent from listings and the
 *                URL 404s, with no hint the product exists.
 */
export type Visibility = 'public' | 'private' | 'restricted';

export const VISIBILITIES: Visibility[] = ['public', 'private', 'restricted'];

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === 'string' && (VISIBILITIES as string[]).includes(v);
}

/** Who is asking. A signed-out shopper is `null` everywhere below. */
export interface Viewer {
  customerId: string | null;
  /** Milieus this customer is an ACTIVE member of (pending ones do not count). */
  milieuIds: string[];
}

export const ANONYMOUS: Viewer = { customerId: null, milieuIds: [] };

/**
 * Builds the viewer once per request, rather than per product.
 *
 * "Active membership" is defined ONCE in this codebase — in
 * `milieuService.discountFor` — and this matches it exactly rather than
 * inventing a second, slightly different rule: awaiting approval grants
 * nothing, an expired membership grants nothing, and an expired MILIEU grants
 * nothing either. If that definition changes, both must change together.
 */
export async function viewerFor(customerId: string | null): Promise<Viewer> {
  if (!customerId) return ANONYMOUS;
  const now = new Date();
  const rows = await db.milieuMembership.findMany({
    where: {
      customerId,
      pendingAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      milieu: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
    select: { milieuId: true },
  });
  return { customerId, milieuIds: rows.map((r) => r.milieuId) };
}

export interface Gated {
  visibility: string;
  audiences?: { milieuId: string }[];
  access?: { customerId: string }[];
}

/**
 * May this viewer see this product in a LISTING?
 *
 * `private` is false here on purpose — unlisted means absent from listings,
 * while `canOpenDirectly` still lets the link through. Treating "unlisted" and
 * "listed" as the same thing is how a private product turns up in search.
 */
export function canSee(p: Gated, viewer: Viewer): boolean {
  switch (p.visibility) {
    case 'private':
      return false;
    case 'restricted':
      // OR, not AND: milieus and named accounts combine, so matching either is
      // enough. Requiring both would make every account grant useless unless
      // the person also happened to be in a group.
      return (
        (p.audiences ?? []).some((a) => viewer.milieuIds.includes(a.milieuId)) ||
        (!!viewer.customerId && (p.access ?? []).some((a) => a.customerId === viewer.customerId))
      );
    default:
      return true;
  }
}

/**
 * May this viewer open the product's own URL?
 *
 * Only `private` differs from `canSee`: unlisted is not sealed, which is the
 * point of "share this link with whoever I choose". A restricted product stays
 * closed however the URL was obtained — for those the link is not a credential.
 */
export function canOpenDirectly(p: Gated, viewer: Viewer): boolean {
  return p.visibility === 'private' ? true : canSee(p, viewer);
}

/**
 * May this viewer BUY it? The question the cart and checkout ask.
 *
 * A private product is purchasable by anyone holding the link — that is the
 * point of it. Restricted ones are not, however the id was obtained.
 */
export function canBuy(p: Gated, viewer: Viewer): boolean {
  return canOpenDirectly(p, viewer);
}

/**
 * A Prisma `where` fragment for listings — applied in the QUERY rather than
 * filtered after, so pagination counts stay honest. Filtering a fetched page in
 * memory silently shortens pages and makes "24 products" mean nothing.
 */
export function visibleWhere(viewer: Viewer): Prisma.ProductWhereInput {
  const matches: Prisma.ProductWhereInput[] = [
    ...(viewer.milieuIds.length ? [{ audiences: { some: { milieuId: { in: viewer.milieuIds } } } }] : []),
    ...(viewer.customerId ? [{ access: { some: { customerId: viewer.customerId } } }] : []),
  ];
  return {
    OR: [
      { visibility: 'public' },
      // No qualifying grant at all means no restricted product can match, and
      // an empty OR inside would match EVERYTHING — the failure mode here is
      // exposing the whole restricted catalogue, so it is spelled out.
      ...(matches.length ? [{ visibility: 'restricted', OR: matches }] : []),
    ],
  };
}

/** The relations `canSee` needs. Spread into a product query's `include`. */
export const GATE_INCLUDE = {
  audiences: { select: { milieuId: true } },
  access: { select: { customerId: true } },
} as const;
