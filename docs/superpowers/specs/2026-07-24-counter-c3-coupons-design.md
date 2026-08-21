# Counter C3 — Coupons

2026-07-24. Source: 1.x Counter CouponService.php + Schema.php coupons/coupon_redemptions
(read in full). Scoped to the storefront cart + admin management. Payments doctrine:
coupon and Milieus member discount do NOT stack — best single discount wins (already the
Milieus rule; extended to include coupons).

## 1.x semantics carried
- Coupon: code (unique, nullable for auto-promos — 2.0 v1 = code-only), discountType
  (percent | fixed), amount (minor units for fixed; whole-number pct for percent),
  minimumAmount / maximumAmount (subtotal gates), usageLimit (global), usageLimitPerUser,
  usageCount, individualUse (can't combine), dateStarts / dateExpires, status
  (active|inactive).
- Validate on BOTH apply AND recalc — a coupon can go invalid mid-session (another
  customer exhausts the global limit). Recalc silently drops now-invalid coupons.
- Redemption ledger: on order finalize, applied coupons → coupon_redemptions rows +
  usageCount bump. On refund, redemptions marked released so per-user limits don't burn
  on a refunded order.

## Deliberate 2.0 scope (v1)
- discountType = percent | fixed only (1.x's fixed_product/free_shipping and
  scope=product|variant|vendor deferred — cart-scope coupons first; free_shipping waits
  for the shipping-provider interface).
- Single coupon per cart in v1 (the applied set is [] or [one]) — individualUse is
  therefore always effectively true; the field exists on the model for when multi-coupon
  lands, enforced as "at most one" now.
- No auto-promotions (code required) — the nullable-code branch waits.

## Discount precedence (doctrine — no stacking)
totals pipeline: subtotal → the LARGER of {Milieus member discount, coupon discount}
applies, not both. (Milieus is admin-order-only right now; on the storefront the coupon
is the live path.) `discount` and `coupon` slots in CartTotals stay distinct for display
but only the winner reduces the total. Label names which won.

## Data model
```prisma
enum CouponType { percent fixed }
model Coupon {
  id String @id @default(cuid())
  code String @unique
  type CouponType
  amount Int              // pct (1..100) for percent; minor units for fixed
  minimumAmount Int?      // subtotal gate, minor units
  maximumAmount Int?
  usageLimit Int?         // global
  usageLimitPerUser Int?
  usageCount Int @default(0)
  individualUse Boolean @default(true)
  startsAt DateTime?
  expiresAt DateTime?
  status String @default("active")   // active | inactive
  description String?
  createdAt/updatedAt
  redemptions CouponRedemption[]
}
model CouponRedemption {
  id String @id @default(cuid())
  couponId String
  orderId String
  email String?          // per-user limit tracks by guest email (no accounts yet)
  amount Int             // discount applied on this order, minor units
  appliedAt DateTime @default(now())
  releasedAt DateTime?   // set on refund → frees a per-user slot
  @@unique([couponId, orderId])
}
```

## Backend
- `coupon.schema.ts` — create/update (all optional-no-default on update per the
  partial() footgun rule), applyCode.
- `coupon.service.ts` — admin CRUD; `validate(coupon, subtotal, email)` throwing the 1.x
  reasons; `quote(code, subtotal, email)` → { couponId, amount, label } | throws;
  recordForOrder(orderId, couponId, amount, email) (ledger row + usageCount++, atomic);
  releaseForOrder(orderId) (refund path). Per-user count = active (releasedAt null)
  redemptions for (couponId, email).
- Routes `/api/coupons` admin CRUD (authenticate + storefront-manager bundle) +
  public quote is internal to cart (no standalone public coupon-probe route — avoids an
  enumeration oracle like the Milieus email one).

## Cart integration (C2)
- cartService: `applyCoupon(token, code)` validates + stores couponCode on the session;
  `removeCoupon(token)`. computeTotals: quote the stored code live; if it now fails
  validation, drop it silently (1.x recalc rule) and surface nothing sensitive. Winner
  of {memberDiscount, coupon} reduces total.
- Routes: POST /api/cart/coupon {cartToken, code}, DELETE /api/cart/coupon {cartToken}.
- checkout: after order create, recordForOrder with the realized discount; the order
  stores the coupon discount in its existing discountAmount/Label fields.

## Refund hook
paymentGateway.refund full path → couponService.releaseForOrder(orderId) so a fully
refunded order frees the per-user redemption.

## Tests
apply/validate all reasons (inactive, window, global limit, per-user limit via email,
min/max) · percent vs fixed math · recalc drops a coupon that hit its global limit
mid-session · best-single-wins vs a member discount · redemption ledger on checkout +
usageCount bump · release on refund frees the per-user slot · admin CRUD gated · no
public enumeration route. Then full regression.
