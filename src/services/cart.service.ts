import { randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import type { ShipAddressInput } from '../schemas/order.schema.js';
import { redis } from '../lib/redis.js';
import { orderService } from './order.service.js';
import { contextFor, defaultPipeline } from '../counter/totalsPipeline.js';
import { shippingRateService } from '../counter/shippingRates.js';
import { settingsService } from './settings.service.js';
import { couponService } from './coupon.service.js';
import { milieuService } from './milieu.service.js';
import { capabilityService } from './capability.service.js';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';
import { availableOf } from '../counter/availability.js';
import { canBuy, viewerFor, GATE_INCLUDE } from '../counter/visibility.js';

// Counter C2 — the unified cart/checkout session (1.x's core
// differentiator: cart and checkout are ONE state container, two render
// modes — not two subsystems). Sessions are Redis-backed and LAZY: nothing
// is created until the first add-to-cart, so anonymous browsing has zero
// session overhead (1.x readme rule).
//
// Prices are NEVER stored in the session — totals are computed live from
// the catalog on every read, so a price change between add and checkout is
// always reflected. The session holds only intent: variant ids + quantities
// (+ optional coupon code and customer identity for discounts).

const TTL_SECONDS = 7 * 24 * 3600; // sliding 7-day cart life
const MAX_LINES = 50;
const MAX_QTY = 999;

export interface CartLine {
  variantId: string;
  quantity: number;
}

interface CartState {
  id: string;
  items: CartLine[];
  couponCode?: string | null;
  customerEmail?: string | null;
  /**
   * Written ONLY from a verified customer session (never from a typed email),
   * so a group-restricted coupon survives the recalc that runs on every cart
   * read. Distinct from customerEmail for exactly the reason audit H-1 gives:
   * one is proof of identity, the other is a receipt address.
   */
  customerId?: string | null;
  /**
   * Destination and chosen speed, kept on the CART so totals reflect what the
   * shopper will actually be charged before they pay. Without this, shipping
   * was quoted only after the order existed — the total agreed to at checkout
   * was not the total owed.
   */
  shipAddress?: ShipAddressInput | null;
  shippingMethodId?: string | null;
  createdAt: string;
}

export interface CartTotals {
  lines: {
    variantId: string;
    productName: string;
    /** For the line's link back to the PDP. */
    productSlug: string;
    /** Primary product image, so a cart line can show what was bought. */
    image: string | null;
    sku: string | null;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    available: number;
  }[];
  subtotal: number;
  // Milieus member discount — largest single milieu, no stacking (doctrine).
  discount: { amount: number; label: string } | null;
  // C3 (coupons) and C5+ (shipping/tax providers) land in these slots — the
  // pipeline shape is stable now so the storefront doesn't churn later.
  coupon: { amount: number; code: string } | null;
  /**
   * Why a coupon is not in play, when the shopper might reasonably expect one
   * to be. Present so the cart can SAY it rather than silently dropping a code
   * the shopper typed.
   */
  couponBlocked: string | null;
  /**
   * Set when a discount was reduced to keep the order above the margin floor
   * (Settings > Commerce > minMarginPct). The merchant needs to know their
   * 40% only paid out as 31% on this basket; the shopper is simply told the
   * amount that applied.
   */
  discountClamped: { requested: number; applied: number } | null;
  shipping: number;
  tax: number;
  total: number;
}

const key = (token: string): string => `counter:cart:${token}`;

async function load(token: string): Promise<CartState> {
  const raw = await redis.get(key(token));
  if (!raw) throw new NotFoundError('Cart not found or expired', 'cart');
  // Guard the parse (audit L-3): only this service writes cart values, so a
  // malformed one means Redis-level corruption — treat it as an expired cart
  // and reset, not a 500.
  try {
    const state = JSON.parse(raw) as CartState;
    if (!state || !Array.isArray(state.items) || typeof state.id !== 'string') throw new Error('shape');
    return state;
  } catch {
    await redis.del(key(token));
    throw new NotFoundError('Cart not found or expired', 'cart');
  }
}

async function save(state: CartState): Promise<void> {
  await redis.set(key(state.id), JSON.stringify(state), 'EX', TTL_SECONDS);
}

async function computeTotals(state: CartState): Promise<CartTotals> {
  const variantIds = state.items.map((i) => i.variantId);
  const variants = variantIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: { select: { name: true, slug: true, image: true, status: true } } },
      })
    : [];
  const byId = new Map(variants.map((v) => [v.id, v]));

  const lines = state.items
    .filter((i) => byId.has(i.variantId))
    .map((i) => {
      const v = byId.get(i.variantId)!;
      return {
        variantId: i.variantId,
        productName: v.product.name,
        productSlug: v.product.slug,
        image: v.product.image,
        sku: v.sku,
        color: v.color,
        size: v.size,
        quantity: i.quantity,
        unitPrice: v.price,
        lineTotal: v.price * i.quantity,
        available: availableOf(v),
      };
    });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const commerce = await settingsService.getCommerce();

  // Member discount. Still deliberately NOT derived from a typed storefront
  // email (audit H-1/M-2): an anonymous cart supplying an arbitrary address
  // must not inherit another customer's membership, and returning a discount
  // for a guessed email is a membership/PII enumeration oracle.
  //
  // What changed is that there is now a way to know: state.customerId is
  // written ONLY from a verified customer session. That is the proof the rule
  // was waiting for, so the benefit finally reaches the storefront cart
  // instead of appearing for the first time on the order.
  let discount: CartTotals['discount'] = null;
  if (state.customerId && (await capabilityService.isEnabled('memberships'))) {
    const m = await milieuService.discountFor(state.customerId);
    if (m) {
      discount = {
        amount: Math.round(subtotal * (m.pct / 100)),
        label: `${m.milieuName} (${m.pct}%)`,
      };
    }
  }

  // Coupon (C3): quoted live from the stored code every recalc; a coupon
  // that has gone invalid mid-session (limit hit elsewhere, expired) is
  // dropped silently (1.x recalc rule) via quoteOrNull.
  //
  // MEMBER PRICE IS A FLOOR, NOT A CANDIDATE. Bam's rule: "if you're getting
  // my special member price, there is no stacking of coupons — that's the
  // cheapest I can get it for." So a member's coupon is not quoted at all,
  // rather than quoted and then beaten. The pipeline's own rule is
  // best-single-wins, which would have let a LARGER coupon replace the member
  // price — the opposite of a floor.
  let coupon: CartTotals['coupon'] = null;
  let couponBlocked: string | null = null;
  if (state.couponCode && discount) {
    couponBlocked = 'Your member price is already applied — codes do not stack on top of it.';
  } else if (state.couponCode) {
    const q = await couponService.quoteOrNull(state.couponCode, subtotal, state.customerEmail ?? null, state.customerId ?? null);
    if (q) coupon = { amount: q.amount, code: q.code };
  }

  // Totals go through Counter's pipeline rather than inline arithmetic here.
  // Same numbers, but the ORDER of operations (discount before shipping and
  // tax; best-single-wins, no stacking) now lives in one declared list that
  // checkout and every other caller share — see src/counter/totalsPipeline.ts.
  // It also rounds per step, so the total is the sum of the figures actually
  // shown to the customer instead of drifting a penny off them.
  // ── MARGIN FLOOR ────────────────────────────────────────────────────────
  //
  // A percentage off RETAIL says nothing about whether the sale still makes
  // money. 40% off is comfortable on a 4x markup and under water on a 1.6x
  // one, and which is which is per product — Bam's point exactly: "that
  // percentage is based on the price I get the product for."
  //
  // So the discount is clamped against each line's own COST. Lines with no
  // cost recorded are excluded from the floor rather than assumed free:
  // guessing a cost is worse than not guarding.
  let maxDiscount = Number.POSITIVE_INFINITY;
  if (commerce.minMarginPct > 0) {
    const priced = lines
      .map((l) => ({ line: l, cost: byId.get(l.variantId)?.cost ?? null }))
      .filter((x): x is { line: (typeof lines)[number]; cost: number } => typeof x.cost === 'number' && x.cost > 0);
    if (priced.length === lines.length && priced.length > 0) {
      // Every line has a cost, so a floor for the whole basket is meaningful.
      const floor = priced.reduce(
        (sum, x) => sum + Math.ceil(x.cost * x.line.quantity * (1 + commerce.minMarginPct / 100)),
        0,
      );
      maxDiscount = Math.max(0, subtotal - floor);
    }
  }

  const candidates: { amount: number; label: string }[] = [];
  if (discount) candidates.push(discount);
  if (coupon) candidates.push({ amount: coupon.amount, label: coupon.code });

  // Clamp before the pipeline runs, so the figure shown IS the figure applied.
  let discountClamped: CartTotals['discountClamped'] = null;
  if (Number.isFinite(maxDiscount)) {
    for (const c of candidates) {
      if (c.amount > maxDiscount) {
        discountClamped = { requested: c.amount, applied: maxDiscount };
        c.amount = maxDiscount;
      }
    }
    if (discount && discount.amount > maxDiscount) discount = { ...discount, amount: maxDiscount };
    if (coupon && coupon.amount > maxDiscount) coupon = { ...coupon, amount: maxDiscount };
  }

  const storeCurrency = commerce.currency;
  const ctx = contextFor(
    lines.map((l, i) => ({
      itemId: String(i),
      productId: l.variantId,
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    storeCurrency,
  );
  // Shipping and tax are set BEFORE the pipeline runs: its shipping/tax steps
  // round and total whatever is in the context, they do not source it. That is
  // the seam a provider plugs into.
  //
  // Uses the LOCAL subtotal, not ctx.subtotal: subtotalStep runs inside the
  // pipeline below, so ctx.subtotal is still 0 here. Reading it computed tax on
  // zero and silently returned 0 for every cart — shipping hid the bug, because
  // a flat rate does not depend on the subtotal.
  if (state.shipAddress) {
    const rates = await shippingRateService.rates({
      lines: ctx.lines,
      subtotal,
      currency: storeCurrency,
      address: state.shipAddress,
    });
    const chosen = rates.find((r) => r.id === state.shippingMethodId) ?? rates[0];
    if (chosen) {
      ctx.shipping = chosen.amount;
      // A provider that quotes its own tax wins over the configured rate.
      ctx.tax =
        typeof chosen.taxAmount === 'number'
          ? chosen.taxAmount
          : await shippingRateService.tax(Math.max(0, subtotal - (discount?.amount ?? 0)));
    }
  }
  await defaultPipeline(candidates).run(ctx);

  return {
    lines,
    subtotal: ctx.subtotal,
    discount,
    coupon,
    couponBlocked,
    discountClamped,
    shipping: ctx.shipping,
    tax: ctx.tax,
    total: ctx.total,
  };
}

export const cartService = {
  // Lazy create: first add-to-cart with no token mints the session.
  async addItem(token: string | null, variantId: string, quantity: number, customerId: string | null = null) {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true, visibility: true, ...GATE_INCLUDE } } },
    });
    if (!variant || variant.product.status !== 'active') {
      throw new NotFoundError('Product not available', 'variantId');
    }
    /**
     * Visibility is enforced HERE, not only in the listings.
     *
     * Hiding a restricted product from /shop while this endpoint still accepts
     * its variant id is not privacy — anyone who has ever seen the id keeps
     * access forever, and ids leak through old carts, shared links and the API.
     *
     * The same NotFoundError as a missing product on purpose: a distinct
     * "you are not allowed" reply would confirm the product exists to someone
     * who is not supposed to know that.
     */
    if (!canBuy(variant.product, await viewerFor(customerId))) {
      throw new NotFoundError('Product not available', 'variantId');
    }
    if (quantity < 1 || quantity > MAX_QTY) throw new ValidationError(`Quantity must be 1–${MAX_QTY}.`, 'quantity');

    const state: CartState = token
      ? await load(token)
      : { id: randomBytes(16).toString('hex'), items: [], createdAt: new Date().toISOString() };
    if (customerId) state.customerId = customerId;

    const existing = state.items.find((i) => i.variantId === variantId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY);
    } else {
      if (state.items.length >= MAX_LINES) throw new ValidationError(`Carts hold at most ${MAX_LINES} lines.`, 'variantId');
      state.items.push({ variantId, quantity });
    }
    await save(state);
    return { token: state.id, totals: await computeTotals(state) };
  },

  async setQuantity(token: string, variantId: string, quantity: number) {
    if (quantity < 0 || quantity > MAX_QTY) throw new ValidationError(`Quantity must be 0–${MAX_QTY}.`, 'quantity');
    const state = await load(token);
    const line = state.items.find((i) => i.variantId === variantId);
    if (!line) throw new NotFoundError('Item not in cart', 'variantId');
    if (quantity === 0) {
      state.items = state.items.filter((i) => i.variantId !== variantId);
    } else {
      line.quantity = quantity;
    }
    await save(state);
    return { token: state.id, totals: await computeTotals(state) };
  },

  /**
   * `customerId` is supplied by the route from a verified session, so a cart
   * started while signed out picks up member pricing the moment its owner
   * signs in — rather than only at the next coupon or checkout.
   */
  async get(token: string, customerId: string | null = null) {
    const state = await load(token);
    if (customerId && state.customerId !== customerId) state.customerId = customerId;
    await save(state); // sliding TTL — an active cart doesn't expire mid-shop
    return { token: state.id, customerEmail: state.customerEmail ?? null, totals: await computeTotals(state) };
  },

  // Attach a guest contact email — the receipt address only (audit H-1): it
  // does NOT look up or bind an existing customer, and grants no membership
  // benefit. Kept on the session, written to Order.guestEmail at checkout.
  async setIdentity(token: string, email: string) {
    const state = await load(token);
    state.customerEmail = email;
    await save(state);
    return { token: state.id, totals: await computeTotals(state) };
  },

  // Apply a coupon code — hard-validates (throws the reason if invalid), then
  // stores the code on the session. Recalc re-quotes it live every read.
  async applyCoupon(token: string, code: string, customerId: string | null = null) {
    const state = await load(token);
    // Remember WHO applied it, so the recalc on every later cart read can
    // re-check a group restriction without the session being present again.
    if (customerId) state.customerId = customerId;
    const totals = await computeTotals(state);
    // Refused BEFORE the code is looked up. Two reasons: the shopper should be
    // told why rather than watching a valid code do nothing, and checking
    // membership first means this cannot be used to probe whether a code
    // exists (the uniform "not valid" in coupon.service exists for that).
    if (totals.discount) {
      throw new ValidationError(
        'Your member price is already applied — codes do not stack on top of it.',
        'code',
      );
    }
    await couponService.quote(code, totals.subtotal, state.customerEmail ?? null, state.customerId ?? null); // throws if invalid
    state.couponCode = code;
    await save(state);
    return { token: state.id, totals: await computeTotals(state) };
  },

  async removeCoupon(token: string) {
    const state = await load(token);
    state.couponCode = null;
    await save(state);
    return { token: state.id, totals: await computeTotals(state) };
  },

  async clear(token: string): Promise<void> {
    await redis.del(key(token));
  },

  // The cart→order handoff. Validates live stock, creates the order through
  // the REAL order service (inventory reservation, Milieus discount, access
  // token — all existing machinery), then clears the session. The cart token
  // doubles as the order idempotency key: a double-submitted checkout
  // returns the SAME order instead of reserving stock twice.
  /**
   * `customerId` is only ever supplied by the route after resolving a real
   * customer SESSION — never from the typed checkout email. That distinction
   * is the whole of audit H-1: an unverified email must not bind an order to
   * an account (or inherit its member pricing), but a verified session is
   * exactly the proof that rule was waiting for.
   */
  /**
   * Destination and chosen speed. Returns the rates that apply so the caller
   * can render the picker and the recomputed totals in one round trip.
   */
  async setShipping(token: string, shipAddress: ShipAddressInput, methodId?: string) {
    const state = await load(token);
    state.shipAddress = shipAddress;
    // A method id from a previous quote may not exist in the new one (a
    // different country returns different rates), so it is validated against
    // what this address actually offers rather than trusted.
    const totalsBefore = await computeTotals(state);
    const rates = await shippingRateService.rates({
      lines: totalsBefore.lines.map((l, i) => ({
        itemId: String(i),
        productId: l.variantId,
        variantId: l.variantId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      subtotal: totalsBefore.subtotal,
      currency: (await settingsService.getCommerce()).currency,
      address: shipAddress,
    });
    const valid = rates.find((r) => r.id === methodId);
    state.shippingMethodId = valid ? valid.id : (rates[0]?.id ?? null);
    await save(state);
    return { rates, selected: state.shippingMethodId, totals: await computeTotals(state) };
  },

  async checkout(token: string, email?: string, customerId?: string, shipAddress?: ShipAddressInput) {
    const state = await load(token);
    if (state.items.length === 0) throw new ValidationError('Cart is empty.', 'cart');
    if (email) state.customerEmail = email;
    // Adopt the address the caller is checking out with BEFORE computing
    // totals, so shipping and tax are priced even when the client never called
    // /cart/shipping first. Otherwise the order is created for the bare item
    // subtotal and the shopper is undercharged.
    if (shipAddress) state.shipAddress = shipAddress;

    const totals = await computeTotals(state);
    const short = totals.lines.filter((l) => l.available < l.quantity);
    if (short.length > 0) {
      throw new ConflictError(
        `Insufficient stock: ${short.map((l) => `${l.productName}${l.sku ? ` (${l.sku})` : ''}`).join(', ')}`,
        'items',
      );
    }

    // Create a DRAFT (no discount yet) so the order id exists for the
    // reservation. The coupon slot is then claimed atomically against that
    // order id (audit F1/F4): only if the claim succeeds does the discount
    // get applied — no order can carry a discount whose usage slot wasn't
    // actually reserved, and the reservation can't be won twice.
    //
    // Guest order (audit H-1): the unverified email is the receipt contact
    // only — never resolved to or bound to a customer account. `customerId`
    // is the separate, verified path (see the signature).
    const baseOrder = await orderService.create({
      currency: (await settingsService.getCommerce()).currency,
      idempotencyKey: `cart_${state.id}`,
      guestEmail: state.customerEmail ?? undefined,
      // A storefront order without an address produces a shipment that can
      // never be quoted (shipmentService throws on exactly that), so this is
      // required here even though the schema allows it to be omitted for
      // admin-created and imported orders.
      ...(shipAddress ? { shipAddress } : {}),
      // The quoted shipping and tax, carried onto the order. Without these the
      // order charged the bare item subtotal while checkout displayed the full
      // amount — the cart said $83.45 and the order was created for $54.00.
      shippingTotal: totals.shipping,
      taxTotal: totals.tax,
      ...(state.shippingMethodId ? { shippingMethod: state.shippingMethodId } : {}),
      ...(customerId ? { customerId } : {}),
      items: state.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    });

    // If a coupon was live, reserve its slot and apply the discount to THIS
    // order. A slot lost to a concurrent checkout (or a coupon invalidated
    // at the boundary) simply means the order stays at full price — the
    // customer is never given a discount that wasn't counted.
    if (totals.coupon && state.couponCode) {
      const q = await couponService.quoteOrNull(state.couponCode, totals.subtotal, state.customerEmail ?? null, customerId ?? state.customerId ?? null);
      if (q) {
        const reserved = await couponService.reserveForOrder(baseOrder.id, q.couponId, q.amount, state.customerEmail ?? null);
        if (reserved) {
          await orderService.applyDiscount(baseOrder.id, q.amount, `Coupon ${q.code}`);
        }
      }
    }

    await this.clear(token);
    const final = await orderService.get(baseOrder.id);
    return {
      orderId: final.id,
      orderNumber: final.number,
      accessToken: (baseOrder as { accessToken?: string }).accessToken ?? null,
      total: final.total,
    };
  },
};
