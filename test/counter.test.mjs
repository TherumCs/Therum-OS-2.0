// Counter — typed event bus + cart totals pipeline.
// Imports from dist/ like the rest of the suite (npm test globs *.test.mjs and
// runs with --env-file=.env, which the logger's env schema requires).
import { test, describe } from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { EventBus, event } from '../dist/counter/events.js';
import { defaultPipeline, contextFor } from '../dist/counter/totalsPipeline.js';
import { shipmentService } from '../dist/counter/shipmentService.js';
import { reviewService } from '../dist/counter/reviewService.js';
import { reportService } from '../dist/counter/reportService.js';
import { customerAuth } from '../dist/counter/customerAuth.js';
import { socialSignIn, clearJwksCache } from '../dist/counter/socialSignIn.js';
import { storeCredentials } from '../dist/counter/storeCredentials.js';
import { encryptSecret } from '../dist/lib/crypto.js';
import { authEventService } from '../dist/services/authEvent.service.js';
import { formatMoney, toMinor, toMajor, currencyInfo } from '../dist/counter/currency.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';
import { after, before, beforeEach } from 'node:test';
import { purgeTestCustomers } from './support/testCustomers.mjs';

// closeQueues() AND disconnectDb(). customerAuth's rate limiter opens the lazy
// Redis client, and queue.ts documents exactly this: any one of these left
// open holds a live socket that keeps the event loop alive forever, which
// presents as "the test run finished but never exited".
after(async () => {
  await purgeTestCustomers();
  await closeQueues();
  await disconnectDb();
});

// Real fulfilment provider ids, for the "not connected" assertion below.
const FULFILMENT_IDS = ['gooten', 'spod', 'podplus', 'podpartner', 'tapstitch', 'contrado', 'gelato', 'printify', 'printful'];

const line = (over = {}) => ({
  itemId: 'i1', productId: 'p1', variantId: null, quantity: 2, unitPrice: 1000, lineTotal: 2000, ...over,
});

describe('counter event bus', () => {
  test('delivers a typed event to its subscriber', async () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('order.paid', (e) => { seen.push(e.orderId); });
    await bus.dispatch(event.orderPaid({ orderId: 'o1', total: 2000, currency: 'USD', gateway: 'mock' }));
    assert.deepEqual(seen, ['o1']);
  });

  test('runs subscribers in registration order', async () => {
    const bus = new EventBus();
    const order = [];
    bus.on('order.created', () => order.push(1));
    bus.on('order.created', () => order.push(2));
    await bus.dispatch(event.orderCreated({ orderId: 'o1', total: 1, currency: 'USD' }));
    assert.deepEqual(order, [1, 2]);
  });

  test('dispatch propagates a subscriber error so a transaction can roll back', async () => {
    const bus = new EventBus();
    bus.on('order.paid', () => { throw new Error('boom'); });
    await assert.rejects(
      () => bus.dispatch(event.orderPaid({ orderId: 'o1', total: 1, currency: 'USD', gateway: 'mock' })),
      /boom/,
    );
  });

  test('emit swallows subscriber errors — a broken email must not fail a paid order', async () => {
    const bus = new EventBus();
    const after = [];
    bus.on('order.paid', () => { throw new Error('smtp down'); });
    bus.on('order.paid', () => after.push('still ran'));
    await bus.emit(event.orderPaid({ orderId: 'o1', total: 1, currency: 'USD', gateway: 'mock' }));
    assert.deepEqual(after, ['still ran']);
  });

  test('unsubscribes', () => {
    const bus = new EventBus();
    const off = bus.on('order.created', () => {});
    assert.equal(bus.subscriberCount('order.created'), 1);
    off();
    assert.equal(bus.subscriberCount('order.created'), 0);
  });
});

describe('counter totals pipeline', () => {
  test('sums line totals into the subtotal', async () => {
    const ctx = await defaultPipeline().run(contextFor([line(), line({ itemId: 'i2', lineTotal: 500 })], 'USD'));
    assert.equal(ctx.subtotal, 2500);
    assert.equal(ctx.total, 2500);
  });

  test('applies only the single largest discount — no stacking', async () => {
    const ctx = await defaultPipeline([
      { amount: 500, label: 'Member' },
      { amount: 1200, label: 'Launch' },
      { amount: 200, label: 'Newsletter' },
    ]).run(contextFor([line()], 'USD'));
    assert.equal(ctx.discount.label, 'Launch');
    assert.equal(ctx.discount.amount, 1200);
    assert.equal(ctx.total, 800);
  });

  test('never discounts below zero', async () => {
    const ctx = await defaultPipeline([{ amount: 50000, label: 'Oops' }]).run(contextFor([line()], 'USD'));
    assert.equal(ctx.discount.amount, 2000);
    assert.equal(ctx.total, 0);
  });

  test('adds shipping and tax on top of the discounted subtotal', async () => {
    const ctx = contextFor([line()], 'USD'); // 2000 cents
    ctx.shipping = 450;
    ctx.tax = 125;
    await defaultPipeline([{ amount: 1000, label: 'Half' }]).run(ctx);
    assert.equal(ctx.total, 1575); // (2000 - 1000) + 450 + 125
  });

  test('money stays in whole minor units — a fractional cent never survives', async () => {
    // Values are CENTS. A tax/shipping provider handing back a half-cent must
    // not leave a non-integer heading for an Int column.
    const ctx = contextFor([line({ lineTotal: 1999 }), line({ itemId: 'i2', lineTotal: 1 })], 'USD');
    ctx.shipping = 499.5;
    ctx.tax = 0.4;
    await defaultPipeline().run(ctx);
    for (const v of [ctx.subtotal, ctx.shipping, ctx.tax, ctx.total]) {
      assert.ok(Number.isInteger(v), `${v} is not a whole minor unit`);
    }
    assert.equal(ctx.total, ctx.subtotal + ctx.shipping + ctx.tax);
  });

  test('exposes its order — the order IS the contract', () => {
    assert.deepEqual(defaultPipeline().order, ['subtotal', 'discount', 'shipping', 'tax', 'total']);
  });
});

