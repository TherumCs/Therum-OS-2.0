import { CURRENCY_CODES } from '../counter/currency.js';
import { z } from 'zod';
import { sortFields } from './listing.js';

export const OrderItemInput = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
});

// Where the parcel goes. Field names match the Address model and what
// shipmentService/orderTracking already read (line1/line2/city/region/
// postalCode/country) — inventing a shape here would mean collecting an
// address that fulfillment cannot see, which is worse than not collecting one.
//
// `name` is the one addition: Address hangs off a Customer who has a name, but
// a GUEST order has no customer, so the recipient would otherwise be unknown
// on exactly the orders most likely to be guest checkouts.
//
// region and postalCode are optional because plenty of countries have neither;
// line1, city and country are the irreducible minimum for a label.
export const ShipAddressInput = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  // ISO-3166 alpha-2. Uppercased on the way in so 'us' and 'US' are one value.
  country: z.string().length(2).transform((c) => c.toUpperCase()),
  phone: z.string().max(40).optional(),
});

export const CreateOrderInput = z.object({
  customerId: z.string().optional(),
  // Two-decimal currencies only for now — zero-decimal (JPY/KRW/…) needs
  // explicit minor-unit normalization at each gateway before it's allowed
  // in (audit M-4). Expand deliberately, not by accepting any 3 letters.
  // Derived from the currency catalog rather than a second hand-maintained
  // list — the two had already drifted (the catalog supports 18, this allowed
  // 5), so a store set to JPY could not create an order in its own currency.
  currency: z.enum(CURRENCY_CODES).default('USD'),
  // Optional client-supplied idempotency key — re-POST with the same key
  // returns the original order instead of creating a duplicate.
  idempotencyKey: z.string().max(200).optional(),
  // Guest contact email (storefront checkout) — receipt address only, never
  // resolved to a customer account (audit H-1).
  guestEmail: z.string().email().max(320).optional(),
  // Optional at the schema level: admin-created and imported orders do not
  // always have one, and the Woo importer writes its own. The STOREFRONT
  // requires it — see the check in order.service.create.
  shipAddress: ShipAddressInput.optional(),
  /** Shipping and tax as quoted at checkout, in minor units. Added to the
   *  order total — without them the order charges the bare item subtotal. */
  shippingTotal: z.number().int().min(0).optional(),
  taxTotal: z.number().int().min(0).optional(),
  shippingMethod: z.string().max(80).optional(),
  // Pre-resolved member discount from the storefront cart. When present (even
  // as null = "no member discount"), create() uses it VERBATIM instead of
  // recomputing from milieuService — so the order charges exactly the
  // margin-floor-clamped, per-product-opt-out-respecting figure the cart
  // displayed. Omitted entirely (undefined) by admin/import orders, which then
  // compute the member discount internally. This is the fix for the cart-shows-X
  // / order-charges-Y divergence.
  discountOverride: z
    .object({ amount: z.number().int().min(0), pct: z.number().min(0).max(100), label: z.string().max(120) })
    .nullable()
    .optional(),
  // First-touch attribution source, written to order.meta.source so the
  // dashboard can report where orders came from.
  source: z.string().max(200).optional(),
  items: z.array(OrderItemInput).min(1, 'an order needs at least one item'),
});

export const TransitionOrderInput = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'failed', 'cancelled']),
});

export const ListOrdersQuery = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'failed', 'cancelled']).optional(),
  customerId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  ...sortFields(['createdAt', 'number', 'status', 'total'], 'createdAt'),
});

export type ShipAddressInput = z.infer<typeof ShipAddressInput>;
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
export type TransitionOrderInput = z.infer<typeof TransitionOrderInput>;
export type ListOrdersQuery = z.infer<typeof ListOrdersQuery>;
