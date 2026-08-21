# Shipping Zones + Methods + Checkout Picker + Local Pickup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a zone-based shipping system — named state-grouped zones, methods with per-zone prices, a customer-facing checkout picker, per-product local pickup, and a hybrid rate engine (connected-vendor rates for single-vendor carts, our internal zone rates otherwise).

**Architecture:** Config lives in counter settings (JSON) — no DB migration except per-product `meta.pickupEligible`. `shippingRateService.rates()` is rewritten to resolve destination state → zone, return that zone's methods, add single-vendor provider rates + pickup. `computeTotals` already consumes `rates()` unchanged. Admin is one inline grid in Counter. Checkout surfaces a radio picker. Wallet sheets use the resolved rate.

**Tech Stack:** TS + Fastify + Prisma 7 (Postgres) API; Next.js admin; server-rendered storefront runtime strings.

## Global Constraints

- US-only; international out of scope.
- Money is integer minor units (cents) everywhere.
- Storefront runtime code lives inside template-literal strings: **no `${` or backticks or `\'` in embedded JS** — validate every touched runtime with `node --check` (see Task 5/6 verify).
- Every deploy: `npm run build` (exit 0, no `error TS`) → runtime syntax check → `rsync -Rz dist/... src/...` to `therum@2.25.93.243:~/therum/` → `pm2 reload`. Admin: rsync `admin/`, `npm --prefix admin run build` on box, `pm2 reload therum-cms-admin`.
- Prisma client is the app's configured `db` (driver adapter) — scripts must `import { db } from './dist/lib/db.js'`, never `new PrismaClient()`.

## File structure

- `src/schemas/settings.schema.ts` — add `shippingZones`, reshape `shippingMethods`, add `pickup`.
- `src/services/settings.service.ts` — CounterSettings types + defaults for the above.
- `src/counter/shippingRates.ts` — rewrite `rates()`; add `resolveZone()`, keep `PROVIDERS`.
- `src/api/routes/counter.ts` — `/shop/shipping/rates` input already exists; ensure it passes address through.
- `src/site/checkoutFlow.ts` — render the method picker + wire selection → `/cart/shipping` → totals.
- `src/site/productGrid.ts` (or storefront PDP) — nothing; pickup toggle is admin-side.
- `admin/app/(app)/settings/*` — shipping grid page (new) or extend the existing shipping settings.
- `admin/app/(app)/products/[id]/ProductStudio.tsx` — "Available for local pickup" toggle.

---

### Task 1: Settings model — zones, per-zone method prices, pickup

**Files:**
- Modify: `src/schemas/settings.schema.ts`
- Modify: `src/services/settings.service.ts`

**Interfaces:**
- Produces: `shippingZones: { id: string; name: string; states: string[]; isRest: boolean }[]`, `shippingMethods: { id: string; name: string; detail: string; enabled: boolean; prices: Record<string, number>; freeOver: number | null }[]`, `pickup: { enabled: boolean; price: number; address: string; note: string }`.

- [ ] **Step 1: schema** — in `settings.schema.ts` (counter section) add:
```ts
shippingZones: z.array(z.object({
  id: z.string(), name: z.string().max(60),
  states: z.array(z.string().length(2)), isRest: z.boolean().optional(),
})).optional(),
shippingMethods: z.array(z.object({
  id: z.string(), name: z.string().max(60), detail: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
  prices: z.record(z.string(), z.number().int().min(0)).optional(),
  freeOver: z.number().int().min(0).nullable().optional(),
})).optional(),
pickup: z.object({
  enabled: z.boolean(), price: z.number().int().min(0),
  address: z.string().max(300), note: z.string().max(300),
}).optional(),
```
(If `shippingMethods` already exists with a flat `amount`, replace its shape with the above; migrate old `amount` → `prices['rest']` in the service getter.)

