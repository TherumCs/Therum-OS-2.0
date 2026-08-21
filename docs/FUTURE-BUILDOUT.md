# Therum OS 2.0 — Future Buildout List

Standing list per Bam (2026-07-24, voice). These are POST-launch workstreams —
the current task is rounding out 2.0 + finishing Counter so the first site can
ship on the Base Theme.

## Theme system (full-blown)
- Real theme architecture: front-end themes + admin (back-end) themes, native
  to 2.0 — not the deliberately-minimal Base Theme that ships today.
- Theme switching = swap values inside the token layer (the --th-* contract in
  shared/therum-tokens.css already anticipates this — nothing may reach past
  --th-*).
- Eventually: theme marketplace-shaped packaging (parallels the Studio Apps
  registry).

## Native authoring (WordPress 1:1, but faster/better)
- Internal page builder as a first-class 2.0 surface (the current builder/ app
  is the seed; needs block library, templates, full-page layouts, publish flow
  integrated with the site renderer).
- Native post editor (Gutenberg-equivalent, but ours).
- Menus/navigation manager (Base Theme currently auto-builds nav from
  published content; a real menu editor replaces that).
- Widget/section equivalents for theme regions.

## Counter remaining
- C6 money ops: order emails/receipts, sales reports, admin dashboards.
- Catalog presentation: categories, tags, attributes, shop search, product
  images/galleries, descriptions, related products — "1:1 Woo but better."
- Provider fleet growth: PayPal (lights Venmo/PP Credit/wallet), BNPL rails
  (Sezzle/Zip from 1.x modules), crypto rail, Plaid bank.
- Payout routing layer (the WooPayments-logic absorption: unified balance →
  instant payout destination per site, his = Square).
- Shipping/tax via fulfillment providers (POD: Printful etc. quote shipping
  and tax) — NOT a Woo-style zones/rates engine.

## Platform
- Storefront customer accounts (unlocks member pricing at public checkout +
  real per-user coupon enforcement).
- A custom 2.0 build that is fully Woo-compatible (import/bridge posture TBD
  — "we'll figure that out once we cross that bridge").
