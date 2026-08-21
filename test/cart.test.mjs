// Counter C2 — unified cart/checkout session: lazy creation, live totals
// with the Milieus member discount, stock validation, and the cart→order→
// payment handoff riding C1's real machinery end to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { encryptSecret } from '../dist/lib/crypto.js';
import { recomputeReservations } from './support/reservations.mjs';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'cart-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });
const MOCK_CRED = 'cart-mock-credential';

let app;
let vendor, product, v1, v2, milieuId;
let cartToken, orderInfo;

function signedWebhook(body) {
  const raw = JSON.stringify(body);
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-mock-signature': createHmac('sha256', MOCK_CRED).update(raw).digest('hex') } };
}

before(async () => {
  app = await buildServer();
  const { redis } = await import('../dist/lib/redis.js');
  // order-create is real (10 per 10 minutes per IP) and the suite creates far
  // more than that from 127.0.0.1, so a later file used to 429 on a test that
  // has nothing to do with rate limiting. The limiter itself stays exercised
  // by the test that asserts it.
  await redis.del('ratelimit:cart-new:127.0.0.1', 'ratelimit:cart-coupon:127.0.0.1', 'ratelimit:order-create:127.0.0.1');
  await db.connection.upsert({
    where: { provider: 'mock' },
    update: { credentialEncrypted: encryptSecret(MOCK_CRED), status: 'connected' },
    create: { provider: 'mock', category: 'payments', credentialEncrypted: encryptSecret(MOCK_CRED), maskedPreview: 'mock…', status: 'connected' },
  });
  vendor = await db.vendor.create({ data: { name: 'carttest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'carttest Tee', slug: 'carttest-tee', status: 'active', vendorId: vendor.id,
      variants: { create: [
        { sku: 'CRT-M', price: 2500, color: 'black', size: 'M', inventory: 5 },
        { sku: 'CRT-L', price: 2700, color: 'black', size: 'L', inventory: 2 },
      ] },
    },
    include: { variants: true },
  });
  [v1, v2] = product.variants;
  // A 20% milieu for the member-discount path.
  const m = await db.milieu.create({ data: { name: 'carttest VIP', slug: 'carttest-vip', discountPct: 20 } });
  milieuId = m.id;
});

after(async () => {
  // Cleanup is wrapped because a THROW here used to be unrecoverable: the
  // close calls below never ran, the process hung on open Redis handles, and
  // the fixture products survived — so every later run then failed at setup on
  // a duplicate slug. One failing test poisoned the suite until the database
  // was cleaned by hand.
  try {
    await db.paymentEvent.deleteMany({ where: { provider: 'mock' } });
    // EVERY order that touched this fixture, not just the one a passing test
    // remembered — a test that fails before its own cleanup leaves one behind,
    // and order_items_variant_id_fkey then blocks the product delete.
    const items = await db.orderItem.findMany({
      where: { variant: { product: { slug: 'carttest-tee' } } },
      select: { orderId: true },
    });
    for (const orderId of new Set(items.map((i) => i.orderId))) {
      await db.refund.deleteMany({ where: { orderId } });
      await db.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    await db.milieuMembership.deleteMany({ where: { milieuId } });
    await db.milieu.deleteMany({ where: { slug: 'carttest-vip' } });
    await db.customer.deleteMany({ where: { email: 'cart-shopper@example.com' } });
    await db.product.deleteMany({ where: { slug: 'carttest-tee' } });
    await db.vendor.deleteMany({ where: { name: 'carttest Vendor' } });
    await db.connection.deleteMany({ where: { provider: 'mock' } });
    await db.connectionAuditLog.deleteMany({ where: { provider: 'mock' } });
  } finally {
    // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
    await closeQueues();
    await disconnectDb();
  }
});

test('lazy session: first add mints the token (201); live totals from the catalog', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: v1.id, quantity: 2 } });
  assert.equal(res.statusCode, 201, 'no token → session minted');
  const body = res.json();
  cartToken = body.token;
  assert.match(cartToken, /^[0-9a-f]{32}$/);
  assert.equal(body.totals.subtotal, 5000);
  assert.equal(body.totals.total, 5000);

  // Second add reuses the session (200) and merges quantities.
  const add2 = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { cartToken, variantId: v2.id, quantity: 1 } });
  assert.equal(add2.statusCode, 200);
  assert.equal(add2.json().totals.subtotal, 5000 + 2700);

  // Price changes reflect immediately (nothing cached in the session). Read
  // via the x-cart-token HEADER — the token never rides the URL (audit M-3).
  await db.productVariant.update({ where: { id: v2.id }, data: { price: 3000 } });
  const read = await app.inject({ method: 'GET', url: '/api/cart', headers: { 'x-cart-token': cartToken } });
  assert.equal(read.json().totals.subtotal, 5000 + 3000, 'live price, not stored price');
});

