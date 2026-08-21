// Public order tracking: what it shows, and who it refuses.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { recomputeReservations } from './support/reservations.mjs';
import { ensureSiteVisible } from './support/publicSite.mjs';

let app, vendor, product, order;
const EMAIL = 'tracktest-buyer@example.test';

before(async () => {
  // A dev box left in coming-soon mode serves the launch page to every
  // public request, and these assertions then fail on content.
  await ensureSiteVisible();
  app = await buildServer();
  const { redis } = await import('../dist/lib/redis.js');
  await redis.del('ratelimit:cart-new:127.0.0.1');
  await redis.del('ratelimit:track:127.0.0.1');

  await db.order.deleteMany({ where: { guestEmail: EMAIL } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: 'tracktest-tee' } }).catch(() => {});
  await db.vendor.deleteMany({ where: { name: 'tracktest Vendor' } }).catch(() => {});

  vendor = await db.vendor.create({ data: { name: 'tracktest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'tracktest Tee', slug: 'tracktest-tee', status: 'active', vendorId: vendor.id,
      variants: { create: [{ sku: 'TRK-1', price: 2500, inventory: 5 }] },
    },
    include: { variants: true },
  });

  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: product.variants[0].id, quantity: 1 } });
  const out = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: add.json().token, email: EMAIL } });
  order = await db.order.findUnique({ where: { number: out.json().orderNumber } });
  await db.order.update({ where: { id: order.id }, data: { shipAddress: { city: 'Philadelphia', region: 'PA', country: 'US' } } });
});

after(async () => {
  await db.orderShipment.deleteMany({ where: { orderId: order?.id } }).catch(() => {});
  await db.order.deleteMany({ where: { guestEmail: EMAIL } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: 'tracktest-tee' } }).catch(() => {});
  await db.vendor.deleteMany({ where: { name: 'tracktest Vendor' } }).catch(() => {});
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

const track = (payload) => app.inject({ method: 'POST', url: '/api/orders/track', payload });

describe('order tracking', () => {
  test('number + email returns the order, its items and where it is going', async () => {
    const res = await track({ number: order.number, email: EMAIL });
    assert.equal(res.statusCode, 200, res.body);
    const o = res.json().order;
    assert.equal(o.number, order.number);
    assert.equal(o.items[0].name, 'tracktest Tee');
    assert.equal(o.destination, 'Philadelphia, PA, US');
  });

  test('the email is required — a number alone is not proof you placed it', async () => {
    const res = await track({ number: order.number });
    assert.equal(res.statusCode, 404);
  });

  test('a wrong email and an unknown number give the SAME answer', async () => {
    // Splitting these would confirm which order numbers are real without
    // ever knowing an address — an enumeration oracle.
    const wrongEmail = await track({ number: order.number, email: 'someone@else.test' });
    const noSuchOrder = await track({ number: 'THR-00000000-0000000000', email: EMAIL });
    assert.equal(wrongEmail.statusCode, noSuchOrder.statusCode);
    assert.equal(wrongEmail.json().error.message, noSuchOrder.json().error.message);
  });

  test('the email match is case-insensitive, because typing it back is not a memory test', async () => {
    const res = await track({ number: order.number, email: EMAIL.toUpperCase() });
    assert.equal(res.statusCode, 200);
  });

  test('a shipment surfaces the carrier, a real tracking link and the dates', async () => {
    await db.orderShipment.create({
      data: {
        orderId: order.id, status: 'shipped',
        // Free text, as a provider or a human would actually write it.
        trackingCarrier: 'UPS Ground', trackingNumber: '1Z999AA10123456784',
        shippedAt: new Date('2026-07-20'), estimatedDelivery: new Date('2026-07-24'),
        shipAddress: {},
      },
    });
    const s = (await track({ number: order.number, email: EMAIL })).json().order.shipments[0];
    assert.equal(s.carrier, 'UPS', 'free-text carrier is normalised');
    assert.match(s.trackingUrl, /ups\.com.*1Z999AA10123456784/);
    assert.ok(s.estimatedDelivery);
  });

  test('an unknown carrier gets no link rather than a guessed one', async () => {
    await db.orderShipment.deleteMany({ where: { orderId: order.id } });
    await db.orderShipment.create({
      data: { orderId: order.id, status: 'shipped', trackingCarrier: 'Barry Van Hire', trackingNumber: 'ABC123', shipAddress: {} },
    });
    const s = (await track({ number: order.number, email: EMAIL })).json().order.shipments[0];
    // A link that 404s on the carrier's site is worse than none — the shopper
    // blames the store for losing the parcel.
    assert.equal(s.trackingUrl, null);
    assert.equal(s.carrier, 'Barry Van Hire', 'but we still say who has it');
  });
});