- [ ] **Step 2: service types + defaults** — in `settings.service.ts` CounterSettings add the three fields; defaults:
```ts
shippingZones: [{ id: 'rest', name: 'Rest of US', states: [], isRest: true }],
shippingMethods: [
  { id: 'standard', name: 'Standard', detail: '5–7 business days', enabled: true, prices: { rest: 0 }, freeOver: null },
  { id: 'express', name: 'Express', detail: '2–3 business days', enabled: true, prices: { rest: 999 }, freeOver: null },
],
pickup: { enabled: false, price: 0, address: '', note: '' },
```

- [ ] **Step 3: build gate** — `npm run build`; expect exit 0, no `error TS`.
- [ ] **Step 4: commit** — `git add -A && git commit -m "Shipping: zone/method/pickup settings model"`.

---

### Task 2: Rate engine — zone resolution + hybrid rates

**Files:**
- Modify: `src/counter/shippingRates.ts`

**Interfaces:**
- Consumes: settings from Task 1.
- Produces: `rates(req)` returns `ShippingRate[]` where each has `{ id, name, detail, amount, source: 'zone'|'provider'|'pickup', taxAmount }`; `resolveZone(state, zones)` returns a `Zone`.

- [ ] **Step 1: resolveZone** — add:
```ts
function resolveZone(state: string, zones: Zone[]): Zone {
  const s = (state || '').toUpperCase();
  return zones.find(z => !z.isRest && z.states.includes(s))
      ?? zones.find(z => z.isRest)
      ?? zones[0];
}
```

- [ ] **Step 2: rewrite `rates()`** — order: our zone methods first, then single-vendor provider rates, then pickup:
```ts
async rates(req: RateRequest): Promise<ShippingRate[]> {
  const counter = await settingsService.getCounter();
  const zones = counter.shippingZones ?? [];
  const zone = resolveZone(req.address?.region ?? req.address?.state ?? '', zones);
  const out: ShippingRate[] = [];

  // (a) our zone methods
  for (const m of (counter.shippingMethods ?? [])) {
    if (m.enabled === false) continue;
    const base = m.prices?.[zone.id];
    if (base == null) continue;                        // not offered in this zone
    const free = m.freeOver != null && m.freeOver > 0 && req.subtotal >= m.freeOver;
    out.push({ id: `zone:${m.id}`, name: m.name, detail: m.detail ?? '', amount: free ? 0 : base, source: 'zone', taxAmount: null });
  }

  // (b) single-vendor provider rates: only if the WHOLE cart is one vendor's
  const singleVendor = req.lines && req.lines.length > 0
    && req.lines.every(l => l.vendor && l.vendor === req.lines[0].vendor) ? req.lines[0].vendor : null;
  if (singleVendor) {
    for (const provider of PROVIDERS) {
      if (provider.id() !== singleVendor) continue;
      const quoted = await provider.quote(req).catch(() => []);
      for (const q of quoted) out.push({ ...q, id: `provider:${q.id}`, source: 'provider' });
    }
  }

  // (c) local pickup — only when every line is pickup-eligible
  const pk = counter.pickup;
  if (pk?.enabled && req.lines && req.lines.length > 0 && req.lines.every(l => l.pickupEligible)) {
    out.push({ id: 'pickup', name: 'Local pickup', detail: pk.note || pk.address, amount: pk.price, source: 'pickup', taxAmount: null });
  }

  return out.sort((a, b) => a.amount - b.amount);
}
```
(Extend `RateRequest.lines` items to carry `vendor?: string` and `pickupEligible?: boolean`; populate from the cart in `computeTotals` — see Task 3.)

- [ ] **Step 3: build gate**; commit `"Shipping: hybrid rate engine — zone + single-vendor provider + pickup"`.

---

### Task 3: Feed the engine — cart lines carry vendor + pickup

**Files:**
- Modify: `src/services/cart.service.ts` (the `rates()` call ~line 261)
- Modify: `src/api/routes/counter.ts` (`/shop/shipping/rates` input — pass `lines` with vendor + pickupEligible)