describe('counter shipments', () => {
  // Real rows: fulfilment state is exactly where an in-memory fake would hide
  // the transaction and relation bugs worth catching.
  const made = { orders: [], customers: [] };

  after(async () => {
    for (const id of made.orders) await db.order.delete({ where: { id } }).catch(() => {});
    for (const id of made.customers) await db.customer.delete({ where: { id } }).catch(() => {});
  });

  async function orderWithAddress() {
    const customer = await db.customer.create({
      data: {
        email: `ship-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        name: 'Ship Test',
        addresses: { create: { line1: '1 Test St', city: 'Testville', country: 'US', isDefault: true } },
      },
    });
    made.customers.push(customer.id);
    const order = await db.order.create({
      data: { number: `T-${Date.now()}${Math.floor(Math.random() * 1000)}`, status: 'processing', customerId: customer.id, total: 2000, currency: 'USD' },
    });
    made.orders.push(order.id);
    return order;
  }

  test('splits a paid order into a shipment and carries the customer address', async () => {
    const order = await orderWithAddress();
    const shipments = await shipmentService.planForOrder(order.id);
    assert.equal(shipments.length, 1);
    assert.equal(shipments[0].status, 'pending');
    assert.equal(shipments[0].shipAddress.city, 'Testville');
  });

  test('is idempotent — a retried payment webhook must not double the parcels', async () => {
    const order = await orderWithAddress();
    await shipmentService.planForOrder(order.id);
    await shipmentService.planForOrder(order.id);
    assert.equal((await shipmentService.listForOrder(order.id)).length, 1);
  });

  test('refuses to quote a shipment with no address', async () => {
    const order = await db.order.create({
      data: { number: `G-${Date.now()}${Math.floor(Math.random() * 1000)}`, status: 'processing', total: 500, currency: 'USD', guestEmail: 'guest@test.local' },
    });
    made.orders.push(order.id);
    const [shipment] = await shipmentService.planForOrder(order.id);
    assert.deepEqual(shipment.shipAddress, {});
    await assert.rejects(
      () => shipmentService.recordQuote(shipment.id, { provider: 'mock', shippingTotal: 500 }),
      /no address/i,
    );
  });

  test('walks the full lifecycle and rejects an illegal jump', async () => {
    const order = await orderWithAddress();
    const [s0] = await shipmentService.planForOrder(order.id);
    await assert.rejects(() => shipmentService.markDelivered(s0.id), /cannot become delivered/i);

    await shipmentService.recordQuote(s0.id, { provider: 'mock', shippingTotal: 499 });
    // Routing to a provider with no Nexus connection is refused — Counter
    // keeps no keys of its own, so an unconnected provider cannot fulfil.
    //
    // Uses a CUSTOM id rather than a real provider on purpose: this suite runs
    // against the development database, so naming a real one made the test
    // pass only while nobody had connected it. The moment Printful was
    // connected for real, this assertion failed — a green suite that depended
    // on the operator not using the product.
    // The provider is CHOSEN AT RUN TIME from whichever fulfilment providers
    // have no connection row, because this suite runs against the development
    // database. Hardcoding one made the test pass only while nobody had
    // connected it — it broke the moment Printful was connected for real,
    // which is a green suite depending on the operator not using the product.
    const connected = new Set((await db.connection.findMany({ select: { provider: true } })).map((c) => c.provider));
    const unconnected = FULFILMENT_IDS.find((id) => !connected.has(id));
    assert.ok(unconnected, 'every fulfilment provider is connected — this assertion needs an unconnected one');
    await assert.rejects(() => shipmentService.route(s0.id, unconnected), /isn't connected yet/i);
    // null = the store fulfils it itself, which needs no provider.
    await shipmentService.route(s0.id, null);
    await assert.rejects(
      () => shipmentService.markShipped(s0.id, { carrier: '', number: '' }),
      /carrier and tracking number/i,
    );
    const shipped = await shipmentService.markShipped(s0.id, { carrier: 'UPS', number: '1Z999' });
    assert.equal(shipped.status, 'shipped');
    assert.ok(shipped.shippedAt);
    const delivered = await shipmentService.markDelivered(s0.id);
    assert.equal(delivered.status, 'delivered');
  });

  test('rejects a provider Nexus has never heard of — catches a typo, not a 401 later', async () => {
    const order = await orderWithAddress();
    const [s0] = await shipmentService.planForOrder(order.id);
    await assert.rejects(() => shipmentService.route(s0.id, 'pintrful'), /not a provider Nexus knows about/i);
  });

  test('rejects a provider from the wrong category', async () => {
    const order = await orderWithAddress();
    const [s0] = await shipmentService.planForOrder(order.id);
    // Stripe is real and may even be connected — but it is a payments
    // provider and cannot fulfil a parcel.
    await assert.rejects(() => shipmentService.route(s0.id, 'stripe'), /payments provider/i);
  });

  test('an order-level address is used for shipments, so a guest can ship', async () => {
    const order = await db.order.create({
      data: {
        number: `A-${Date.now()}${Math.floor(Math.random() * 1000)}`,
        status: 'processing', total: 500, currency: 'USD', guestEmail: 'guest@test.local',
        shipAddress: { line1: '9 Guest Rd', city: 'Guestown', country: 'GB' },
      },
    });
    made.orders.push(order.id);
    const [shipment] = await shipmentService.planForOrder(order.id);
    assert.equal(shipment.shipAddress.city, 'Guestown');
    // and it can now actually be quoted, which was impossible before
    const quoted = await shipmentService.recordQuote(shipment.id, { provider: 'mock', shippingTotal: 499 });
    assert.equal(quoted.status, 'quoted');
  });

  test('rejects a fractional-cent shipping total', async () => {
    const order = await orderWithAddress();
    const [s0] = await shipmentService.planForOrder(order.id);
    await assert.rejects(
      () => shipmentService.recordQuote(s0.id, { provider: 'mock', shippingTotal: 499.5 }),
      /whole number of minor units/i,
    );
  });
});

describe('counter reviews', () => {
  const made = { products: [], variants: [], orders: [], customers: [], reviews: [] };

  after(async () => {
    for (const id of made.reviews) await db.productReview.delete({ where: { id } }).catch(() => {});
    for (const id of made.orders) await db.order.delete({ where: { id } }).catch(() => {});
    for (const id of made.products) await db.product.delete({ where: { id } }).catch(() => {});
    for (const id of made.customers) await db.customer.delete({ where: { id } }).catch(() => {});
  });

  async function product() {
    const p = await db.product.create({
      data: { name: 'Review Test', slug: `rev-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'active' },
    });
    made.products.push(p.id);
    const v = await db.productVariant.create({ data: { productId: p.id, price: 1000, inventory: 5 } });
    made.variants.push(v.id);
    return { p, v };
  }

  test('a review lands pending — an unmoderated form is a spam endpoint', async () => {
    const { p } = await product();
    const r = await reviewService.submit({
      productId: p.id, reviewerName: 'Ann', reviewerEmail: 'ann@test.local', rating: 5, body: 'Great',
    });
    made.reviews.push(r.id);
    assert.equal(r.status, 'pending');
    assert.equal(r.verified, false);
  });

  test('verified is computed from real purchase history, not supplied', async () => {
    const { p, v } = await product();
    const order = await db.order.create({
      data: {
        number: `R-${Date.now()}${Math.floor(Math.random() * 1000)}`, status: 'delivered',
        total: 1000, currency: 'USD', guestEmail: 'buyer@test.local',
        items: { create: { variantId: v.id, quantity: 1, priceAtTime: 1000 } },
      },
    });
    made.orders.push(order.id);

    const bought = await reviewService.submit({
      productId: p.id, reviewerName: 'Buyer', reviewerEmail: 'BUYER@test.local', rating: 4, body: 'Bought it',
    });
    made.reviews.push(bought.id);
    assert.equal(bought.verified, true, 'a real guest purchase counts as verified');

    const stranger = await reviewService.submit({
      productId: p.id, reviewerName: 'Nope', reviewerEmail: 'stranger@test.local', rating: 1, body: 'Never bought',
    });
    made.reviews.push(stranger.id);
    assert.equal(stranger.verified, false);
  });

  test('rejects an out-of-range rating', async () => {
    const { p } = await product();
    await assert.rejects(
      () => reviewService.submit({ productId: p.id, reviewerName: 'X', reviewerEmail: 'x@test.local', rating: 6, body: 'hi' }),
      /1 to 5/,
    );
  });

  test('public listing shows only approved reviews and never leaks emails', async () => {
    const { p } = await product();
    const pending = await reviewService.submit({
      productId: p.id, reviewerName: 'Pending', reviewerEmail: 'p@test.local', rating: 3, body: 'waiting',
    });
    made.reviews.push(pending.id);
    assert.equal((await reviewService.listPublic(p.id)).length, 0, 'pending must not be public');

    await reviewService.setStatus(pending.id, 'approved');
    const listed = await reviewService.listPublic(p.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].reviewerEmail, undefined, 'email is PII and must not be returned');
  });

  test('summary averages approved reviews only', async () => {
    const { p } = await product();
    for (const rating of [5, 3]) {
      const r = await reviewService.submit({
        productId: p.id, reviewerName: 'R', reviewerEmail: `r${rating}@test.local`, rating, body: 'x',
      });
      made.reviews.push(r.id);
      await reviewService.setStatus(r.id, 'approved');
    }
    const spam = await reviewService.submit({
      productId: p.id, reviewerName: 'S', reviewerEmail: 's@test.local', rating: 1, body: 'spam',
    });
    made.reviews.push(spam.id);
    await reviewService.setStatus(spam.id, 'spam');

    const sum = await reviewService.summary(p.id);
    assert.equal(sum.count, 2);
    assert.equal(sum.average, 4); // (5+3)/2 — the 1-star spam is excluded
  });
});

