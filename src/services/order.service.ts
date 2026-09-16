import { randomBytes } from 'node:crypto';
import { Prisma, type OrderStatus } from '@prisma/client';
import { db } from '../lib/db.js';
import { emit } from '../counter/webhookDelivery.js';
import { routeOrder, confirmPrintfulOrder, submitPaidOrder } from '../counter/fulfillmentRouting.js';
import { orderWebhookPayload } from '../counter/orderWebhookPayload.js';
import { hookBus } from '../lib/hooks.js';
import { logger } from '../lib/logger.js';
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
  // A full refund can land on a shipped OR delivered order (customer returns,
  // chargebacks) — those must be able to reach cancelled so the refund's status
  // change doesn't throw AFTER the money was already returned.
  shipped: ['delivered', 'cancelled'],
  delivered: ['cancelled'],
  failed: [],
  cancelled: [],
};

const orderInclude = {
  // The PRODUCT comes with the variant. Without it an order line knows a SKU
  // and nothing else — the admin could not name what was bought, let alone
  // link to it, which made the order page a list of prices with no products.
  // Colour and size come too, because "TEE-L" is not what a human ordered.
  // orderBy id asc so line order is STABLE — the webhook per-partner line filter
  // (scopeOrderDelivery) matches this payload's line_items positionally, and an
  // OrderItem UPDATE must not silently re-order them (audit R6).
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: {
        select: {
          // variant.sourceId is the PROVIDER's variant id (Printful sync_variant_id,
          // Printify variant_id). routeOrder skips any line without it, so omitting
          // it here silently dropped EVERY line from routing — no order ever reached
          // a factory. It must be loaded for fulfillment to work at all.
          // variant.wooId / product.wooId are the INTEGER WooCommerce ids the
          // partner recorded when it synced our catalogue. The order webhook must
          // reference the order's lines by THOSE ids — a partner maps its own
          // product to woo id 1644, so an order that says product_id=<cuid> can't
          // be matched and the partner silently fulfils nothing (200 / data:null).
          id: true, wooId: true, sku: true, price: true, color: true, size: true, sourceId: true,
          // fulfillmentProvider is selected because order routing reads it to
          // decide which factory gets each line. product.sourceId is the Printify
          // shop-product id (distinct from the variant id).
          product: { select: { id: true, wooId: true, name: true, slug: true, image: true, fulfillmentProvider: true, sourceId: true } },
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

/**
 * True when a frozen pending order still matches the cart being checked out —
 * same line items (variant→quantity multiset) and same shipping/tax. Used to
 * tell a genuine idempotent retry (return the existing order) from a cart the
 * shopper edited after a decline/abandon (rebuild it). Discount is intentionally
 * NOT compared: it is a deterministic function of the lineup, and a coupon is
 * applied AFTER create, so comparing it would false-trigger. (audit C1/C2)
 */
function sameLineup(
  existing: { items: { variantId: string; quantity: number }[]; shippingTotal: number; taxTotal: number },
  input: { items: { variantId: string; quantity: number }[]; shippingTotal?: number; taxTotal?: number },
): boolean {
  if ((input.shippingTotal ?? 0) !== existing.shippingTotal) return false;
  if ((input.taxTotal ?? 0) !== existing.taxTotal) return false;
  const tally = (items: { variantId: string; quantity: number }[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.variantId, (m.get(it.variantId) ?? 0) + it.quantity);
    return m;
  };
  const a = tally(existing.items);
  const b = tally(input.items);
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
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
      if (existing) {
        // A settled order (paid/processing/…) is returned verbatim — a genuine
        // idempotent double-submit, or a post-payment re-POST.
        if (existing.status !== 'pending') return existing;
        // The cart that owns this idempotency key (`cart_<id>`) is deliberately
        // left EDITABLE after checkout so a declined/abandoned payment can retry
        // (see cart.service.checkout + markPaid's cart clear). That means the
        // shopper can edit the cart and re-POST /checkout against a FROZEN
        // pending order. Returning it verbatim then charges — and discounts (a
        // coupon re-quoted against the now-different cart) — the WRONG basket:
        // C1 (inflate the cart → coupon zeroes a tiny order) and C2 (trim the
        // cart after a decline → charged the old, larger amount). So: if the
        // frozen order still matches the current cart, it is a true retry —
        // return it. If it has DRIFTED, fail the stale order (releasing its
        // reservations via the normal transition path), free the idempotency
        // key, and fall through to mint a fresh order that matches what the
        // shopper is actually looking at. (audit C1/C2)
        if (sameLineup(existing, input)) return existing;
        await this.transition(existing.id, { status: 'failed' }).catch(() => { /* paid mid-flight → C4 refuses; handled by the re-read below */ });
        // Only free the key + rebuild if the stale order actually FAILED (its
        // reservations are now released). If it could not be failed — a payment
        // landed mid-flight, so transition() refused (C4) and it is now
        // paid/processing — return it settled rather than charging a rebuild.
        const after = await db.order.findUnique({ where: { id: existing.id }, select: { status: true } });
        if (after?.status !== 'failed') return existing;
        await db.order.update({ where: { id: existing.id }, data: { idempotencyKey: null } });
        // fall through: create a fresh order below, taking the freed key.
      }
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
        // The CHARGED amount — items minus discount PLUS shipping and tax. Both
        // order.total and payment.amount must be this exact figure; payment.amount
        // used the pre-shipping/tax `total`, understating every payment record
        // versus what the card was actually charged (order.total).
        const chargedTotal = total + (input.shippingTotal ?? 0) + (input.taxTotal ?? 0);

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
            total: chargedTotal,
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
            payment: { create: { status: 'pending', amount: chargedTotal } },
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
      // Lock the order row FIRST. transition() reads the status, checks the graph
      // in JS, then applies inventory effects (the cancelled/failed restock is an
      // UNCONDITIONAL inventory += qty). Two concurrent transitions (e.g. a
      // refund→cancelled racing an admin/partner cancel) both read status
      // 'processing', both pass the graph check, and both restock — a 1-unit line
      // becomes 2 and the store oversells (audit). SELECT … FOR UPDATE serializes
      // them: the second blocks until the first commits, then re-reads the now
      // 'cancelled' status and the graph check rejects it.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id }, include: { items: true, payment: { select: { status: true } } } });
      if (!order) throw new NotFoundError('Order not found', 'id');

      const to = input.status;
      if (!TRANSITIONS[order.status].includes(to)) {
        throw new ConflictError(`Cannot transition order from ${order.status} to ${to}`, 'status');
      }
      // A PAID order can never be marked 'failed'. 'failed' means the payment
      // never succeeded; a captured payment contradicts it. This is read live
      // inside the transaction (not from a caller's stale snapshot), which is
      // what closes the sweepStalePending race: sweepStalePending snapshots
      // payment.status in its findMany and can call transition(failed) on an
      // order that was paid AFTER the snapshot but before the loop — flipping a
      // charged, in-production order to 'failed' and phantom-restocking it. The
      // sweep swallows this ConflictError, so a raced payment is simply left
      // alone (it is now 'processing' and no longer swept). Refund-driven
      // 'cancelled' is deliberately still allowed — that is a real refund, not
      // an abandonment sweep. (audit C4)
      if (to === 'failed' && order.payment?.status === 'paid') {
        throw new ConflictError('A paid order cannot be failed — it has been charged.', 'status');
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
    //
    // TWO shapes, because partners subscribe two different ways (verified against
    // the live WooCommerce store):
    //  - order.updated  → PODpartner/PodPluser: the full order object.
    //  - action.woocommerce_order_status_processing → Tapstitch(HugePOD)/Printify/
    //    Printful: fired on the pending→processing (paid) flip, body {action,arg:id},
    //    then the partner pulls /wc/v3/orders/<id>. This is THE trigger POD
    //    factories act on; without it nothing they subscribed to ever arrived.
    emit({
      topic: 'order.updated',
      resourceId: result.full.id,
      payload: orderWebhookPayload(result.full),
    });
    if (input.status === 'processing') {
      emit({
        topic: 'action.woocommerce_order_status_processing',
        resourceId: result.full.id,
        payload: { action: 'woocommerce_order_status_processing', arg: result.full.wooId ?? result.full.id },
      });
      // "Ordered → automatically into production." Every paid line starts its
      // production stage the moment the order is confirmed, instead of waiting
      // for someone to click "All in production" in Counter. setItemProduction is
      // idempotent per line (skips lines already at the stage) and emails the
      // customer exactly once per real move. Fire-and-forget: a mail or DB hiccup
      // must never unwind the committed transition.
      void this.setItemProduction(result.full.id, { status: 'in_production' }).catch(() => { /* service logs its own failures */ });
    }
    // Release any coupon this order was holding when it TERMINATES without a
    // sale. reserveForOrder increments usage_count + the per-user cap at
    // checkout; only the refund path released them, so a declined/abandoned/
    // cancelled order permanently burned a single-use or limited-quantity code
    // (audit). Idempotent + a no-op when the order carried no coupon. Lazy import
    // avoids an order↔coupon cycle; fire-and-forget so it never unwinds the
    // committed transition.
    if (input.status === 'cancelled' || input.status === 'failed') {
      void import('./coupon.service.js').then(({ couponService }) => couponService.releaseForOrder(id)).catch(() => { /* best-effort */ });
    }
    return result.stripped;
  },

  /**
   * Set the PER-LINE production stage for some (or all) of an order's items.
   * A multi-vendor order has each product at its own stage, so this is keyed on
   * order ITEMS, not the order. Entering 'in_production' emails the customer once
   * per line ("your <product> is being made"); productionNotifiedAt guards the
   * re-send. The order-level status is untouched — it stays the overall roll-up.
   */
  async setItemProduction(orderId: string, input: { itemIds?: string[]; status: 'pending' | 'in_production' | 'shipped' | 'delivered' | 'cancelled' }) {
    const VALID = ['pending', 'in_production', 'shipped', 'delivered', 'cancelled'];
    if (!VALID.includes(input.status)) throw new ValidationError(`Unknown production status "${input.status}".`, 'status');
    const order = await db.order.findUnique({ where: { id: orderId }, include: { items: { select: { id: true, productionStatus: true, productionNotifiedAt: true } } } });
    if (!order) throw new NotFoundError('Order not found', 'id');
    const requested = new Set(input.itemIds ?? []);
    const targets = order.items.filter((i) => (requested.size ? requested.has(i.id) : true));
    if (!targets.length) throw new ValidationError('No matching order items.', 'itemIds');
    // Stages a customer should hear about. pending/cancelled just set the stage.
    const NOTIFY = new Set(['in_production', 'shipped', 'delivered']);
    if (!NOTIFY.has(input.status)) {
      await db.orderItem.updateMany({ where: { id: { in: targets.map((i) => i.id) }, orderId }, data: { productionStatus: input.status } });
      return this.get(orderId);
    }
    // Customer-facing stage. The status flip IS the atomic claim: guarding each
    // write on `productionStatus != status` means two concurrent / double-clicked
    // calls can't both win a line, so the customer is emailed EXACTLY ONCE per
    // real transition (fixes the old read-then-write double-email race). Per line
    // because updateMany returns only a count, and we must email precisely the
    // lines that actually moved this call.
    const won: string[] = [];
    for (const it of targets) {
      if (it.productionStatus === input.status) continue; // already at this stage → no move, no email
      const { count } = await db.orderItem.updateMany({
        where: { id: it.id, orderId, productionStatus: { not: input.status } },
        data: { productionStatus: input.status, productionNotifiedAt: new Date() },
      });
      if (count === 1) won.push(it.id);
    }
    if (won.length) {
      const origin = process.env.PUBLIC_ORIGIN ?? null;
      const stage = input.status as 'in_production' | 'shipped' | 'delivered';
      void import('./commerceEmail.service.js')
        .then(({ commerceEmailService }) => commerceEmailService.sendStageNotice(orderId, won, stage, origin))
        .catch(() => { /* mail layer logs its own failures */ });
    }
    return this.get(orderId);
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
    // shipAddress defaults to Json `{}` — which is TRUTHY, so `!order.shipAddress`
    // was ALWAYS false and the PayPal-captured address was never written: the
    // formless PayPal order stayed address-less, and every downstream shipment
    // failed shippable(). Test for genuine emptiness, not falsiness.
    const cur = order.shipAddress as Record<string, unknown> | null;
    const hasAddr = !!cur && typeof cur === 'object' && Object.keys(cur).length > 0;
    const data: Prisma.OrderUpdateInput = {};
    if (contact.email && !order.guestEmail) data.guestEmail = contact.email;
    if (contact.shipAddress && !hasAddr) data.shipAddress = contact.shipAddress as Prisma.InputJsonValue;
    if (Object.keys(data).length > 0) await db.order.update({ where: { id }, data });
  },

  /**
   * Fail never-charged pending orders older than `hours`, releasing their
   * stock reservations through the normal transition() path. A pending order
   * is a shopper mid-checkout — 24h is generous even for BNPL redirects
   * (Stripe expires those sessions far sooner). Orders whose payment is
   * actually CAPTURED (status 'paid') are NEVER swept: that is money already
   * taken and a human problem; they are surfaced in the return instead.
   *
   * The gate is payment.STATUS, not txnId presence: createIntent stamps a txnId
   * at intent-CREATION while status stays 'pending' (no capture yet). Gating on
   * txnId meant a shopper who merely clicked a payment method then abandoned
   * kept the tracked unit reserved FOREVER — the 1-in-stock jersey froze on
   * ordinary cart abandonment, the exact leak this sweep exists to prevent, and
   * it error-spammed "CHARGED stuck" for orders where no money moved.
   */
  async sweepStalePending(hours = 24): Promise<{ failed: string[]; chargedStuck: string[] }> {
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const stale = await db.order.findMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      select: { id: true, number: true, payment: { select: { status: true } } },
    });
    const failed: string[] = [];
    const chargedStuck: string[] = [];
    for (const o of stale) {
      if (o.payment?.status === 'paid') { chargedStuck.push(o.number); continue; }
      try {
        await this.transition(o.id, { status: 'failed' });
        failed.push(o.number);
      } catch {
        // A racing shopper may have just paid between the findMany snapshot and
        // now: transition() re-reads payment.status live and REFUSES to fail a
        // paid order (audit C4), throwing here. Leave it alone — it is paid and
        // moving forward, and the sweep only ever touches 'pending' orders, so
        // it will not be revisited.
      }
    }
    return { failed, chargedStuck };
  },

  // Called by the payment webhook: mark paid + advance pending → processing.
  async markPaid(id: string, txnId: string | null, method: string | null, pspResponse: Prisma.InputJsonValue) {
    const order = await db.order.findUnique({ where: { id }, select: { id: true, status: true, idempotencyKey: true } });
    if (!order) throw new NotFoundError('Order not found', 'id');
    // ATOMIC paid-edge claim. The live WooPayments card rail settles an order
    // via TWO near-simultaneous paths (in-page redirect-finish AND the engine
    // bridge webhook). The old code flipped payment then gated every side effect
    // on a stale status read, so both callers passed the gate → DUPLICATE receipt
    // + owner emails and, worse, submitPaidOrder ran twice and created the
    // Printify production order TWICE (real money). The payment row is the lock:
    // flip pending→paid conditionally; exactly one caller gets count===1 and runs
    // the side effects. Every other concurrent/retried call returns the settled
    // order and does nothing.
    const settled = await db.payment.updateMany({
      where: { orderId: id, status: { not: 'paid' } },
      data: { status: 'paid', txnId, method, pspResponse },
    });
    if (settled.count !== 1) {
      // Already settled by another path — do NOT re-fire emails/fulfilment.
      return this.get(id);
    }
    // The money is captured. The pending→processing transition confirms
    // inventory, and it THROWS if a tracked variant was re-synced to 0 between
    // reserve and pay (routine for dropship SKUs). Letting that throw here left
    // the payment 'paid' but the order stuck 'pending' with NO receipt, NO
    // fulfilment, NO cart clear — a silently-broken paid order. A captured
    // payment must always move forward: on a confirm shortfall, force the order
    // to processing, flag it for manual stock reconcile, and continue the
    // paid-edge side effects. Inventory drift is an ops problem, never a reason
    // to strand a sale.
    // We won the settle claim, so THIS call owns the paid edge. Advance the
    // order (transition confirms inventory + emits the vendor webhooks); a
    // confirm shortfall must not strand a captured payment, so force it forward
    // and flag for reconcile.
    let result;
    try {
      result = await this.transition(id, { status: 'processing' });
    } catch (err) {
      // transition() throws for TWO very different reasons, and conflating them
      // shipped terminated orders (audit CRITICAL). Re-read the LIVE status:
      //  - order is TERMINAL (cancelled/failed): the order was cancelled/failed
      //    while the payment was still pending, then a late/async settlement
      //    (PayPal/BNPL/delayed webhook) landed here. The old catch assumed
      //    "inventory shortfall" and force-wrote status='processing', then
      //    submitPaidOrder + emails ran below — creating a real billable vendor
      //    production order and SHIPPING goods on an order the customer cancelled.
      //    NEVER do that. Leave it terminal, flag for an ops refund (the payment
      //    row is 'paid' so the refund path can act), and STOP the paid edge.
      //  - order is still 'pending': a genuine confirm/inventory shortfall — the
      //    original force-forward path below is correct.
      const live = await db.order.findUnique({ where: { id }, select: { status: true, meta: true } });
      if (live && live.status !== 'pending') {
        logger.error({ orderId: id, status: live.status, txnId }, 'PAYMENT captured on a TERMINAL order — NOT fulfilling/shipping; flagged for refund');
        const meta = { ...((live.meta as Record<string, unknown>) ?? {}), paymentOnTerminalOrder: { status: live.status, txnId, at: new Date().toISOString(), refundNeeded: true } };
        await db.order.update({ where: { id }, data: { meta: meta as Prisma.InputJsonValue } }).catch(() => { /* best-effort flag */ });
        return this.get(id); // no cart clear, no fulfilment, no emails
      }
      logger.error({ err, orderId: id }, 'CHARGED order failed inventory confirm — forcing processing + settling inventory deterministically');
      // The confirm transaction rolled back, so NOTHING was applied: for EVERY
      // line `reserved` is still incremented and `inventory` is untouched. A
      // bare status write here (the old behaviour) left `reserved` leaked on
      // every line forever — availableOf = inventory - reserved then drifts and
      // silently pushes sellable variants toward phantom out-of-stock (audit
      // H3). Settle inventory deterministically instead: release the reservation
      // on every line (clamped at 0 so drift self-heals) and decrement tracked
      // stock where it can satisfy the line (also clamped), then force the order
      // forward. This is exactly what a successful confirm would have done,
      // tolerant of the tracked line that was re-synced short.
      await db.$transaction(async (tx) => {
        const o = await tx.order.findUnique({ where: { id }, select: { items: true, meta: true } });
        for (const item of o?.items ?? []) {
          await tx.$executeRaw`
            UPDATE product_variants SET
              inventory = CASE WHEN stock_status = 'tracked' THEN GREATEST(inventory - ${item.quantity}, 0) ELSE inventory END,
              reserved  = GREATEST(reserved - ${item.quantity}, 0)
            WHERE id = ${item.variantId}`;
        }
        const meta = { ...((o?.meta as Record<string, unknown>) ?? {}), inventoryReconcile: { reason: 'confirm-shortfall-at-paid', settled: true, at: new Date().toISOString() } };
        await tx.order.update({ where: { id }, data: { status: 'processing', meta: meta as Prisma.InputJsonValue } });
      });
      // The forced 'processing' skips transition()'s webhook emits, so fire the
      // paid-vendor pings here too — a pull/webhook POD partner (Tapstitch) must
      // still learn the order is paid, not wait for the hourly retry.
      const forced = await db.order.findUnique({ where: { id }, include: orderInclude });
      if (forced) {
        emit({ topic: 'order.updated', resourceId: forced.id, payload: orderWebhookPayload(forced) });
        emit({ topic: 'action.woocommerce_order_status_processing', resourceId: forced.id, payload: { action: 'woocommerce_order_status_processing', arg: forced.wooId ?? forced.id } });
      }
      result = await this.get(id);
    }

    // Paid-edge side effects — run exactly ONCE, because only the settle-claim
    // winner reaches here (a concurrent/retried markPaid returned early above).
    {
      // Clear the shopper's cart HERE — the confirmed-payment edge — not at
      // order creation (cart.service.checkout leaves it alive so a declined or
      // abandoned payment can retry the same cart). The cart token is the
      // order's idempotency key (`cart_${cartId}`). Lazy import breaks the
      // cart↔order cycle; fire-and-forget so a stray cart never unwinds a
      // captured payment (it expires via TTL regardless).
      const cartToken = order.idempotencyKey?.startsWith('cart_') ? order.idempotencyKey.slice(5) : null;
      if (cartToken) void import('./cart.service.js').then(({ cartService }) => cartService.clear(cartToken)).catch(() => { /* TTL cleans it up */ });

      // Submit to EVERY push vendor at the paid edge — Printful (confirm draft),
      // Printify + Contrado (create + send to production, deferred from checkout
      // so unpaid carts aren't billed and the address PayPal express only
      // provides post-payment is present). Dup-safe + retried hourly by the
      // worker if a vendor blips.
      const routable = await db.order.findUnique({ where: { id }, include: orderInclude });
      if (routable) void submitPaidOrder(routable).catch(() => { /* recorded in fulfillment_routes */ });

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
