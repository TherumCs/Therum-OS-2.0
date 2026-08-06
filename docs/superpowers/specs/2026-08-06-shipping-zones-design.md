# Shipping: zones, methods, checkout picker, local pickup

**Date:** 2026-08-06
**Status:** approved (design)

## Goal

Replace flat/manual shipping with a zone-based system the shopper can actually
choose from at checkout, configured through **one inline grid** instead of a
Woo-style wizard. US-only for launch. **Keep every connected vendor's real
shipping rates** (Printful, and most PODs quote their own) **and add our own
zone methods on top** — both appear as pickable options at checkout (hybrid).

## What exists today (do not rebuild)

- `shippingRateService.rates()` (`src/counter/shippingRates.ts`) is already
  called by `computeTotals` (`src/services/cart.service.ts:261`) and its result
  is written onto the order (`shippingTotal`). So shipping is already in the
  checkout math and on the order — this project **re-shapes what `rates()`
  returns**, it does not add a new hook.
- Today `rates()` is vendor-first (Printful.quote), then a flat
  `shippingMethods` fallback (Standard free / Express / Overnight). Decision A
  removes the vendor-first pricing path.
- `freeShippingOver` counter setting exists.
- The checkout page already has a "Ship" step; it does **not** yet surface a
  method **picker** the shopper controls. That is the front-end gap.

## Data model

Stored in **counter settings** (JSON), not new tables, matching the existing
`shippingMethods` pattern — except local-pickup eligibility, which is per
product.

- **Zones** — `shippingZones: { id, name, states: string[], isRest: boolean }[]`
  - `states` are 2-letter US codes. Exactly one zone has `isRest: true` — the
    auto **"Rest of US"** catch-all for any state not assigned elsewhere, so a
    destination can never fall through to no rate.
- **Methods** — `shippingMethods: { id, name, detail, enabled, prices: { [zoneId]: cents }, freeOver: number | null }[]`
  - `prices[zoneId]` in minor units; `0` = free. A method missing a price for a
    zone is **not offered** in that zone.
  - `freeOver` (per method, nullable): free when the cart subtotal ≥ this.
- **Local pickup**
  - Per product: a boolean `pickupEligible`, stored on the product's existing
    `meta` JSON (`meta.pickupEligible`) so no schema migration is needed.
  - Global (counter settings): `pickup: { enabled, price: cents, address: string, note: string }`.
  - Offered at checkout **only when every line in the cart is `pickupEligible`**.

## Admin — "better than Woo"

Counter → Settings → Shipping, one screen:

- **The grid.** Methods down the rows, zones across the columns, the price in
  each cell, **edited inline**. No drilling into nested zone→method menus.
- **Add a method** = name + speed detail + on/off.
- **Add a zone** = name + pick its states (a compact US state multi-select;
  a clickable map is a later nicety, not launch).
- **"Rest of US"** row/column is always present and cannot be deleted.
- **Pickup panel** — address, note, fee, and a global on/off.
- **Per-product** — a "Available for local pickup" toggle in ProductStudio.

## Checkout

1. Shopper enters/《confirms》shipping address → resolve **state → zone**
   (fall back to the `isRest` zone).
2. Show that zone's **enabled** methods with their live prices, plus
   **Local Pickup — $X** iff every cart line is `pickupEligible` and pickup is
   enabled.
3. Shopper picks one (radio); the order total updates. Default selection =
   cheapest (free sorts first).
4. The chosen method id is carried on the cart/order exactly as
   `state.shippingMethodId` already is — no new plumbing there.

The **quick-pay wallet sheets** (Apple/Google/Link) must switch from the current
hard-coded free shipping to the resolved rate for the shopper's zone, so the
sheet total equals what is captured. Pickup is not offered inside a wallet sheet
(no address step there) — wallet = delivery only.

## Reconciliation of `rates()` (hybrid: vendor rates + our zones)

`rates(req)` returns the **combined** option list, cheapest first:

1. Resolve the destination state from `req.address` → matching zone (or `isRest`).
2. **Our methods** — that zone's enabled methods as `ShippingRate[]`, applying
   `freeOver`. Always included.
3. **Vendor rates** — keep the existing `PROVIDERS` loop: each connected provider
   (Printful, etc.) that quotes for the cart contributes its rates as options
   (labelled e.g. "Printful Standard"). Source-tagged `provider`.
4. **Pickup** — appended when every cart line is pickup-eligible.

**Single-source rule (launch, keeps it correct + simple):** a vendor's quote
only covers that vendor's items, so vendor rates are offered **only when the
entire cart ships from ONE connected vendor** that quotes it. **Two or more
vendors, or any in-house item → vendor rates are withheld** and only our zone
methods (+ pickup) show, as **one lump sum** for the whole order — so nothing is
under-charged. A single-vendor cart sees that vendor's rates **and** our
methods; the shopper picks (and the vendor's real rate typically undercuts our
flat rate, so simple orders aren't overcharged).

Pricing note: our internal method prices are set for the multi-source
worst case (e.g. Express ~$40 to cover shipments from several places, flat
~$15). Because vendor rates are shown alongside and are usually cheaper for a
single-vendor cart, this only bites on genuinely multi-source orders — which is
the intent. (A later per-line shipping sum can lift the single-vendor
restriction.)

`computeTotals` is unchanged — it still calls `rates()`, picks
`shippingMethodId` (or the cheapest), and writes `ctx.shipping`.

## Out of scope (launch)

- International zones (structure allows it; not built).
- Multiple pickup locations (single address for now).
- Per-product pickup **price** (one global fee).
- Real-time carrier rates / label buying.
- The clickable US map (state multi-select ships first).

## Testing

- `rates()`: a state in a named zone gets that zone's prices; an unassigned
  state gets `isRest`; `freeOver` zeroes the right method; pickup appears only
  when all lines are eligible.
- Checkout: picker renders the resolved zone's methods, total updates on change,
  pickup shows/hides correctly.
- Wallet sheet total == captured total for a non-free zone.
