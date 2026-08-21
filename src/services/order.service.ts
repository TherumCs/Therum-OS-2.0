import { randomBytes } from 'node:crypto';
import { Prisma, type OrderStatus } from '@prisma/client';
import { db } from '../lib/db.js';
import { emit } from '../counter/webhookDelivery.js';
import { routeOrder, confirmPrintfulOrder } from '../counter/fulfillmentRouting.js';
import { orderWebhookPayload } from '../counter/orderWebhookPayload.js';
import { hookBus } from '../lib/hooks.js';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors.js';
import { milieuService } from './milieu.service.js';
import { capabilityService } from './capability.service.js';
import { settingsService } from './settings.service.js';
import { maxDiscountForMargin } from '../counter/marginFloor.js';
import type { CreateOrderInput, TransitionOrderInput, ListOrdersQuery } from '../schemas/order.schema.js';
import { orderByOf } from '../schemas/listing.js';

// Allowed transitions — anything not listed is rejected.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled', 'failed'],
  processing: ['shipped', 'cancelled', 'failed'],
  shipped: ['delivered'],
  delivered: [],
  failed: [],
  cancelled: [],
};

const orderInclude = {
  // The PRODUCT comes with the variant. Without it an order line knows a SKU
  // and nothing else — the admin could not name what was bought, let alone
  // link to it, which made the order page a list of prices with no products.
  // Colour and size come too, because "TEE-L" is not what a human ordered.
  items: {
    include: {
      variant: {
        select: {
          id: true, sku: true, price: true, color: true, size: true,
          // fulfillmentProvider is selected because order routing reads it to
          // decide which factory gets each line.
          product: { select: { id: true, name: true, slug: true, image: true, fulfillmentProvider: true, sourceId: true } },
        },
      },
    },
  },
  payment: true,
  customer: { select: { id: true, email: true, name: true } },
} satisfies Prisma.OrderInclude;

// The guest access token is a bearer credential (intent creation, receipt
// view) — it leaves this service ONLY in the create response, which the
// creator legitimately needs. List/get/transition responses strip it so a
// read-only admin session can't harvest order passwords (audit H-1).
function stripAccessToken<T extends { accessToken?: string | null }>(order: T): Omit<T, 'accessToken'> {
  const { accessToken: _omitted, ...rest } = order;
  return rest;
}

// The customer-facing order-number prefix. Change this one line to rebrand it
// (e.g. 'TSC'); existing numbers are stored whole, so old orders keep their
// prefix and still look up — nothing parses this.
const ORDER_PREFIX = 'SMNY';

