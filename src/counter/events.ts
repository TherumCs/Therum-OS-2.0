import { logger } from '../lib/logger.js';

// Counter — typed event bus.
//
// Ported from Counter 0.45's Events/EventBus.php, which exists to replace
// WordPress hook spam: `do_action('woocommerce_...')` with array payloads,
// where ordering is guesswork and a typo in the hook name fails silently.
// Here a subscriber receives one typed event object and the compiler checks it.
//
// Two dispatch modes, same split as the PHP original:
//
//   dispatch(e)  synchronous, inline, in registration order. Throws on a
//                subscriber error so the caller — usually inside a database
//                transaction — decides whether to roll back.
//
//   emit(e)      fire-and-forget. Subscriber errors are logged, never thrown,
//                and never block the caller. For side-effects that must not
//                fail the order: emails, webhooks, analytics.
//
// Deliberately NO priorities. Subscribers run in registration order. If you
// need ordered computation, that is what a pipeline is for — events are for
// side-effects. Priority numbers are how Woo's hook ordering became a guessing
// game, and they are not coming back.

/** Every event carries its own type tag; the name is the subscription key. */
export interface CounterEvent {
  readonly name: string;
  readonly at: Date;
}

export type Subscriber<E extends CounterEvent> = (event: E) => void | Promise<void>;

export class EventBus {
  private readonly subscribers = new Map<string, Subscriber<never>[]>();

  /** Register a subscriber. Returns an unsubscribe function. */
  on<E extends CounterEvent>(name: E['name'], fn: Subscriber<E>): () => void {
    const list = this.subscribers.get(name) ?? [];
    list.push(fn as Subscriber<never>);
    this.subscribers.set(name, list);
    return () => {
      const current = this.subscribers.get(name);
      if (!current) return;
      const i = current.indexOf(fn as Subscriber<never>);
      if (i >= 0) current.splice(i, 1);
    };
  }

  /**
   * Synchronous dispatch. Subscribers run in order and a throw propagates —
   * call this inside a transaction when a failed subscriber should roll the
   * whole operation back.
   */
  async dispatch<E extends CounterEvent>(event: E): Promise<void> {
    for (const fn of this.subscribers.get(event.name) ?? []) {
      await (fn as Subscriber<E>)(event);
    }
  }

  /**
   * Fire-and-forget. A broken email provider must never fail a paid order, so
   * subscriber errors are logged and swallowed. Awaiting is optional and only
   * useful in tests.
   */
  async emit<E extends CounterEvent>(event: E): Promise<void> {
    for (const fn of this.subscribers.get(event.name) ?? []) {
      try {
        await (fn as Subscriber<E>)(event);
      } catch (err) {
        logger.error({ err, event: event.name }, 'counter event subscriber failed');
      }
    }
  }

  /** Test seam — asserting on wiring beats asserting on side-effects. */
  subscriberCount(name: string): number {
    return (this.subscribers.get(name) ?? []).length;
  }
}

// ─── Event definitions ─────────────────────────────────────────────────────
// One interface per event, `name` as a literal so `on()` and `dispatch()` are
// checked against each other. Adding an event here is the whole registration.

export interface CartItemAdded extends CounterEvent {
  name: 'cart.item.added';
  cartId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface CartItemUpdated extends CounterEvent {
  name: 'cart.item.updated';
  cartId: string;
  itemId: string;
  quantity: number;
}

export interface CartItemRemoved extends CounterEvent {
  name: 'cart.item.removed';
  cartId: string;
  itemId: string;
}

export interface OrderCreated extends CounterEvent {
  name: 'order.created';
  orderId: string;
  total: number;
  currency: string;
}

export interface OrderPaid extends CounterEvent {
  name: 'order.paid';
  orderId: string;
  total: number;
  currency: string;
  gateway: string;
}

export interface OrderRefunded extends CounterEvent {
  name: 'order.refunded';
  orderId: string;
  refundId: string;
  amount: number;
}

export interface ShipmentReadyToRoute extends CounterEvent {
  name: 'shipment.ready';
  orderId: string;
  vendorId: string | null;
}

/** Convenience constructors — every event gets its timestamp the same way. */
export const event = {
  cartItemAdded: (p: Omit<CartItemAdded, 'name' | 'at'>): CartItemAdded => ({ name: 'cart.item.added', at: new Date(), ...p }),
  cartItemUpdated: (p: Omit<CartItemUpdated, 'name' | 'at'>): CartItemUpdated => ({ name: 'cart.item.updated', at: new Date(), ...p }),
  cartItemRemoved: (p: Omit<CartItemRemoved, 'name' | 'at'>): CartItemRemoved => ({ name: 'cart.item.removed', at: new Date(), ...p }),
  orderCreated: (p: Omit<OrderCreated, 'name' | 'at'>): OrderCreated => ({ name: 'order.created', at: new Date(), ...p }),
  orderPaid: (p: Omit<OrderPaid, 'name' | 'at'>): OrderPaid => ({ name: 'order.paid', at: new Date(), ...p }),
  orderRefunded: (p: Omit<OrderRefunded, 'name' | 'at'>): OrderRefunded => ({ name: 'order.refunded', at: new Date(), ...p }),
  shipmentReady: (p: Omit<ShipmentReadyToRoute, 'name' | 'at'>): ShipmentReadyToRoute => ({ name: 'shipment.ready', at: new Date(), ...p }),
};

/** Process-wide bus. One instance; subscribers register at boot. */
export const bus = new EventBus();