describe('counter currency', () => {
  test('formats from MINOR units, per currency', () => {
    assert.match(formatMoney(1999, 'USD'), /\$19\.99/);
    assert.match(formatMoney(1999, 'GBP'), /£19\.99/);
  });

  test('zero-decimal currencies are not divided by 100', () => {
    // The classic 100x bug: JPY has no minor unit, so 1000 is ¥1,000.
    assert.equal(currencyInfo('JPY').minorUnits, 0);
    assert.match(formatMoney(1000, 'JPY'), /1,000/);
    assert.doesNotMatch(formatMoney(1000, 'JPY'), /10\.00/);
    assert.equal(toMinor(1000, 'JPY'), 1000);
    assert.equal(toMajor(1000, 'JPY'), 1000);
  });

  test('major <-> minor round-trips', () => {
    assert.equal(toMinor(19.99, 'USD'), 1999);
    assert.equal(toMajor(1999, 'USD'), 19.99);
  });

  test('rejects an unsupported currency instead of formatting nonsense', () => {
    assert.throws(() => formatMoney(100, 'XYZ'), /not a currency/i);
  });
});

describe('counter reports', () => {
  const made = { orders: [], products: [], variants: [] };
  const from = new Date(Date.now() - 7 * 864e5);
  const to = new Date(Date.now() + 864e5);

  after(async () => {
    for (const id of made.orders) await db.order.delete({ where: { id } }).catch(() => {});
    for (const id of made.products) await db.product.delete({ where: { id } }).catch(() => {});
  });

  async function order(total, refunded, status = 'delivered') {
    const o = await db.order.create({
      data: {
        number: `RPT-${Date.now()}${Math.floor(Math.random() * 10000)}`,
        status, total, refundedTotal: refunded, currency: 'USD',
      },
    });
    made.orders.push(o.id);
    return o;
  }

  test('revenue is NET of refunds — a report that ignores them overstates takings', async () => {
    await order(10000, 2500);
    await order(5000, 0);
    const s = await reportService.salesSummary({ from, to });
    assert.ok(s.gross >= 15000);
    assert.ok(s.refunded >= 2500);
    assert.equal(s.net, s.gross - s.refunded);
  });

  test('excludes pending and failed orders — they never took money', async () => {
    const before = await reportService.salesSummary({ from, to });
    await order(99999, 0, 'pending');
    await order(88888, 0, 'failed');
    const after = await reportService.salesSummary({ from, to });
    assert.equal(after.gross, before.gross, 'non-revenue orders must not inflate takings');
  });

  test('but ordersByStatus DOES show them — "how many are stuck pending" is the question', async () => {
    const counts = await reportService.ordersByStatus({ from, to });
    assert.ok((counts.pending ?? 0) >= 1);
  });

  test('series has a point for every day, including empty ones', async () => {
    const series = await reportService.salesSeries({ from, to });
    assert.equal(series.length, 9); // 7 days back + today + 1 forward, inclusive
    assert.ok(series.every((p) => typeof p.net === 'number'));
  });

  test('empty period gives 0, never NaN', async () => {
    const old = new Date('2001-01-01');
    const s = await reportService.salesSummary({ from: old, to: new Date('2001-01-31') });
    assert.equal(s.orders, 0);
    assert.equal(s.averageOrderValue, 0);
  });

  test('rejects a backwards date range', async () => {
    await assert.rejects(
      () => reportService.salesSummary({ from: to, to: from }),
      /start date is after/i,
    );
  });
});