function generateNumber(): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${ORDER_PREFIX}-${stamp}-${randomBytes(5).toString('hex')}`; // ~40 bits entropy, not guessable
}

export const orderService = {
  async list(query: ListOrdersQuery) {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    // Order search matches the human-facing order number.
    if (query.q) where.number = { contains: query.q, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      db.order.findMany({
        where,
        include: orderInclude,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: orderByOf(query.sort, query.order),
      }),
      db.order.count({ where }),
    ]);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items: items.map(stripAccessToken), nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null, total };
  },

  async get(id: string) {
    const order = await db.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundError('Order not found', 'id');
    return stripAccessToken(order);
  },

  // Apply a post-create discount to a PENDING order (Counter C3 coupon path,
  // called after the coupon slot is atomically reserved). Recomputes total
  // from the pre-discount amount and syncs the pending payment's amount.
  // Pending-only: a paid/processing order's total is settled money.
  async applyDiscount(id: string, amount: number, label: string) {
    return db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, select: { status: true, total: true, discountAmount: true } });
      if (!order) throw new NotFoundError('Order not found', 'id');
      if (order.status !== 'pending') throw new ConflictError('Only a pending order can be discounted.', 'id');
      // Base = the order's pre-discount subtotal (any prior discount added back).
      const subtotal = order.total + order.discountAmount;
      const capped = Math.min(Math.max(amount, 0), subtotal);
      const total = subtotal - capped;
      await tx.order.update({ where: { id }, data: { discountAmount: capped, discountLabel: label, discountPct: 0, total } });
      await tx.payment.update({ where: { orderId: id }, data: { amount: total } });
    });
  },

  // Atomic create: reserve inventory per item or roll the whole thing back.
  async create(input: CreateOrderInput) {
    if (input.idempotencyKey) {
      const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: orderInclude });
      if (existing) return existing;
    }

    const variantIds = input.items.map((i) => i.variantId);
    const variants = await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, price: true, cost: true, sku: true } });
    const priceById = new Map(variants.map((v) => [v.id, v.price]));
    const costById = new Map(variants.map((v) => [v.id, v.cost]));
    // Customer-facing label for the stock-conflict message — a SKU, not the
    // internal variant id (audit L-1).
    const labelById = new Map(variants.map((v) => [v.id, v.sku ?? v.id]));
    for (const item of input.items) {
      if (!priceById.has(item.variantId)) throw new ValidationError(`Unknown variant ${item.variantId}`, 'items');
    }

    // Milieus member discount (M2) — largest single milieu pct off the
    // subtotal, no stacking (1.x wc-pricing.php rule). Resolved before the
    // transaction: it reads membership state, doesn't touch inventory. Only
    // applies when the memberships capability is on AND the order has a
    // customer; guests and disabled-capability installs price unchanged.
    //
    // discountOverride short-circuits this: the storefront cart already computed
    // the member discount (margin-floor clamped, per-product opt-outs applied),
    // so when it is supplied we DO NOT recompute — recomputing here diverged
    // from the cart on both the floor and the noMemberDiscount opt-out, which is
    // exactly how an order charged less than the cart quoted.
    let discount: { pct: number; milieuName: string } | null = null;
    if (input.discountOverride === undefined && input.customerId && (await capabilityService.isEnabled('memberships'))) {
      discount = await milieuService.discountFor(input.customerId);
    }
    // Admin/import path (no override) still honours the margin floor, so an
    // admin-created member order can't be discounted below cost either.
    const marginPct = discount ? (await settingsService.getCommerce()).minMarginPct : 0;

    try {
      const order = await db.$transaction(async (tx) => {
        // Reserve each variant atomically; guard prevents overselling.
        for (const item of input.items) {
          // The guard mirrors availableOf() in counter/availability.ts, in SQL
          // so it stays atomic. Untracked lines (print-on-demand, backorder)
          // still increment `reserved` — that is what makes the reservation
          // releasable on cancel by the same code path — but they are not
          // gated on a count they do not keep.
          //
          // 'out_of_stock' is refused explicitly rather than by arithmetic, so
          // a merchant switching a variant off takes it off sale immediately
          // regardless of what the inventory column happens to say.
          const reserved = await tx.$executeRaw`
            UPDATE product_variants SET reserved = reserved + ${item.quantity}
            WHERE id = ${item.variantId}
              AND stock_status <> 'out_of_stock'
              AND (stock_status IN ('in_stock', 'backorder')
                   OR inventory - reserved >= ${item.quantity})`;
          if (reserved !== 1) throw new ConflictError(`Insufficient stock for ${labelById.get(item.variantId) ?? item.variantId}`, 'items');
        }

        const subtotal = input.items.reduce((sum, i) => sum + (priceById.get(i.variantId) ?? 0) * i.quantity, 0);
        // Member discount. Coupon discounts are applied AFTER create via
        // applyDiscount(), bound to the atomic coupon-slot reservation — never
        // conjured here (audit F1/F4).
        //
        // Three sources, in priority: (1) a discountOverride from the storefront
        // cart, used verbatim so the order matches the cart exactly; (2) the
        // internally-computed milieu discount, clamped to the margin floor;
        // (3) none. Always capped at subtotal.
        let memberAmount: number;
        let memberPct: number;
        let memberLabel: string;
        if (input.discountOverride !== undefined) {
          memberAmount = Math.min(Math.max(input.discountOverride?.amount ?? 0, 0), subtotal);
          memberPct = input.discountOverride?.pct ?? 0;
          memberLabel = input.discountOverride?.label ?? '';
        } else if (discount) {
          const raw = Math.min(Math.round(subtotal * (discount.pct / 100)), subtotal);
          const floorMax = maxDiscountForMargin(
            input.items.map((i) => ({
              lineTotal: (priceById.get(i.variantId) ?? 0) * i.quantity,
              quantity: i.quantity,
              cost: costById.get(i.variantId) ?? null,
            })),
            subtotal,
            marginPct,
          );
          memberAmount = Number.isFinite(floorMax) ? Math.min(raw, floorMax) : raw;
          memberPct = discount.pct;
          memberLabel = `${discount.milieuName} discount (${discount.pct}%)`;
        } else {
          memberAmount = 0;
          memberPct = 0;
          memberLabel = '';
        }
        const total = subtotal - memberAmount;

        return tx.order.create({
          data: {
            number: generateNumber(),
            status: 'pending',
            customerId: input.customerId,
            // Guest receipt + checkout auth (Counter C1): the order's own
            // bearer token — 128 bits, constant-time compared on use.
            accessToken: randomBytes(16).toString('hex'),
            guestEmail: input.guestEmail ?? null,
            // Captured at checkout and stored on the ORDER, not the customer:
            // an order is a historical record, and a shopper editing their
            // saved address later must not rewrite where a past parcel went.
            // shipmentService reads this to create shipments; without it a
            // shipment is created empty and can never be quoted.
            ...(input.shipAddress ? { shipAddress: input.shipAddress } : {}),
            // Shipping and tax are ADDED to the item total, and stored so the
            // receipt can explain the number. `total` is what is charged.
            shippingTotal: input.shippingTotal ?? 0,
            taxTotal: input.taxTotal ?? 0,
            shippingMethod: input.shippingMethod ?? null,
            total: total + (input.shippingTotal ?? 0) + (input.taxTotal ?? 0),
            ...(memberAmount > 0
              ? {
                  discountPct: memberPct,
                  discountAmount: memberAmount,
                  discountLabel: memberLabel,
                }
              : {}),
            currency: input.currency,
            idempotencyKey: input.idempotencyKey,
            // First-touch attribution, if the cart carried one.
            ...(input.source ? { meta: { source: input.source } } : {}),
            items: {
              create: input.items.map((i) => ({
                variantId: i.variantId,
                quantity: i.quantity,
                priceAtTime: priceById.get(i.variantId) ?? 0,
              })),
            },
            payment: { create: { status: 'pending', amount: total } },
          },
          include: orderInclude,
        });
      });
      await hookBus.run('onOrderCreate', order);
      // Tell every connected partner. Fire-and-forget on purpose: a POD
      // partner's endpoint being slow or down must never fail a customer's
      // order. Failures are recorded in webhook_deliveries.
      emit({ topic: 'order.created', resourceId: order.id, payload: orderWebhookPayload(order) });
      // PUSH partners (Printful, Printify) never subscribe to a webhook — in
      // their model they are the client and this store is the shop they read.
      // Nothing would tell them an order happened, so the store calls their
      // Orders API. Fire-and-forget for the same reason the webhook is: a
      // factory being down must not fail a paid order.
      void routeOrder(order).catch(() => { /* recorded in fulfillment_routes */ });
      return order;
    } catch (err) {
      // Unique-collision on idempotencyKey (concurrent double-submit) → return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
        const winner = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: orderInclude });
        if (winner) return winner;
      }
      throw err;
    }
  },

  async transition(id: string, input: TransitionOrderInput) {
    const result = await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw new NotFoundError('Order not found', 'id');

      const to = input.status;
      if (!TRANSITIONS[order.status].includes(to)) {
        throw new ConflictError(`Cannot transition order from ${order.status} to ${to}`, 'status');
      }

      // Inventory effects of each transition.
      const wasReserved = order.status === 'pending';
      const wasConfirmed = order.status === 'processing' || order.status === 'shipped';

      if (to === 'processing' && wasReserved) {
        // Confirm: convert reservation into a real stock decrement — but ONLY
        // for tracked variants. A print-on-demand line (stockStatus 'in_stock')
        // legitimately carries inventory 0, and demanding inventory >= qty here
        // stranded every PAID order containing one: the charge landed, the
        // pending→processing flip threw ConflictError, and the receipt/owner
        // emails (which fire on that flip) never sent. For untracked lines the
        // reservation is simply released; there is no stock to decrement.
        for (const item of order.items) {
          const ok = await tx.$executeRaw`
            UPDATE product_variants SET
              inventory = CASE WHEN stock_status = 'tracked' THEN inventory - ${item.quantity} ELSE inventory END,
              reserved  = reserved - ${item.quantity}
            WHERE id = ${item.variantId} AND reserved >= ${item.quantity}
              AND (stock_status <> 'tracked' OR inventory >= ${item.quantity})`;
          if (ok !== 1) throw new ConflictError(`Inventory conflict confirming variant ${item.variantId}`, 'items');
        }
      } else if ((to === 'cancelled' || to === 'failed') && wasReserved) {
        // Release the reservation back. GREATEST-clamped rather than guarded:
        // the old `WHERE reserved >= qty` silently NO-OPED whenever counters
        // had drifted below the guard, which is exactly how 16 units of
        // phantom `reserved` accumulated across 9 variants — each no-op left
        // the counter permanently high. A release must always succeed; the
        // clamp floors at 0 so drift self-heals instead of compounding.
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE product_variants SET reserved = GREATEST(reserved - ${item.quantity}, 0)
            WHERE id = ${item.variantId}`;
        }
      } else if ((to === 'cancelled' || to === 'failed') && wasConfirmed) {
        // Restock previously-sold inventory (refund path).
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE product_variants SET inventory = inventory + ${item.quantity}
            WHERE id = ${item.variantId}`;
        }
      }

      const updated = await tx.order.update({ where: { id }, data: { status: to }, include: orderInclude });
      return { stripped: stripAccessToken(updated), full: updated };
    });

    // AFTER the commit, never inside it. Emitting from within the transaction
    // would announce a status change to every partner and then let a rollback
    // un-happen it — and a fulfilment partner that has already started
    // printing cannot un-print.
    emit({
      topic: 'order.updated',
      resourceId: result.full.id,
      payload: orderWebhookPayload(result.full),
    });
    return result.stripped;
  },

  /**
   * Fill blank contact fields from a redirect provider's capture — PayPal
   * collects the email and shipping in its own window, so a formless PayPal
   * checkout arrives here with an empty order. Only fills what is MISSING (never
   * overwrites a value the shopper already gave) and no-ops when there is
   * nothing to add, so it is safe to call on every return. Runs before markPaid
   * so fulfillment sees the address.
   */
  async backfillContact(id: string, contact: { email: string | null; shipAddress: unknown | null } | null | undefined) {
    if (!contact || (!contact.email && !contact.shipAddress)) return;
    const order = await db.order.findUnique({ where: { id }, select: { guestEmail: true, shipAddress: true } });
    if (!order) return;
    const data: Prisma.OrderUpdateInput = {};
    if (contact.email && !order.guestEmail) data.guestEmail = contact.email;
    if (contact.shipAddress && !order.shipAddress) data.shipAddress = contact.shipAddress as Prisma.InputJsonValue;
    if (Object.keys(data).length > 0) await db.order.update({ where: { id }, data });
  },

  /**
   * Fail never-charged pending orders older than `hours`, releasing their
   * stock reservations through the normal transition() path. A pending order
   * is a shopper mid-checkout — 24h is generous even for BNPL redirects
   * (Stripe expires those sessions far sooner). Orders whose payment carries
   * a txnId are NEVER swept: that is money already taken and a human problem;
   * they are surfaced in the return instead. Without this sweep an abandoned
   * checkout on a tracked variant (the 1-in-stock jerseys) froze the unit
   * forever and real buyers saw "Insufficient stock".
   */
  async sweepStalePending(hours = 24): Promise<{ failed: string[]; chargedStuck: string[] }> {
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const stale = await db.order.findMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      select: { id: true, number: true, payment: { select: { txnId: true } } },
    });
    const failed: string[] = [];
    const chargedStuck: string[] = [];
    for (const o of stale) {
      if (o.payment?.txnId) { chargedStuck.push(o.number); continue; }
      try {
        await this.transition(o.id, { status: 'failed' });
        failed.push(o.number);
      } catch {
        // A racing shopper may have just paid — leave the order alone; the
        // next sweep will see the txnId and skip it.
      }
    }
    return { failed, chargedStuck };
  },

  // Called by the payment webhook: mark paid + advance pending → processing.
  async markPaid(id: string, txnId: string | null, method: string | null, pspResponse: Prisma.InputJsonValue) {
    const order = await db.order.findUnique({ where: { id }, select: { id: true, status: true, idempotencyKey: true } });
    if (!order) throw new NotFoundError('Order not found', 'id');
    await db.payment.update({
      where: { orderId: id },
      data: { status: 'paid', txnId, method, pspResponse },
    });
    const result = order.status === 'pending' ? await this.transition(id, { status: 'processing' }) : await this.get(id);

    // Auto-confirm fulfilment: the money is in, so submit this order's Printful
    // draft to production. Only at the pending→paid edge, so a retried webhook
    // doesn't re-submit; fire-and-forget, because a factory being down must
    // never unwind a captured payment — the same rule routeOrder() follows at
    // checkout.
    if (order.status === 'pending') {
      // Clear the shopper's cart HERE — the confirmed-payment edge — not at
      // order creation (cart.service.checkout leaves it alive so a declined or
      // abandoned payment can retry the same cart). The cart token is the
      // order's idempotency key (`cart_${cartId}`). Lazy import breaks the
      // cart↔order cycle; fire-and-forget so a stray cart never unwinds a
      // captured payment (it expires via TTL regardless).
      const cartToken = order.idempotencyKey?.startsWith('cart_') ? order.idempotencyKey.slice(5) : null;
      if (cartToken) void import('./cart.service.js').then(({ cartService }) => cartService.clear(cartToken)).catch(() => { /* TTL cleans it up */ });

      const routable = await db.order.findUnique({ where: { id }, include: orderInclude });
      if (routable) void confirmPrintfulOrder(routable).catch(() => { /* recorded in fulfillment_routes */ });

      // Order emails — receipt to the shopper, heads-up to the store owner.
      // Fired HERE, at the single pending→paid edge that EVERY settlement path
      // funnels through (in-page token, hosted-redirect return, and PSP
      // webhook all land in markPaid), so a sale can never complete silently
      // again. This used to live only in the webhook handler, so an in-page
      // Stripe charge — which never hits a webhook — settled with no receipt
      // and no owner alert. Fire-and-forget and lazily imported: a dead mail
      // box (or an import cycle) must never unwind a captured payment.
      const origin = process.env.PUBLIC_ORIGIN ?? null;
      void import('./commerceEmail.service.js').then(({ commerceEmailService }) => {
        void commerceEmailService.sendReceipt(id, origin);
        void commerceEmailService.notifyAdminNewOrder(id, origin);
      }).catch(() => { /* mail layer logs its own failures */ });
    }

    await this.rememberShippingAddress(id);
    await hookBus.run('onOrderPaid', result);
    return result;
  },

  /**
   * Keep a signed-in customer's shipping address so the next checkout can
   * fill it in for them.
   *
   * Only on a PAID order, and only for a customer who has none yet — a
   * guest's address is not ours to keep, and overwriting a saved one would
   * silently change where their future orders go because they shipped
   * something to a friend once.
   *
   * Never fatal: a failure here must not unpick a payment that succeeded.
   */
  async rememberShippingAddress(orderId: string) {
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, shipAddress: true },
      });
      if (!order?.customerId || !order.shipAddress) return;
      const existing = await db.address.count({ where: { customerId: order.customerId } });
      if (existing > 0) return;
      const a = order.shipAddress as Record<string, unknown>;
      const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null);
      const line1 = str('line1');
      const city = str('city');
      const country = str('country');
      if (!line1 || !city || !country) return;
      await db.address.create({
        data: {
          customerId: order.customerId,
          line1,
          line2: str('line2'),
          city,
          region: str('region'),
          postalCode: str('postal') ?? str('postalCode'),
          country,
          isDefault: true,
        },
      });
    } catch {
      // A saved address is a convenience. Losing it costs a shopper some
      // typing next time; throwing here would cost them the order.
    }
  },
};
