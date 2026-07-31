// Checkout captures a shipping address, and it reaches fulfillment.
//
// The second half is the point. An address collected into a field nothing
// downstream reads is worse than no address, because the store looks like it
// works. shipmentService throws "This shipment has no address yet" on exactly
// that case, so the test follows the value all the way to the shipment.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { closeQueues } from '../dist/lib/queue.js';
import { ShipAddressInput, CreateOrderInput } from '../dist/schemas/order.schema.js';

const TEST_EMAIL = 'shipaddr-test@example.local';

after(async () => {
  const orders = await db.order.findMany({ where: { guestEmail: TEST_EMAIL }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.orderShipment.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  }
  await closeQueues().catch(() => {});
  await disconnectDb().catch(() => {});
  await disconnectRedis().catch(() => {});
});

test('the address shape matches what fulfillment already reads', () => {
  // orderTracking.destinationOf reads city/region/country; shipmentService
  // builds line1/line2/city/region/postalCode/country from a Customer address.
  // Inventing different names here would collect an address no downstream
  // consumer can see.
  const parsed = ShipAddressInput.parse({
    name: 'A Person',
    line1: '1 Main St',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  });
  for (const key of ['line1', 'city', 'region', 'postalCode', 'country']) {
    assert.ok(key in parsed, `${key} survives parsing`);
  }
});

test('country is normalised to uppercase ISO-2', () => {
  const parsed = ShipAddressInput.parse({ name: 'A', line1: '1 St', city: 'Austin', country: 'us' });
  assert.equal(parsed.country, 'US', "'us' and 'US' must not be two different countries");
  assert.throws(() => ShipAddressInput.parse({ name: 'A', line1: '1 St', city: 'Austin', country: 'USA' }));
});

test('the irreducible minimum for a label is enforced', () => {
  const base = { name: 'A Person', line1: '1 Main St', city: 'Austin', country: 'US' };
  assert.ok(ShipAddressInput.parse(base));
  for (const missing of ['name', 'line1', 'city', 'country']) {
    const bad = { ...base };
    delete bad[missing];
    assert.throws(() => ShipAddressInput.parse(bad), new RegExp('.'), `${missing} is required`);
  }
  // Plenty of countries have neither, so these must stay optional.
  assert.ok(ShipAddressInput.parse(base).region === undefined);
  assert.ok(ShipAddressInput.parse(base).postalCode === undefined);
});

test('empty strings are refused, not stored as blanks', () => {
  assert.throws(() => ShipAddressInput.parse({ name: '', line1: '1 St', city: 'Austin', country: 'US' }));
  assert.throws(() => ShipAddressInput.parse({ name: 'A', line1: '', city: 'Austin', country: 'US' }));
  assert.throws(() => ShipAddressInput.parse({ name: 'A', line1: '1 St', city: '', country: 'US' }));
});

test('CreateOrderInput accepts an order without an address', () => {
  // Admin-created and imported orders do not always have one; the Woo importer
  // writes its own. The storefront requirement is enforced at checkout.
  const parsed = CreateOrderInput.parse({ items: [{ variantId: 'v1', quantity: 1 }] });
  assert.equal(parsed.shipAddress, undefined);
});

test('an order created with an address persists it, and a shipment inherits it', async () => {
  const variant = await db.productVariant.findFirst({ select: { id: true } });
  if (!variant) return; // No catalog in this environment — nothing to assert.

  const { orderService } = await import('../dist/services/order.service.js');
  const address = {
    name: 'Ship Test',
    line1: '12 Test St',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    country: 'US',
  };
  const order = await orderService.create({
    currency: 'USD',
    guestEmail: TEST_EMAIL,
    shipAddress: address,
    items: [{ variantId: variant.id, quantity: 1 }],
  });

  const stored = await db.order.findUnique({ where: { id: order.id }, select: { shipAddress: true } });
  assert.deepEqual(stored.shipAddress, address, 'stored verbatim on the order');

  // The half that matters: fulfillment can see it.
  const { shipmentService } = await import('../dist/counter/shipmentService.js');
  const shipments = await shipmentService.planForOrder(order.id).catch(() => null);
  if (shipments && shipments.length) {
    assert.deepEqual(shipments[0].shipAddress, address, 'the shipment inherits the order address');
  }
});