describe('counter customer accounts', () => {
  const made = { customers: [], orders: [] };
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;

  after(async () => {
    for (const id of made.orders) await db.order.delete({ where: { id } }).catch(() => {});
    for (const id of made.customers) await db.customer.delete({ where: { id } }).catch(() => {});
  });

  test('registers with a password and issues a session', async () => {
    const email = `pw-${uniq()}@test.local`;
    const out = await customerAuth.registerWithPassword({ email, password: 'correct horse battery', name: 'PW' });
    made.customers.push(out.customer.id);
    assert.ok(out.token);
    const resolved = await customerAuth.resolveSession(out.token);
    assert.equal(resolved.id, out.customer.id);
  });

  test('a wrong password and an unknown account give the SAME error — no enumeration', async () => {
    const email = `enum-${uniq()}@test.local`;
    const out = await customerAuth.registerWithPassword({ email, password: 'correct horse battery' });
    made.customers.push(out.customer.id);

    const wrong = await customerAuth.signInWithPassword({ email, password: 'nope nope nope' }).catch((e) => e.message);
    const missing = await customerAuth.signInWithPassword({ email: `ghost-${uniq()}@test.local`, password: 'nope nope nope' }).catch((e) => e.message);
    assert.equal(wrong, missing);
  });

  test('session tokens are stored hashed — the raw token is not in the database', async () => {
    const out = await customerAuth.registerWithPassword({ email: `hash-${uniq()}@test.local`, password: 'correct horse battery' });
    made.customers.push(out.customer.id);
    const stored = await db.customerSession.findFirst({ where: { customerId: out.customer.id } });
    assert.notEqual(stored.tokenHash, out.token);
    assert.equal(await db.customerSession.count({ where: { tokenHash: out.token } }), 0);
  });

  test('a one-time code signs in, is single-use, and is stored hashed', async () => {
    const email = `otp-${uniq()}@test.local`;
    const { code } = await customerAuth.requestCode({ destination: email, kind: 'email' });
    const stored = await db.customerAuthCode.findFirst({ where: { destination: email } });
    assert.notEqual(stored.codeHash, code, 'the code itself must never be stored');

    const out = await customerAuth.verifyCode({ destination: email, kind: 'email', code });
    made.customers.push(out.customer.id);
    assert.ok(out.token);

    await assert.rejects(
      () => customerAuth.verifyCode({ destination: email, kind: 'email', code }),
      /expired/i,
      'a consumed code must not work twice',
    );
  });

  test('rejects a bad code and a malformed phone number', async () => {
    const email = `bad-${uniq()}@test.local`;
    await customerAuth.requestCode({ destination: email, kind: 'email' });
    await assert.rejects(() => customerAuth.verifyCode({ destination: email, kind: 'email', code: '000000' }), /not right/i);
    await assert.rejects(() => customerAuth.requestCode({ destination: '07700900123', kind: 'phone' }), /international format/i);
  });

  test('social sign-in links to an existing account ONLY on a verified email', async () => {
    const email = `soc-${uniq()}@test.local`;
    const first = await customerAuth.registerWithPassword({ email, password: 'correct horse battery' });
    made.customers.push(first.customer.id);

    // Unverified provider email must NOT take over the existing account.
    const unverified = await customerAuth.signInWithOAuth({
      provider: 'google', subject: `sub-${uniq()}`, email, emailVerified: false,
    });
    made.customers.push(unverified.customer.id);
    assert.notEqual(unverified.customer.id, first.customer.id, 'unverified email must not auto-link');

    // Verified does link.
    const verified = await customerAuth.signInWithOAuth({
      provider: 'google', subject: `sub-${uniq()}`, email, emailVerified: true,
    });
    assert.equal(verified.customer.id, first.customer.id);
  });

  test('the same social account signs back into the same customer', async () => {
    const subject = `stable-${uniq()}`;
    const a = await customerAuth.signInWithOAuth({ provider: 'apple', subject });
    made.customers.push(a.customer.id);
    const b = await customerAuth.signInWithOAuth({ provider: 'apple', subject });
    assert.equal(b.customer.id, a.customer.id);
  });

  test('registering claims prior GUEST orders for that email', async () => {
    const email = `guest-${uniq()}@test.local`;
    const order = await db.order.create({
      data: { number: `G-${uniq()}`, status: 'delivered', total: 2500, currency: 'USD', guestEmail: email },
    });
    made.orders.push(order.id);

    const out = await customerAuth.registerWithPassword({ email, password: 'correct horse battery' });
    made.customers.push(out.customer.id);
    const claimed = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(claimed.customerId, out.customer.id, 'guest history should follow the account');
  });

  test('refuses to unlink the last identity — that would lock them out for good', async () => {
    const out = await customerAuth.registerWithPassword({ email: `last-${uniq()}@test.local`, password: 'correct horse battery' });
    made.customers.push(out.customer.id);
    const [only] = await customerAuth.identitiesFor(out.customer.id);
    await assert.rejects(() => customerAuth.unlinkIdentity(out.customer.id, only.id), /only way to sign in/i);
  });

  test('sign out invalidates the token', async () => {
    const out = await customerAuth.registerWithPassword({ email: `so-${uniq()}@test.local`, password: 'correct horse battery' });
    made.customers.push(out.customer.id);
    await customerAuth.signOut(out.token);
    assert.equal(await customerAuth.resolveSession(out.token), null);
  });
});

