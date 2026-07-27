import { randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { orderService } from './order.service.js';
import { couponService } from './coupon.service.js';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';

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
  createdAt: string;
}

export interface CartTotals {
  lines: {
    variantId: string;
    productName: string;
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
        include: { product: { select: { name: true, status: true } } },
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
        sku: v.sku,
        color: v.color,
        size: v.size,
        quantity: i.quantity,
        unitPrice: v.price,
        lineTotal: v.price * i.quantity,
        available: v.inventory - v.reserved,
      };
    });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  // Member discount is a LOGGED-IN customer benefit and deliberately does
  // NOT apply from a typed storefront email (audit H-1/M-2): an anonymous
  // cart supplying an arbitrary address must not inherit another customer's
  // membership, and returning the discount for a guessed email is a
  // membership/PII enumeration oracle. Storefront customer auth is a future
  // milestone; until it lands the storefront prices at list price and the
  // member discount flows only through the authenticated admin order path
  // (order.service create with a real, deliberately-set customerId).
  const discount: CartTotals['discount'] = null;

  // Coupon (C3): quoted live from the stored code every recalc; a coupon
  // that has gone invalid mid-session (limit hit elsewhere, expired) is
  // dropped silently (1.x recalc rule) via quoteOrNull.
  let coupon: CartTotals['coupon'] = null;
  if (state.couponCode) {
    const q = await couponService.quoteOrNull(state.couponCode, subtotal, state.customerEmail ?? null);
    if (q) coupon = { amount: q.amount, code: q.code };
  }

  const shipping = 0; // provider interface lands with the fleet milestone
  const tax = 0; // provider interface lands with the fleet milestone
  // Best-single-wins (doctrine — coupon and member discount do NOT stack).
  const memberAmount = discount ? (discount as { amount: number }).amount : 0;
  const couponAmount = coupon?.amount ?? 0;
  const appliedDiscount = Math.max(memberAmount, couponAmount);
  const total = subtotal - appliedDiscount + shipping + tax;

  return { lines, subtotal, discount, coupon, shipping, tax, total };
}

export const cartService = {
  // Lazy create: first add-to-cart with no token mints the session.
  async addItem(token: string | null, variantId: string, quantity: number) {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true } } },
    });
    if (!variant || variant.product.status !== 'active') {
      throw new NotFoundError('Product not available', 'variantId');
    }
    if (quantity < 1 || quantity > MAX_QTY) throw new ValidationError(`Quantity must be 1–${MAX_QTY}.`, 'quantity');

    const state: CartState = token
      ? await load(token)
      : { id: randomBytes(16).toString('hex'), items: [], createdAt: new Date().toISOString() };

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

  async get(token: string) {
    const state = await load(token);
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
  async applyCoupon(token: string, code: string) {
    const state = await load(token);
    const totals = await computeTotals(state);
    await couponService.quote(code, totals.subtotal, state.customerEmail ?? null); // throws if invalid
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
  async checkout(token: string, email?: string) {
    const state = await load(token);
    if (state.items.length === 0) throw new ValidationError('Cart is empty.', 'cart');
    if (email) state.customerEmail = email;

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
    // only — never resolved to or bound to a customer account.
    const baseOrder = await orderService.create({
      currency: 'USD',
      idempotencyKey: `cart_${state.id}`,
      guestEmail: state.customerEmail ?? undefined,
      items: state.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    });

    // If a coupon was live, reserve its slot and apply the discount to THIS
    // order. A slot lost to a concurrent checkout (or a coupon invalidated
    // at the boundary) simply means the order stays at full price — the
    // customer is never given a discount that wasn't counted.
    if (totals.coupon && state.couponCode) {
      const q = await couponService.quoteOrNull(state.couponCode, totals.subtotal, state.customerEmail ?? null);
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