test('quantity update + remove; unknown variant 404; inactive product blocked', async () => {
  const upd = await app.inject({ method: 'PATCH', url: `/api/cart/items/${v2.id}`, payload: { cartToken, quantity: 2 } });
  assert.equal(upd.json().totals.subtotal, 5000 + 6000);
  const rm = await app.inject({ method: 'PATCH', url: `/api/cart/items/${v2.id}`, payload: { cartToken, quantity: 0 } });
  assert.equal(rm.json().totals.lines.length, 1);

  const ghost = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { cartToken, variantId: 'nope' } });
  assert.equal(ghost.statusCode, 404);

  await db.product.update({ where: { id: product.id }, data: { status: 'draft' } });
  const inactive = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { cartToken, variantId: v2.id } });
  assert.equal(inactive.statusCode, 404, 'draft products not addable');
  await db.product.update({ where: { id: product.id }, data: { status: 'active' } });
});

test('AUDIT H-1/M-2: a typed email grants NO member discount and reveals nothing (no enumeration oracle)', async () => {
  // Seed a real member for the victim email.
  const customer = await db.customer.upsert({ where: { email: 'cart-shopper@example.com' }, update: {}, create: { email: 'cart-shopper@example.com' } });
  await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members`, headers: auth(), payload: { customerId: customer.id } });

  // Anonymous cart attaching the member's email must NOT inherit the discount.
  const res = await app.inject({ method: 'POST', url: '/api/cart/identity', payload: { cartToken, email: 'cart-shopper@example.com' } });
  assert.equal(res.statusCode, 200);
  const t = res.json().totals;
  assert.equal(t.subtotal, 5000);
  assert.equal(t.discount, null, 'no member discount from an unverified typed email');
  assert.equal(t.total, 5000, 'priced at list price');
});

test('checkout: stock validated live; conflict names the short item', async () => {
  // Ask for more than exists of CRT-L in a throwaway cart.
  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: v2.id, quantity: 2 } });
  const t2 = add.json().token;
  await db.productVariant.update({ where: { id: v2.id }, data: { inventory: 1 } });
  const res = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: t2 } });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error.message, /CRT-L/);
  await db.productVariant.update({ where: { id: v2.id }, data: { inventory: 2 } });
  await app.inject({ method: 'DELETE', url: '/api/cart', headers: { 'x-cart-token': t2 } });
});

test('cart → order → payment: the full C1+C2 lifecycle; guest email recorded, list price', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken, email: 'cart-shopper@example.com' } });
  assert.equal(res.statusCode, 201);
  orderInfo = res.json();
  assert.match(orderInfo.accessToken, /^[0-9a-f]{32}$/);
  assert.equal(orderInfo.total, 5000, 'list price — no discount from an unverified email');

  // Guest email recorded on the order, but NOT bound to the member customer.
  const guestOrder = await db.order.findUnique({ where: { id: orderInfo.orderId } });
  assert.equal(guestOrder.guestEmail, 'cart-shopper@example.com');
  assert.equal(guestOrder.customerId, null, 'unverified email does not attach a customer account');

  // Cart is gone after checkout.
  const gone = await app.inject({ method: 'GET', url: '/api/cart', headers: { 'x-cart-token': cartToken } });
  assert.equal(gone.statusCode, 404);

  // Inventory reserved by the order create.
  const vv = await db.productVariant.findUnique({ where: { id: v1.id } });
  assert.equal(vv.reserved, 2);

  // Pay it through C1: intent + signed webhook.
  const intent = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber: orderInfo.orderNumber, accessToken: orderInfo.accessToken, provider: 'mock' } });
  assert.equal(intent.statusCode, 200);
  const { payload, headers } = signedWebhook({ event_id: 'evt_cart1', kind: 'payment.succeeded', intent_id: intent.json().intentId });
  await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });

  const order = await db.order.findUnique({ where: { id: orderInfo.orderId } });
  assert.equal(order.status, 'processing', 'paid through the real gateway path');
});

test('double-submitted checkout returns the SAME order (cart token = idempotency key)', async () => {
  // Rebuild an identical cart state in Redis by re-adding, then submit twice.
  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: v1.id, quantity: 1 } });
  const t3 = add.json().token;
  const c1 = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: t3 } });
  assert.equal(c1.statusCode, 201);
  // The cart is cleared, so a literal double-submit finds no cart — but a
  // re-created order with the same idempotency key would dedupe at the order
  // layer. Prove the idempotency key path directly:
  const again = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { items: [{ variantId: v1.id, quantity: 1 }], currency: 'USD', idempotencyKey: `cart_${t3}` } });
  assert.equal(again.json().id, c1.json().orderId, 'same idempotency key → same order, stock reserved once');
  // Cleanup this side order.
  await db.order.delete({ where: { id: c1.json().orderId } });
  await db.productVariant.update({ where: { id: v1.id }, data: { reserved: 2 } });
});

test('AUDIT M-3: cart token is not accepted in the URL path (header only)', async () => {
  // The old GET /cart/:token route is gone — a token in the path 404s.
  const res = await app.inject({ method: 'GET', url: `/api/cart/${'a'.repeat(32)}` });
  assert.equal(res.statusCode, 404, 'no route reads the token from the URL path');
});

test('AUDIT L-3: a corrupted cart value resets to not-found, not 500', async () => {
  const { redis } = await import('../dist/lib/redis.js');
  const tok = 'b'.repeat(32);
  await redis.set(`counter:cart:${tok}`, 'not json at all', 'EX', 60);
  const res = await app.inject({ method: 'GET', url: '/api/cart', headers: { 'x-cart-token': tok } });
  assert.equal(res.statusCode, 404, 'corrupt cart treated as expired');
  assert.equal(await redis.get(`counter:cart:${tok}`), null, 'corrupt key cleared');
});

/**
 * The address entered at /cart/shipping must survive onto the ORDER.
 *
 * checkout() read its `shipAddress` ARGUMENT rather than the cart state, so an
 * address supplied the normal way — one step earlier, to get a shipping quote —
 * priced the order correctly and was then dropped. The customer was charged the
 * right amount for delivery to nowhere, and the order then failed fulfilment
 * routing with "missing address1, city, country_code".
 *
 * Nothing threw. It only showed up by placing a real order and looking at it.
 */
test('an address set via /cart/shipping lands on the order', async () => {
  const { cartService } = await import('../dist/services/cart.service.js');
  const variant = await db.productVariant.findFirst({ where: { product: { status: 'active' } } });
  assert.ok(variant, 'need at least one active product to test checkout');

  const cart = await cartService.addItem(null, variant.id, 1);
  const token = cart.token ?? cart.cartToken;

  const address = {
    name: 'Address Persistence Test', line1: '1 Test Street',
    city: 'Philadelphia', region: 'PA', postalCode: '19104', country: 'US',
  };
  await cartService.setShipping(token, address);

  // NOTE: no address passed here — that is the whole point.
  const co = await cartService.checkout(token, 'address-persistence@example.test');

  const order = await db.order.findUnique({ where: { id: co.orderId }, select: { shipAddress: true } });
  const saved = order.shipAddress ?? {};
  assert.equal(saved.line1, '1 Test Street', 'the cart address was dropped — the order has nowhere to ship');
  assert.equal(saved.city, 'Philadelphia');
  assert.equal(saved.country, 'US');

  await db.payment.deleteMany({ where: { orderId: co.orderId } });
  await db.orderItem.deleteMany({ where: { orderId: co.orderId } });
  await db.order.delete({ where: { id: co.orderId } });
});