describe('customer auth audit trail', () => {
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  // Rows for one subject, newest first. Scoped to `customer` throughout —
  // a customer event leaking into the admin scope would make a storefront
  // failure spike look like an attack on the admin.
  const trail = (subject) =>
    db.authEvent.findMany({ where: { username: subject, scope: 'customer' }, orderBy: { createdAt: 'desc' } });

  test('records a registration and a successful sign-in', async () => {
    const email = `audit-${uniq()}@test.local`;
    await customerAuth.registerWithPassword({ email, password: 'correct horse battery', ip: '203.0.113.9' });
    await customerAuth.signInWithPassword({ email, password: 'correct horse battery', ip: '203.0.113.9' });
    const rows = await trail(email);
    assert.deepEqual(rows.map((r) => r.type), ['customer_login_success', 'customer_registered']);
    assert.equal(rows[0].ip, '203.0.113.9');
    assert.equal(rows[0].scope, 'customer');
  });

  test('records failures, and distinguishes wrong password from no such account', async () => {
    const email = `auditfail-${uniq()}@test.local`;
    await customerAuth.registerWithPassword({ email, password: 'correct horse battery' });
    await customerAuth.signInWithPassword({ email, password: 'wrong wrong wrong' }).catch(() => {});
    const ghost = `ghost-${uniq()}@test.local`;
    await customerAuth.signInWithPassword({ email: ghost, password: 'wrong wrong wrong' }).catch(() => {});

    const [failure] = await trail(email);
    assert.equal(failure.type, 'customer_login_failure');
    assert.equal(failure.detail, 'wrong password');
    const [unknown] = await trail(ghost);
    // The CALLER still gets one indistinguishable error — only the operator's
    // log tells the two apart.
    assert.equal(unknown.detail, 'no such account');
  });

  test('never writes the password or the one-time code into the log', async () => {
    const email = `auditsecret-${uniq()}@test.local`;
    const password = 'correct horse battery';
    await customerAuth.registerWithPassword({ email, password });
    const { code } = await customerAuth.requestCode({ destination: email, kind: 'email' });
    await customerAuth.verifyCode({ destination: email, kind: 'email', code });

    const blob = JSON.stringify(await trail(email));
    assert.ok(!blob.includes(password), 'password leaked into the audit log');
    assert.ok(!blob.includes(code), 'one-time code leaked into the audit log');
  });

  test('records a wrong code with its attempt number', async () => {
    const email = `auditcode-${uniq()}@test.local`;
    await customerAuth.requestCode({ destination: email, kind: 'email' });
    await customerAuth.verifyCode({ destination: email, kind: 'email', code: '000000' }).catch(() => {});
    const [row] = await trail(email);
    assert.equal(row.type, 'customer_code_failure');
    assert.match(row.detail, /attempt 1\/5/);
  });

  test('masks the provider account id on a social sign-in', async () => {
    const subject = `sub-${uniq()}`;
    await customerAuth.signInWithOAuth({ provider: 'google', subject, ip: '198.51.100.4' });
    const rows = await db.authEvent.findMany({ where: { scope: 'customer', ip: '198.51.100.4' }, orderBy: { createdAt: 'desc' } });
    const row = rows.find((r) => r.type === 'customer_oauth_registered');
    assert.ok(row, 'no oauth registration event recorded');
    assert.ok(!row.username.includes(subject), 'full provider subject stored in the audit log');
    assert.match(row.username, /^google:/);
    // Unverified email means the account was deliberately isolated — the fact
    // that matters most if a takeover is ever alleged.
    assert.match(row.detail, /isolated/);
  });

  test('admin events stay out of the customer scope', async () => {
    const username = `op-${uniq()}`;
    await authEventService.log('login_failure', username, '203.0.113.1');
    const [row] = await db.authEvent.findMany({ where: { username } });
    assert.equal(row.scope, 'admin');
    assert.equal((await authEventService.recent(50, 'customer')).some((r) => r.username === username), false);
  });

  test('failureCounts separates the two surfaces and counts distinct targets', async () => {
    const before = await authEventService.failureCounts(60);
    const a = `stuff-a-${uniq()}@test.local`;
    const b = `stuff-b-${uniq()}@test.local`;
    await customerAuth.signInWithPassword({ email: a, password: 'nope nope nope' }).catch(() => {});
    await customerAuth.signInWithPassword({ email: b, password: 'nope nope nope' }).catch(() => {});
    const after = await authEventService.failureCounts(60);
    assert.equal(after.customer, before.customer + 2);
    assert.equal(after.admin, before.admin);
    // Two different accounts hit — the shape that says stuffing, not a
    // forgotten password.
    assert.equal(after.distinctCustomerSubjects, before.distinctCustomerSubjects + 2);
  });
});

let preExistingGoogleSignin = [];

