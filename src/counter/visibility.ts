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
 *   members    — hidden from the public, visible to EVERY signed-in shopper
 *                (no milieu or grant needed). A logged-in operator counts too —
 *                see `isStaff` below.
 */
export type Visibility = 'public' | 'private' | 'restricted' | 'members';

/** Who is asking. A signed-out shopper is `null` everywhere below. */
export interface Viewer {
  customerId: string | null;
  /** Milieus this customer is an ACTIVE member of (pending ones do not count). */
  milieuIds: string[];
  /**
   * A signed-in operator (valid admin session) browsing the live storefront.
   * They have no customer row, but "logged in" is exactly what they are, so
   * they see the `members` tier — the operator must be able to preview the
   * products they just pushed without registering a second, customer account.
   * Deliberately does NOT unlock `restricted` (that needs a real milieu/grant)
   * or `private` (unlisted by definition).
   */
  isStaff?: boolean;
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
export async function viewerFor(customerId: string | null, opts?: { isStaff?: boolean }): Promise<Viewer> {
  const isStaff = !!opts?.isStaff;
  // A signed-in operator with no customer row still counts as logged in.
  if (!customerId) return { customerId: null, milieuIds: [], isStaff };
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
  return { customerId, milieuIds: rows.map((r) => r.milieuId), isStaff };
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
    case 'members':
      // The "logged-in can see it" tier: hidden from the public, open to EVERY
      // signed-in shopper (broader than restricted, which needs a milieu/grant).
      // A signed-in operator counts as logged in too — they preview the live
      // site with the same access as a customer, without a customer account.
      return !!viewer.customerId || !!viewer.isStaff;
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
      // 'members' — visible to ANY signed-in shopper (customer OR operator),
      // never to the public.
      ...(viewer.customerId || viewer.isStaff ? [{ visibility: 'members' }] : []),
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
