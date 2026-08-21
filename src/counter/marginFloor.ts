// Shared margin-floor guard — used by BOTH the cart (for the figure it displays)
// and order.create (for the figure it actually charges), so a discount can never
// fall below the amount the cart showed the shopper.
//
// A percentage off RETAIL says nothing about whether the sale still makes money:
// 40% off is comfortable on a 4x markup and under water on a 1.6x one, and which
// is which is per product. So the discount is clamped against each line's own
// COST plus the configured minimum margin (Settings > Commerce > minMarginPct).
//
// Returns Infinity (no cap) when the floor cannot be meaningfully applied:
// minMarginPct <= 0, or ANY line lacks a positive recorded cost — guessing a
// cost is worse than not guarding, so a mixed basket where one line has no cost
// is left unclamped rather than clamped on a fabricated number.
export function maxDiscountForMargin(
  lines: { lineTotal: number; quantity: number; cost: number | null }[],
  subtotal: number,
  minMarginPct: number,
): number {
  if (minMarginPct <= 0) return Number.POSITIVE_INFINITY;
  const priced = lines.filter((l): l is { lineTotal: number; quantity: number; cost: number } =>
    typeof l.cost === 'number' && l.cost > 0);
  if (priced.length !== lines.length || priced.length === 0) return Number.POSITIVE_INFINITY;
  const floor = priced.reduce(
    (sum, l) => sum + Math.ceil(l.cost * l.quantity * (1 + minMarginPct / 100)),
    0,
  );
  return Math.max(0, subtotal - floor);
}