describe('social sign-in verification', () => {
  // A real RSA keypair, so these tests exercise actual signature verification
  // rather than a stub that agrees with itself.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const KID = 'test-key-1';
  const CLIENT_ID = 'client-abc.apps.googleusercontent.com';

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  function sign(claims, { alg = 'RS256', kid = KID, key = privateKey } = {}) {
    const data = `${b64({ alg, kid, typ: 'JWT' })}.${b64(claims)}`;
    const sig = createSign('RSA-SHA256').update(data).sign(key).toString('base64url');
    return `${data}.${sig}`;
  }
  const goodClaims = (over = {}) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-subject-123',
    email: 'shopper@example.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...over,
  });
  // Injected so no test ever touches the network.
  const fetcher = async () => ({ keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] });

  before(async () => {
    preExistingGoogleSignin = await db.connection.findMany({ where: { provider: 'google-signin' } });
    await db.connection.upsert({
      where: { provider: 'google-signin' },
      update: { credentialEncrypted: encryptSecret(`${CLIENT_ID}|secret`), status: 'connected' },
      create: {
        provider: 'google-signin', category: 'identity', status: 'connected',
        credentialEncrypted: encryptSecret(`${CLIENT_ID}|secret`), maskedPreview: 'client…',
      },
    });
  });
  after(async () => {
    await db.connection.deleteMany({ where: { provider: 'google-signin' } });
    // Restore a real google-signin connection if the operator had one — this
    // suite runs against the development database (see fulfillment.test.mjs).
    for (const row of preExistingGoogleSignin) {
      const { id: _id, ...data } = row;
      await db.connection.create({ data });
    }
  });
  beforeEach(() => clearJwksCache());

  test('accepts a correctly signed token and reports the verified email', async () => {
    const profile = await socialSignIn.verify('google', sign(goodClaims()), fetcher);
    assert.equal(profile.subject, 'google-subject-123');
    assert.equal(profile.email, 'shopper@example.com');
    assert.equal(profile.emailVerified, true);
  });

  test('rejects a token signed by SOMEONE ELSE', async () => {
    // The whole point. A forged token decodes perfectly — only the signature
    // check distinguishes it from a real one.
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = sign(goodClaims({ sub: 'victim' }), { key: attacker.privateKey });
    await assert.rejects(() => socialSignIn.verify('google', forged, fetcher), /failed verification/i);
  });

  test('rejects a token minted for a different application', async () => {
    // Signed by Google, genuinely — just issued to the attacker's own app.
    const other = sign(goodClaims({ aud: 'someone-elses-app.apps.googleusercontent.com' }));
    await assert.rejects(() => socialSignIn.verify('google', other, fetcher), /different application/i);
  });

  test('rejects alg:none and an unexpected algorithm', async () => {
    const data = `${b64({ alg: 'none', kid: KID, typ: 'JWT' })}.${b64(goodClaims())}.`;
    await assert.rejects(() => socialSignIn.verify('google', data, fetcher), /algorithm/i);
    await assert.rejects(() => socialSignIn.verify('google', sign(goodClaims(), { alg: 'HS256' }), fetcher), /algorithm/i);
  });

  test('rejects an expired token and a wrong issuer', async () => {
    const expired = sign(goodClaims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    await assert.rejects(() => socialSignIn.verify('google', expired, fetcher), /expired/i);
    const wrongIssuer = sign(goodClaims({ iss: 'https://evil.example' }));
    await assert.rejects(() => socialSignIn.verify('google', wrongIssuer, fetcher), /issuer/i);
  });

  test('handles an array audience rather than silently ignoring it', async () => {
    const ok = sign(goodClaims({ aud: ['other-app', CLIENT_ID] }));
    assert.equal((await socialSignIn.verify('google', ok, fetcher)).subject, 'google-subject-123');
    const bad = sign(goodClaims({ aud: ['other-app', 'third-app'] }));
    await assert.rejects(() => socialSignIn.verify('google', bad, fetcher), /different application/i);
  });

  test('an unverified email is reported as unverified, so no account gets linked', async () => {
    const profile = await socialSignIn.verify('google', sign(goodClaims({ email_verified: false })), fetcher);
    assert.equal(profile.emailVerified, false);
    // customerAuth then isolates the account rather than attaching it to an
    // existing one — the account-takeover route it already refuses.
    const out = await customerAuth.signInWithOAuth({ ...profile, subject: 'iso-' + randomUUID() });
    assert.match(out.customer.email, /@social\.local$/);
  });

  test('refuses to verify when the provider is not connected in Nexus', async () => {
    await assert.rejects(
      () => socialSignIn.verify('apple', sign(goodClaims({ iss: 'https://appleid.apple.com' })), fetcher),
      /isn't connected yet|Connect it under Nexus/i,
    );
  });

  test('a key rotation refetches instead of failing every login', async () => {
    let served = 0;
    const rotating = async () => {
      served += 1;
      // First call serves a key with the WRONG kid, as a stale cache would.
      return served === 1
        ? { keys: [{ ...jwk, kid: 'old-key', alg: 'RS256' }, { ...jwk, kid: 'other', alg: 'RS256' }] }
        : { keys: [{ ...jwk, kid: KID, alg: 'RS256' }] };
    };
    const profile = await socialSignIn.verify('google', sign(goodClaims()), rotating);
    assert.equal(profile.subject, 'google-subject-123');
    assert.equal(served, 2, 'should have refetched the JWKS once on the kid miss');
  });
});

describe('store credentials (partners reading this store)', () => {
  const made = [];
  after(async () => {
    for (const id of made) await db.storeCredential.delete({ where: { id } }).catch(() => {});
  });

  test('issues a WooCommerce-shaped pair and never stores the secret recoverably', async () => {
    const issued = await storeCredentials.issue('test key');
    made.push(issued.id);
    // POD platforms validate the shape client-side before they will even call.
    assert.match(issued.consumerKey, /^ck_[0-9a-f]{40}$/);
    assert.match(issued.consumerSecret, /^cs_[0-9a-f]{40}$/);

    const row = await db.storeCredential.findUnique({ where: { id: issued.id } });
    assert.ok(!JSON.stringify(row).includes(issued.consumerSecret), 'secret is recoverable from the row');
  });

  test('verifies the right pair and refuses a wrong one', async () => {
    const issued = await storeCredentials.issue('verify key');
    made.push(issued.id);
    assert.ok(await storeCredentials.verify(issued.consumerKey, issued.consumerSecret));
    assert.equal(await storeCredentials.verify(issued.consumerKey, 'cs_wrong'), null);
    assert.equal(await storeCredentials.verify('ck_nope', issued.consumerSecret), null);
  });

  test('a revoked key stops working but its record survives', async () => {
    const issued = await storeCredentials.issue('revoke key');
    made.push(issued.id);
    await storeCredentials.revoke(issued.id);
    assert.equal(await storeCredentials.verify(issued.consumerKey, issued.consumerSecret), null);
    // Revoked, not deleted — the row is the only evidence of what that key did.
    assert.ok(await db.storeCredential.findUnique({ where: { id: issued.id } }));
  });

  test('list never leaks a full key or any secret', async () => {
    const issued = await storeCredentials.issue('list key');
    made.push(issued.id);
    const blob = JSON.stringify(await storeCredentials.list());
    assert.ok(!blob.includes(issued.consumerSecret), 'secret leaked from list()');
    assert.ok(!blob.includes(issued.consumerKey), 'full consumer key leaked from list()');
  });
});

