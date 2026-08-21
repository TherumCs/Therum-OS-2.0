# The Port Law

**The reference site is TRUTH.** When a store is stood up by porting an existing
site onto the platform (Therum OS), the reference site — the live source being
reproduced, reachable at the URL you configure (e.g. a local mirror on
`http://localhost:<port>`) — is the visual spec. Everything — theme, layout, CSS,
visuals — is PORTED onto the platform. Not redesigned, not approximated, not
reinterpreted.

## Rules

1. **Nothing is invented, assumed, or made up.** If it is not on the reference
   site or in the project folder, it does not get created — no invented class
   names, widget types, paths or designs. Cannot verify it? Say so.
2. **NOTHING ELEMENTOR.** The target platform is **Bricks**. Everything on the
   site must be Bricks or Bricks elements.
3. **The CSS is written for Bricks so it looks exactly like the reference.** The
   reference is the VISUAL spec, not the class vocabulary. Do not import its
   Elementor stylesheet or adopt its class contract.
4. **Templated once.** Header, footer and pages are designed and styled once
   and reused. Counter needs default templates the way Woo ships them
   (shop / PDP / cart / checkout / account).
5. **Fixes must not break layouts, pages or CSS.** `test/rendered-markup.test.mjs`
   is the gate — extend it rather than trusting care.

## Before acting

Quote the instruction the action satisfies, in the requester's words. Cannot
quote it? The action is not authorised. This is step 3 of `_core/loop.md`; it
exists because rules in a file were read after the decision rather than before it.

## Rejected approach — do not re-propose

Porting **Elementor**: a large extract of the reference's Elementor stylesheet, an
element-id → Elementor-class map, and `e-con` / `elementor-widget-*` emitted by the
renderer so those rules would match. It got pixels close and coupled the whole site
to Elementor's class contract, which is the opposite of the instruction and gave
every visual fix a wide blast radius.

## Verifying

Measure, never eyeball. `tools/visual-compare.mjs` and `tools/element-audit.mjs`
compare against the reference site at 1440 / 768 / 390.

## Header parity (example verification)

Measured against the reference at 1440 / 768 / 390. Everything matches:
header box, desktop and mobile variants, logo, cart icon, button row, font
sizes, and the storefront font throughout.

One deliberate difference: `.js-cart-info` and `.js-wishlist-info` — the cart
and wishlist counters. The reference renders them empty at **0px wide**; we
hide them with `.js-cart-info:empty{display:none}` (headerCart.ts). Both are
invisible when the cart is empty, so the rendering is identical; only the
computed `display` differs. The elements are present in our markup and are
populated by the cart runtime.

## Audit result (example)

12 pages x 3 breakpoints (1440 / 768 / 390), every element carrying an id
compared against the reference site.

    ===== 0 FINDINGS =====

Progression, for the record: 2436 -> 285 (markup ported) -> 0 (page template
chrome + storefront font).
