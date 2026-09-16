// Shared margin-floor guard — used by BOTH the cart (for the figure it displays)
// and order.create (for the figure it actually charges), so a discount can never
// fall below the amount the cart showed the shopper.
//
// A percentage off RETAIL says nothing about whether the sale still makes money:
// 40% off is comfortable on a 4x markup and under water on a 1.6x one, and which
// is which is per product. So the discount is clamped against each line's own
// COST plus the configured minimum margin (Settings > Commerce > minMarginPct).
//
// Clamps the discount to each PRICED line's cost + minimum margin.
//
// The old rule dropped the guard for the WHOLE basket the moment ANY line lacked
// a recorded cost (returned Infinity). That let a shopper add one no-cost line
// (trivial on this store — POD/synced variants have no cost recorded yet) and
// discount the EXPENSIVE real-cost lines below their floor (audit C16). Now the
// discount may only consume the priced lines' margin headroom: unpriced lines are
// neither floored (unknown cost) nor part of the discountable base, so a no-cost
// line can never unclamp a priced one.
//
// Still returns Infinity when NO line has a cost at all — there is nothing to
// floor against. That path is closed properly by recording cost during
// catalogSync/import (the other half of C16), after which POD carts floor too.
export function maxDiscountForMargin(
  lines: { lineTotal: number; quantity: number; cost: number | null }[],
  subtotal: number,
  minMarginPct: number,
): number {
  if (minMarginPct <= 0) return Number.POSITIVE_INFINITY;
  const priced = lines.filter((l): l is { lineTotal: number; quantity: number; cost: number } =>
    typeof l.cost === 'number' && l.cost > 0);
  if (priced.length === 0) return Number.POSITIVE_INFINITY; // no cost data anywhere → cannot floor
  // Discount base = the PRICED lines' retail only. Excluding unpriced lines'
  // totals means a no-cost line adds nothing to discount against and cannot pull
  // a priced line under its floor. (For an all-priced cart this equals subtotal,
  // so behaviour is unchanged there.)
  const pricedSubtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);
  const floor = priced.reduce(
    (sum, l) => sum + Math.ceil(l.cost * l.quantity * (1 + minMarginPct / 100)),
    0,
  );
  void subtotal; // retained in the signature for callers; discount base is pricedSubtotal
  return Math.max(0, pricedSubtotal - floor);
}