describe('woo bridge discovery (how a partner finds us)', () => {
  // These are the probes a connector runs BEFORE it asks for a key. If any
  // fails, its WooCommerce option reports an invalid store URL and the
  // credentials never get a chance — which is indistinguishable, from the
  // operator's side, from a wrong key.
  let app;
  before(async () => {
    const { buildServer } = await import('../dist/server.js');
    app = await buildServer();
  });
  after(async () => { await app.close(); });

  test('/wp-json/ advertises the wc/v3 namespace, unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/wp-json/' });
    assert.equal(r.statusCode, 200);
    assert.ok(r.json().namespaces.includes('wc/v3'), 'connector cannot tell this speaks WooCommerce');
  });

  test('the ?rest_route= form reaches the same routes', async () => {
    // Must be rewritten BEFORE routing; done in a hook it lands on the site
    // root, which answers 200 and looks like a store with no products.
    const root = await app.inject({ method: 'GET', url: '/?rest_route=/' });
    assert.equal(root.statusCode, 200);
    assert.ok(root.json().namespaces.includes('wc/v3'));

    const products = await app.inject({ method: 'GET', url: '/?rest_route=/wc/v3/products' });
    assert.equal(products.statusCode, 401, 'should reach the gated route, not the site root');
  });

  test('catalogue endpoints stay gated', async () => {
    for (const url of ['/wp-json/wc/v3/products', '/wp-json/wc/v3/orders', '/wp-json/wc/v3/system_status']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });
});

