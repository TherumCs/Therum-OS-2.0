# The Port Law — sidemoney.co

**`http://localhost:10025` is TRUTH.** sidemoney.co runs a new platform
(Therum OS). Everything — theme, layout, CSS, visuals — is PORTED onto it.
Not redesigned, not approximated, not reinterpreted.

## Rules

1. **Nothing is invented, assumed, or made up.** If it is not on :10025 or in
   the project folder, it does not get created — no invented class names,
   widget types, paths or designs. Cannot verify it? Say so.
2. **NOTHING ELEMENTOR.** The target platform is **Bricks**. Everything on the
   site must be Bricks or Bricks elements.
3. **The CSS is written for Bricks so it looks exactly like :10025.** The
   reference is the VISUAL spec, not the class vocabulary. Do not import its
   Elementor stylesheet or adopt its class contract.
4. **Templated once.** Header, footer and pages are designed and styled once
   and reused. Counter needs default templates the way Woo ships them
   (shop / PDP / cart / checkout / account).
5. **Fixes must not break layouts, pages or CSS.** `test/rendered-markup.test.mjs`
   is the gate — extend it rather than trusting care.

## Before acting

Quote the instruction the action satisfies, in the user's words. Cannot quote
it? The action is not authorised. This is step 3 of `_core/loop.md`; it exists
because rules in a file were read after the decision rather than before it.

## Rejected approach — do not re-propose

Porting **Elementor**: a 904KB extract of the reference's Elementor stylesheet,
a 546-entry element-id → Elementor-class map, and `e-con` /
`elementor-widget-*` emitted by the renderer so those rules would match. It got
pixels close and coupled the whole site to Elementor's class contract, which is
the opposite of the instruction and gave every visual fix a wide blast radius.

## Verifying

Measure, never eyeball. `tools/visual-compare.mjs` and `tools/element-audit.mjs`
compare against :10025 at 1440 / 768 / 390.

## Header parity (verified 2026-08-04)

Measured against the reference at 1440 / 768 / 390. Everything matches:
header box, desktop and mobile variants, logo, cart icon, button row, font
sizes, and Manrope throughout.

One deliberate difference: `.js-cart-info` and `.js-wishlist-info` — the cart
and wishlist counters. The reference renders them empty at **0px wide**; we
hide them with `.js-cart-info:empty{display:none}` (headerCart.ts). Both are
invisible when the cart is empty, so the rendering is identical; only the
computed `display` differs. The elements are present in our markup and are
populated by the cart runtime.

## Audit result — 2026-08-04

12 pages x 3 breakpoints (1440 / 768 / 390), every element carrying an id
compared against localhost:10025.

    ===== 0 FINDINGS =====

Progression, for the record: 2436 -> 285 (markup ported) -> 0 (page template
chrome + storefront font).
