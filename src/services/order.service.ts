import { randomBytes } from 'node:crypto';
import { Prisma, type OrderStatus } from '@prisma/client';
import { db } from '../lib/db.js';
import { emit } from '../counter/webhookDelivery.js';
import { routeOrder } from '../counter/fulfillmentRouting.js';
import { orderWebhookPayload } from '../counter/orderWebhookPayload.js';
import { hookBus } from '../lib/hooks.js';
import { NotFoundError, ConflictError, ValidationError } from '../lib/errors.js';
import { milieuService } from './milieu.service.js';
import { capabilityService } from './capability.service.js';
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
          product: { select: { id: true, name: true, slug: true, image: true, fulfillmentProvider: true } },
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

function generateNumber(): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `THR-${stamp}-${randomBytes(5).toString('hex')}`; // ~40 bits entropy, not guessable
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
    const variants = await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, price: true, sku: true } });
    const priceById = new Map(variants.map((v) => [v.id, v.price]));
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
    let discount: { pct: number; milieuName: string } | null = null;
    if (input.customerId && (await capabilityService.isEnabled('memberships'))) {
      discount = await milieuService.discountFor(input.customerId);
    }

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
        // Member discount (admin-order path). Coupon discounts are applied
        // AFTER create via applyDiscount(), bound to the atomic coupon-slot
        // reservation — never conjured here (audit F1/F4). Capped at subtotal.
        const memberAmount = discount ? Math.min(Math.round(subtotal * (discount.pct / 100)), subtotal) : 0;
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
                  discountPct: discount?.pct ?? 0,
                  discountAmount: memberAmount,
                  discountLabel: `${discount?.milieuName} discount (${discount?.pct}%)`,
                }
              : {}),
            currency: input.currency,
            idempotencyKey: input.idempotencyKey,
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
        // Confirm: convert reservation into a real stock decrement.
        for (const item of order.items) {
          const ok = await tx.$executeRaw`
            UPDATE product_variants SET inventory = inventory - ${item.quantity}, reserved = reserved - ${item.quantity}
            WHERE id = ${item.variantId} AND reserved >= ${item.quantity} AND inventory >= ${item.quantity}`;
          if (ok !== 1) throw new ConflictError(`Inventory conflict confirming variant ${item.variantId}`, 'items');
        }
      } else if ((to === 'cancelled' || to === 'failed') && wasReserved) {
        // Release the reservation back.
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE product_variants SET reserved = reserved - ${item.quantity}
            WHERE id = ${item.variantId} AND reserved >= ${item.quantity}`;
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

  // Called by the payment webhook: mark paid + advance pending → processing.
  async markPaid(id: string, txnId: string | null, method: string | null, pspResponse: Prisma.InputJsonValue) {
    const order = await db.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!order) throw new NotFoundError('Order not found', 'id');
    await db.payment.update({
      where: { orderId: id },
      data: { status: 'paid', txnId, method, pspResponse },
    });
    const result = order.status === 'pending' ? await this.transition(id, { status: 'processing' }) : await this.get(id);
    await hookBus.run('onOrderPaid', result);
    return result;
  },
};