describe("printful plugin routes (the 'Valid route not found' sync error)", () => {
  // Printful does not drive the store through the WooCommerce API alone. After
  // connecting it calls routes its own WordPress plugin registers, and when
  // those are missing the sync fails with:
  //
  //   "Valid route not found. Please make sure latest Printful plugin is
  //    installed and REST API enabled!"
  //
  // which reads as a WordPress problem and gets the credentials blamed instead.
  // The namespace is the trap: the plugin registers under wc/v2, not wc/v3.
  let app, key, secret, product;

  before(async () => {
    const { buildServer } = await import('../dist/server.js');
    const { storeCredentials } = await import('../dist/counter/storeCredentials.js');
    app = await buildServer();
    const issued = await storeCredentials.issue('PrintfulRouteTest key', 'read_write');
    key = issued.consumerKey;
    secret = issued.consumerSecret;
    product = await db.product.create({
      data: { name: 'pfroute Tee', slug: `pfroute-${Date.now()}`, status: 'active' },
    });
  });

  after(async () => {
    await db.product.deleteMany({ where: { slug: { startsWith: 'pfroute-' } } }).catch(() => {});
    await db.storeCredential.deleteMany({ where: { label: { startsWith: 'PrintfulRouteTest' } } });
    await db.setting.deleteMany({ where: { key: 'printful_link' } }).catch(() => {});
    await app.close();
  });

  const auth = () => ({ authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` });

  test('every route Printful calls exists — none may 404', async () => {
    // A 404 on ANY of these produces the error above. Asserted as "not 404"
    // rather than "200" so the reason a route fails stays visible.
    const routes = [
      ['GET', '/wp-json/wc/v2/printful/store_data'],
      ['GET', '/wp-json/wc/v2/printful/version'],
      ['POST', '/wp-json/wc/v2/printful/access'],
      ['POST', `/wp-json/wc/v2/printful/products/${product.id}/size-chart`],
      ['POST', `/wp-json/wc/v2/printful/products/${product.id}/advanced-size-chart`],
    ];
    for (const [method, url] of routes) {
      const r = await app.inject({ method, url, headers: auth(), payload: method === 'POST' ? {} : undefined });
      assert.notEqual(r.statusCode, 404, `${method} ${url} does not exist — this IS the sync error`);
    }
  });

  test('discovery advertises wc/v2, or Printful never calls the routes at all', async () => {
    const root = await app.inject({ method: 'GET', url: '/wp-json/' });
    assert.ok(root.json().namespaces.includes('wc/v2'), 'wc/v2 missing from the namespace list');
    const ns = await app.inject({ method: 'GET', url: '/wp-json/wc/v2' });
    assert.equal(ns.statusCode, 200);
    assert.equal(ns.json().namespace, 'wc/v2');
  });

  test('store_data identifies this store by the host Printful actually reached', async () => {
    const r = await app.inject({ method: 'GET', url: '/wp-json/wc/v2/printful/store_data', headers: auth() });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    // An empty website is how a store ends up linked to an address Printful
    // cannot reach — it must be a real absolute URL.
    assert.match(body.website, /^https?:\/\/.+/, 'website must be an absolute URL');
    assert.ok(body.name, 'store name present');
    assert.ok(body.version, 'Woo version present');
  });

  test('the plugin routes are GATED — they are not public', async () => {
    for (const url of ['/wp-json/wc/v2/printful/store_data', '/wp-json/wc/v2/printful/version']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
    }
  });

  test('access: Printful pushes its token back and it is stored ENCRYPTED', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/wp-json/wc/v2/printful/access',
      headers: auth(),
      payload: { token: 'pf-oauth-token-under-test', storeId: 987654 },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().error, false);

    const { printfulLink } = await import('../dist/services/printfulLink.service.js');
    assert.equal(await printfulLink.storeId(), 987654);
    assert.equal(await printfulLink.token(), 'pf-oauth-token-under-test');

    // The row itself must not contain the token in the clear. A credential
    // readable straight out of the settings table is a credential leaked by
    // any backup, log, or admin export that touches it.
    const row = await db.setting.findUnique({ where: { key: 'printful_link' } });
    assert.doesNotMatch(JSON.stringify(row.value), /pf-oauth-token-under-test/, 'token stored in plaintext');
  });

  test('access: a bad payload reports the error in the BODY, as their client expects', async () => {
    // The plugin answers 200 with {error: "..."} rather than a status code.
    // A 400 here is a shape Printful does not parse.
    const r = await app.inject({
      method: 'POST', url: '/wp-json/wc/v2/printful/access', headers: auth(),
      payload: { token: '', storeId: 0 },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().error, 'Failed to update access data');
  });

  test('access requires read_write — a catalogue-only key cannot re-point the store', async () => {
    const { storeCredentials } = await import('../dist/counter/storeCredentials.js');
    const ro = await storeCredentials.issue('PrintfulRouteTest readonly', 'read');
    const r = await app.inject({
      method: 'POST', url: '/wp-json/wc/v2/printful/access',
      headers: { authorization: `Basic ${Buffer.from(`${ro.consumerKey}:${ro.consumerSecret}`).toString('base64')}` },
      payload: { token: 'nope', storeId: 1 },
    });
    assert.equal(r.statusCode, 403);
  });

  test('size charts land on the product, both the HTML and structured forms', async () => {
    const plain = await app.inject({
      method: 'POST', url: `/wp-json/wc/v2/printful/products/${product.id}/size-chart`,
      headers: auth(), payload: { size_chart: '<table><tr><td>S</td></tr></table>' },
    });
    assert.equal(plain.statusCode, 200);

    const advanced = await app.inject({
      method: 'POST', url: `/wp-json/wc/v2/printful/products/${product.id}/advanced-size-chart`,
      headers: auth(), payload: { size_chart: { types: [{ unit: 'inches' }] } },
    });
    assert.equal(advanced.statusCode, 200);

    const row = await db.product.findUnique({ where: { id: product.id } });
    assert.match(row.meta.pf_size_chart, /<table>/);
    assert.equal(row.meta.pf_advanced_size_chart.types[0].unit, 'inches');

    // The second write must not have wiped the first — they are separate keys
    // on one JSON column, so a naive overwrite loses whichever arrived first.
    assert.ok(row.meta.pf_size_chart && row.meta.pf_advanced_size_chart, 'one chart overwrote the other');
  });

  test('size chart for a product that does not exist is refused, not silently stored', async () => {
    const r = await app.inject({
      method: 'POST', url: '/wp-json/wc/v2/printful/products/no-such-product/size-chart',
      headers: auth(), payload: { size_chart: '<table></table>' },
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'printful_api_product_not_found');
  });
});

describe('woo auth handshake (one-click partner connect)', () => {
  // The flow behind a partner's "Connect to WooCommerce" button: it sends the
  // merchant to the store, the merchant approves once, and the store POSTs
  // fresh credentials straight back. Nothing is copied by hand.
  let app;
  before(async () => {
    const { buildServer } = await import('../dist/server.js');
    app = await buildServer();
  });
  after(async () => {
    // ONLY this file's own keys. This used to delete every credential whose
    // label contained "(auto)" — which is what the real connect flow named
    // live partner connections, so running the suite silently revoked the
    // merchant's working Printful connection. A test must never be able to
    // reach production data it did not create.
    await db.storeCredential.deleteMany({ where: { label: { startsWith: 'TestPartner' } } });
    await app.close();
  });

  test('SECURITY: minting credentials requires a signed-in admin', async () => {
    // This endpoint hands out read_write keys to a callback URL the CALLER
    // supplies. Unguarded it is a credential vending machine, and it WAS
    // unguarded — proven by POSTing to the live site from a terminal with no
    // session at all, twice, and finding the keys sitting in the store after.
    const anon = await app.inject({
      method: 'POST',
      url: `/wc-auth/v1/authorize?${query()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'approve=1',
    });
    assert.equal(anon.statusCode, 401, 'an anonymous approval must not mint a key');

    const minted = await db.storeCredential.findMany({ where: { label: { startsWith: 'TestPartner' } } });
    assert.equal(minted.length, 0, 'nothing was issued to an unauthenticated caller');

    // And the consent screen itself sends you to log in rather than rendering.
    // NO session header here on purpose — that is the case under test.
    const screen = await app.inject({ method: 'GET', url: `/wc-auth/v1/authorize?${query()}` });
    assert.equal(screen.statusCode, 302);
    assert.match(screen.headers.location, /\/tos-admin\/login/);
  });

  test('a real connection is NOT labelled with the string test cleanup deletes', async () => {
    // The flow used to name live connections "Printful (auto)" while this very
    // file deleted everything containing "(auto)". Running the suite revoked
    // the merchant's working connection — the bug that started all of this.
    const src = await readFile(new URL('../src/api/routes/wooCompat.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /issue\(`\$\{q\.app_name\} \(auto\)`/,
      'live connections must not carry the label this suite cleans up');
  });

  // Approving a connection is an admin act, so these carry a session. The
  // value only has to LOOK like a session cookie — the endpoint checks that an
  // admin is present, and the real auth still guards everything it does.
  const asAdmin = { cookie: 'th_session=admin-session-for-tests' };

  const query = (over = {}) =>
    new URLSearchParams({
      app_name: 'TestPartner',
      scope: 'read_write',
      user_id: '42',
      return_url: 'https://partner.example/done',
      callback_url: 'https://partner.example/keys',
      ...over,
    }).toString();

  test('shows a consent screen naming the partner', async () => {
    const r = await app.inject({ method: 'GET', url: `/wc-auth/v1/authorize?${query()}`, headers: asAdmin });
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /TestPartner/);
  });

  test('escapes the partner name — it is attacker-controlled text', async () => {
    const r = await app.inject({ method: 'GET', url: `/wc-auth/v1/authorize?${query({ app_name: '<script>x</script>' })}`, headers: asAdmin });
    assert.ok(!r.body.includes('<script>x</script>'), 'partner name rendered as markup');
  });

  test('refuses a plaintext callback_url — the response body IS the secret', async () => {
    const r = await app.inject({ method: 'GET', url: `/wc-auth/v1/authorize?${query({ callback_url: 'http://evil.example/keys' })}`, headers: asAdmin });
    assert.equal(r.statusCode, 400);
  });

  test('rejects a missing or bad scope rather than guessing', async () => {
    for (const bad of ['', 'admin']) {
      const r = await app.inject({ method: 'GET', url: `/wc-auth/v1/authorize?${query({ scope: bad })}`, headers: asAdmin });
      assert.equal(r.statusCode, 400, `scope=${bad}`);
    }
  });

  test('declining mints nothing and reports success=0', async () => {
    const before = await db.storeCredential.count();
    const r = await app.inject({
      method: 'POST',
      url: `/wc-auth/v1/authorize?${query()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...asAdmin },
      payload: 'approve=0',
    });
    assert.equal(r.statusCode, 302);
    assert.match(r.headers.location, /success=0/);
    assert.equal(await db.storeCredential.count(), before, 'a key was minted despite declining');
  });

  test('a key the partner never received is revoked, not left live', async () => {
    // The callback host does not exist, so delivery fails. A live credential
    // nobody holds is one nobody can account for later.
    const r = await app.inject({
      method: 'POST',
      url: `/wc-auth/v1/authorize?${query({ callback_url: 'https://127.0.0.1:9/keys' })}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...asAdmin },
      payload: 'approve=1',
    });
    assert.match(r.headers.location, /success=0/);
    const live = await db.storeCredential.findMany({ where: { label: { startsWith: 'TestPartner' }, revokedAt: null } });
    assert.equal(live.length, 0, 'an undelivered key was left usable');
  });
});
