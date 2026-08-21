import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { nexusBridge } from './nexusBridge.js';

// Counter — fulfilment.
//
// Ported from Counter 0.45's OrderShipment + ShipmentReadyToRoute. The point
// of a separate entity, rather than Woo's single order-level tracking field:
// one order can ship in pieces. A basket spanning two vendors, or part
// in-stock and part print-on-demand, is two or three shipments with their own
// carriers, tracking numbers and timelines. Woo cannot represent that without
// a plugin, and every "where is the rest of my order" support ticket comes
// from pretending an order is one parcel.
//
// Shipments are grouped by vendor because that is who actually ships: the
// store itself (vendorId null) or a specific vendor/POD partner.

export type ShipmentStatus = 'pending' | 'quoted' | 'routed' | 'shipped' | 'delivered' | 'cancelled';

/** Legal moves. Anything else throws rather than silently corrupting state. */
const TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: ['quoted', 'routed', 'cancelled'],
  quoted: ['routed', 'cancelled'],
  routed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const shipmentService = {
  /**
   * Splits a paid order into one shipment per fulfilling party.
   *
   * Idempotent: an order already split is returned as-is. Payment webhooks
   * retry, and a duplicate delivery must not double the parcels.
   */
  async planForOrder(orderId: string) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { variant: { include: { product: true } } } },
        shipments: true,
        // Order-level address wins: it is what was captured at checkout and
        // is the historical record of where THIS parcel went. The customer's
        // saved default is only a fallback for orders placed before that field
        // existed — a customer editing their address later must not rewrite
        // where a past shipment was sent.
        customer: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
      },
    });
    if (!order) throw new NotFoundError('Order not found', 'orderId');
    if (order.shipments.length > 0) return order.shipments;

    const onOrder = (order.shipAddress ?? {}) as Record<string, unknown>;
    const addr = order.customer?.addresses?.[0];
    const shipAddress = Object.keys(onOrder).length > 0
      ? onOrder
      : addr
      ? {
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          region: addr.region,
          postalCode: addr.postalCode,
          country: addr.country,
        }
      : {};

    // One shipment per distinct vendor. `null` groups everything the store
    // fulfils itself, which is the common single-shipment case.
    const byVendor = new Map<string | null, true>();
    for (const item of order.items) {
      byVendor.set(item.variant?.product?.vendorId ?? null, true);
    }
    if (byVendor.size === 0) byVendor.set(null, true);

    const created = [];
    for (const vendorId of byVendor.keys()) {
      const shipment = await db.orderShipment.create({
        data: { orderId, vendorId, status: 'pending', shipAddress: shipAddress as object },
      });
      created.push(shipment);
      // NOTE: fulfilment routing is NOT event-driven — it runs directly via
      // routeOrder() in order.service at checkout/paid. An earlier
      // bus.emit('shipment.ready') here fired into zero subscribers, so it was
      // removed rather than left as a misleading no-op.
    }
    return created;
  },

  async get(id: string) {
    const s = await db.orderShipment.findUnique({ where: { id } });
    if (!s) throw new NotFoundError('Shipment not found', 'id');
    return s;
  },

  async listForOrder(orderId: string) {
    return db.orderShipment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  },

  /** Records a provider quote. Money arrives in minor units, like everywhere. */
  async recordQuote(id: string, quote: { provider: string; method?: string; ref?: string; shippingTotal: number; taxTotal?: number }) {
    const current = await this.get(id);
    assertTransition(current.status as ShipmentStatus, 'quoted');
    // No address, no quote. A rate calculated against nowhere is worse than
    // no rate — it looks authoritative and bills the customer for it.
    if (!current.shipAddress || Object.keys(current.shipAddress as object).length === 0) {
      throw new ValidationError('This shipment has no address yet — attach one before quoting.', 'shipAddress');
    }
    if (!Number.isInteger(quote.shippingTotal) || quote.shippingTotal < 0) {
      throw new ValidationError('Shipping total must be a whole number of minor units.', 'shippingTotal');
    }
    return db.orderShipment.update({
      where: { id },
      data: {
        status: 'quoted',
        shippingProvider: quote.provider,
        shippingMethod: quote.method ?? null,
        quoteRef: quote.ref ?? null,
        quotedAt: new Date(),
        shippingTotal: quote.shippingTotal,
        taxTotal: quote.taxTotal ?? 0,
      },
    });
  },

  /**
   * Hands the shipment to whoever fulfils it (POD partner, warehouse).
   *
   * The provider is resolved through Nexus, not taken on trust: it must be a
   * real fulfilment provider WITH a live credential in the vault. Before this,
   * any string was accepted — so `route(id, 'pintrful')` produced a shipment
   * marked routed to a provider that does not exist, and nobody found out
   * until the parcel never arrived. Null means the store fulfils it itself.
   */
  async route(id: string, podProvider: string | null) {
    const current = await this.get(id);
    assertTransition(current.status as ShipmentStatus, 'routed');
    if (podProvider) await nexusBridge.require(podProvider, 'fulfillment');
    return db.orderShipment.update({ where: { id }, data: { status: 'routed', podProvider } });
  },

  /** Tracking is REQUIRED to mark shipped — "shipped, no tracking" helps nobody. */
  async markShipped(id: string, tracking: { carrier: string; number: string }) {
    const current = await this.get(id);
    assertTransition(current.status as ShipmentStatus, 'shipped');
    if (!tracking.carrier.trim() || !tracking.number.trim()) {
      throw new ValidationError('Carrier and tracking number are both required to mark a shipment shipped.', 'tracking');
    }
    return db.orderShipment.update({
      where: { id },
      data: { status: 'shipped', trackingCarrier: tracking.carrier, trackingNumber: tracking.number, shippedAt: new Date() },
    });
  },

  async markDelivered(id: string) {
    const current = await this.get(id);
    assertTransition(current.status as ShipmentStatus, 'delivered');
    return db.orderShipment.update({ where: { id }, data: { status: 'delivered', deliveredAt: new Date() } });
  },

  async cancel(id: string) {
    const current = await this.get(id);
    assertTransition(current.status as ShipmentStatus, 'cancelled');
    return db.orderShipment.update({ where: { id }, data: { status: 'cancelled' } });
  },
};

function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError(`A ${from} shipment cannot become ${to}.`, 'status');
  }
}