- [ ] **Step 1** — where `computeTotals` builds the rate request, include per-line `vendor` (from the product's fulfilment provider) and `pickupEligible` (`product.meta.pickupEligible === true`). Exact: add to the `.map` that builds `lines`.
- [ ] **Step 2** — `/shop/shipping/rates` route: accept `lines[].vendor`, `lines[].pickupEligible` (optional) and forward.
- [ ] **Step 3: build gate**; commit `"Shipping: cart lines carry vendor + pickup flags"`.

---

### Task 4: Admin — the shipping grid + zone editor + pickup panel

**Files:**
- Create/Modify: `admin/app/(app)/settings/shipping/` page (or extend existing shipping settings)
- Modify: `admin/app/(app)/products/[id]/ProductStudio.tsx` (pickup toggle)

- [ ] **Step 1: grid** — methods as rows, zones as columns, a `$` number input per cell writing `shippingMethods[i].prices[zoneId]`; add-method (name + detail + on/off) and add-zone (name + a US-state multi-select) controls; the `isRest` zone always present, undeletable. Save via the existing counter-settings PATCH.
- [ ] **Step 2: pickup panel** — enabled toggle, price (dollars→cents), address, note.
- [ ] **Step 3: product pickup toggle** — in ProductStudio, a checkbox bound to `meta.pickupEligible`, PATCHed to `/api/products/:id` meta.
- [ ] **Step 4: admin build** on box (exit 0); reload therum-cms-admin; commit `"Shipping: admin grid + zone editor + pickup"`.

---

### Task 5: Checkout picker (storefront)

**Files:**
- Modify: `src/site/checkoutFlow.ts`

- [ ] **Step 1** — after the shipping address is entered, call `/api/shop/shipping/rates` with the cart + address; render the returned rates as a **radio group** (name, detail, price). Preselect the cheapest. On change, POST `/cart/shipping` with `methodId` and re-read totals so the order summary updates.
- [ ] **Step 2** — pickup radio shows `Local pickup — $X · <address>` when returned; selecting it hides the shipping-address requirement is out of scope (still collect address for contact).
- [ ] **Step 3: runtime syntax check** — `node -e "require('fs').writeFileSync('/tmp/rt.js', require('./dist/site/checkoutFlow.js').CHECKOUT_FLOW_RUNTIME || '')" && node --check /tmp/rt.js` (adjust export name); build gate; deploy; browser-verify the picker changes the total.
- [ ] **Step 4: commit** `"Shipping: checkout method picker"`.

---

### Task 6: Wallet sheets use the resolved rate

**Files:**
- Modify: `src/site/productGrid.ts` (the Stripe `paymentRequest` shipping options — currently hard-coded free)

- [ ] **Step 1** — in `initStripeWallets`/`onWalletPaymentMethod`, on `shippingaddresschange` call `/api/shop/shipping/rates` for the sheet's address and `ev.updateWith({ shippingOptions, total })` so the sheet total == the captured total; drop the hard-coded free option.
- [ ] **Step 2: runtime syntax check** on `CARD_EVOLVE_RUNTIME` (`node --check`); build gate; deploy.
- [ ] **Step 3: browser-verify** all wallets still render; commit `"Shipping: wallet sheets quote the resolved rate"`.

---

### Task 7: End-to-end verify + seed a real zone set

- [ ] **Step 1** — in Counter, create a couple real zones (e.g. West Coast: CA OR WA; East: NY NJ MA) + prices; set Express/Standard; enable pickup on one product.
- [ ] **Step 2** — browser: checkout to a CA address shows the West-Coast prices; a TX address falls to Rest-of-US; an all-Printful cart also shows Printful's rate; pickup appears only on the eligible product.
- [ ] **Step 3** — verify order total == charged (card path) and wallet sheet total.
- [ ] **Step 4: commit** `"Shipping: verified zones + methods + pickup live"`.
