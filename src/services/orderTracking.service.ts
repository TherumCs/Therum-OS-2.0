import { timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { carrierName, trackingUrl } from '../counter/carriers.js';

// Public order tracking.
//
// WHY THE ORDER NUMBER IS NOT ENOUGH ON ITS OWN. It identifies an order; it
// does not prove you placed it. On its own it would hand anyone who guesses or
// finds one a shopper's name, what they bought and where it is going — and
// order numbers carry a date prefix, so the guessing space is far smaller than
// its length suggests. The rest of this codebase already takes that position:
// the receipt page requires a 32-hex access token, and the account order list
// requires a session.
//
// So tracking takes number + EMAIL, compared in constant time, or a signed-in
// customer who owns the order. That is the same bar every real store sets, and
// the email is something the shopper has in front of them.

export interface TrackedShipment {
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: Date | null;
  estimatedDelivery: Date | null;
  deliveredAt: Date | null;
  items: { name: string; quantity: number; image: string | null; slug: string | null }[];
}

export interface TrackedOrder {
  number: string;
  status: string;
  placedAt: Date;
  total: number;
  currency: string;
  /** City + country only. The full address is not needed to say where it is going. */
  destination: string | null;
  items: { name: string; quantity: number; image: string | null; slug: string | null; sku: string | null }[];
  shipments: TrackedShipment[];
}

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  // Length is compared first because timingSafeEqual throws on a mismatch —
  // it leaks length either way, which is not the secret here.
  return x.length === y.length && timingSafeEqual(x, y);
}

function destinationOf(addr: unknown): string | null {
  const a = addr as { city?: unknown; country?: unknown; region?: unknown } | null;
  const parts = [a?.city, a?.region, a?.country].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return parts.length ? parts.join(', ') : null;
}

export const orderTrackingService = {
  /**
   * @param customerId a VERIFIED session's customer, when there is one. It
   * replaces the email check entirely — a signed-in shopper should not have to
   * retype the address their account already holds.
   */
  async track(number: string, email: string | null, customerId: string | null): Promise<TrackedOrder | null> {
    const order = await db.order.findUnique({
      where: { number: number.trim() },
      select: {
        number: true, status: true, createdAt: true, total: true, currency: true,
        guestEmail: true, customerId: true, shipAddress: true,
        customer: { select: { email: true } },
        items: {
          select: {
            quantity: true,
            variant: { select: { sku: true, product: { select: { name: true, slug: true, image: true } } } },
          },
        },
        shipments: {
          orderBy: { createdAt: 'asc' },
          select: {
            status: true, trackingCarrier: true, trackingNumber: true,
            shippedAt: true, estimatedDelivery: true, deliveredAt: true,
          },
        },
      },
    });
    if (!order) return null;

    // Either proof works. Neither means no.
    const ownsIt = Boolean(customerId && order.customerId === customerId);
    const emailMatches = Boolean(
      email && ((order.guestEmail && eq(order.guestEmail, email)) || (order.customer?.email && eq(order.customer.email, email))),
    );
    if (!ownsIt && !emailMatches) return null;

    const items = order.items.map((i) => ({
      name: i.variant?.product?.name ?? 'Item',
      quantity: i.quantity,
      image: i.variant?.product?.image ?? null,
      slug: i.variant?.product?.slug ?? null,
      sku: i.variant?.sku ?? null,
    }));

    return {
      number: order.number,
      status: order.status,
      placedAt: order.createdAt,
      total: order.total,
      currency: order.currency,
      destination: destinationOf(order.shipAddress),
      items,
      shipments: order.shipments.map((s) => ({
        status: s.status,
        carrier: carrierName(s.trackingCarrier),
        trackingNumber: s.trackingNumber,
        trackingUrl: trackingUrl(s.trackingCarrier, s.trackingNumber),
        shippedAt: s.shippedAt,
        estimatedDelivery: s.estimatedDelivery,
        deliveredAt: s.deliveredAt,
        // Which lines are in which shipment is not modelled yet, so a
        // shipment shows the order's items rather than claiming a split it
        // cannot actually describe.
        items,
      })),
    };
  },
};
