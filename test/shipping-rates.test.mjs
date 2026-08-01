// Shipping rates, tax, and — the one that matters — that the ORDER charges
// what checkout displayed.
//
// The bug this guards against was live: the cart said $83.45 and the order was
// created for $54.00, because orderService.create totalled the items and
// ignored shipping and tax entirely. A store that undercharges silently is
// worse than one that errors.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { closeQueues } from '../dist/lib/queue.js';
import { shippingRateService, DEFAULT_METHODS } from '../dist/counter/shippingRates.js';
import { settingsService } from '../dist/services/settings.service.js';
import { orderService } from '../dist/services/order.service.js';
import { recomputeReservations } from './support/reservations.mjs';

const TEST_EMAIL = 'ratetest@example.local';
const ADDRESS = {
  name: 'Rate Test',
  line1: '12 Test St',
  city: 'Austin',
  region: 'TX',
  postalCode: '78701',
  country: 'US',
};

let originalTax = 0;

after(async () => {
  await settingsService.setCounter({ taxRatePct: originalTax }).catch(() => {});
  const orders = await db.order.findMany({ where: { guestEmail: TEST_EMAIL }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.orderShipment.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  }
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await closeQueues().catch(() => {});
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});

const req = (subtotal = 5400) => ({
  lines: [{ itemId: '0', productId: 'p', variantId: 'v', quantity: 1, unitPrice: subtotal, lineTotal: subtotal }],
  subtotal,
  currency: 'USD',
  address: ADDRESS,
});

test('a store with no provider still offers rates', async () => {
  // No fulfillment provider that can quote means the configured methods are
  // used. A store with no shipping options cannot sell at all, which is a
  // worse failure than an approximate rate.
  const rates = await shippingRateService.rates(req());
  assert.ok(rates.length > 0, 'always something to pick');
  for (const r of rates) {
    assert.equal(typeof r.amount, 'number');
    assert.ok(Number.isInteger(r.amount), 'minor units, never a float');
    assert.ok(r.name && r.id, 'every rate is selectable and labelled');
  }
});

test('rates are ordered cheapest first', async () => {
  const rates = await shippingRateService.rates(req());
  const amounts = rates.map((r) => r.amount);
  assert.deepEqual([...amounts].sort((a, b) => a - b), amounts, 'cheapest first');
});

test('the shipped defaults match the checkout preview', () => {
  // previews/checkout-experience.html: Standard free, Express 9.99,
  // Overnight 24.99.
  assert.deepEqual(
    DEFAULT_METHODS.map((m) => [m.id, m.amount]),
    [['standard', 0], ['express', 999], ['overnight', 2499]],
  );
});

test('tax is a percentage of the taxable base, in minor units', async () => {
  const counter = await settingsService.getCounter();
  originalTax = counter.taxRatePct ?? 0;

  await settingsService.setCounter({ taxRatePct: 0 });
  assert.equal(await shippingRateService.tax(5400), 0, 'no rate configured means no tax');

  await settingsService.setCounter({ taxRatePct: 8.25 });
  // 5400 * 0.0825 = 445.5, rounded.
  assert.equal(await shippingRateService.tax(5400), 446);
  assert.equal(await shippingRateService.tax(0), 0);

  await settingsService.setCounter({ taxRatePct: originalTax });
});

test('THE ORDER CHARGES SHIPPING AND TAX, not just the items', async () => {
  const variant = await db.productVariant.findFirst({ select: { id: true, price: true } });
  if (!variant) return;

  const order = await orderService.create({
    currency: 'USD',
    guestEmail: TEST_EMAIL,
    shipAddress: ADDRESS,
    shippingTotal: 2499,
    taxTotal: 446,
    shippingMethod: 'overnight',
    items: [{ variantId: variant.id, quantity: 1 }],
  });

  const row = await db.order.findUnique({
    where: { id: order.id },
    select: { total: true, shippingTotal: true, taxTotal: true, shippingMethod: true },
  });

  assert.equal(row.shippingTotal, 2499, 'shipping stored');
  assert.equal(row.taxTotal, 446, 'tax stored');
  assert.equal(row.shippingMethod, 'overnight', 'the chosen speed is recorded');
  // The whole point: total is reproducible from its parts.
  assert.equal(
    row.total,
    variant.price + 2499 + 446,
    'total = items + shipping + tax — this is what the customer is charged',
  );
});

test('an order with no shipping or tax is unchanged', async () => {
  const variant = await db.productVariant.findFirst({ select: { id: true, price: true } });
  if (!variant) return;
  const order = await orderService.create({
    currency: 'USD',
    guestEmail: TEST_EMAIL,
    items: [{ variantId: variant.id, quantity: 1 }],
  });
  const row = await db.order.findUnique({
    where: { id: order.id },
    select: { total: true, shippingTotal: true, taxTotal: true },
  });
  assert.equal(row.shippingTotal, 0);
  assert.equal(row.taxTotal, 0);
  assert.equal(row.total, variant.price, 'admin and imported orders are untouched');
});
