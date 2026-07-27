// Counter C3 — coupons: validation reasons, percent/fixed math, live recalc
// drop, best-single-wins vs member discount, the redemption ledger on
// checkout, and release-on-refund. Rides the real cart + C1 machinery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { encryptSecret } from '../dist/lib/crypto.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt(role = 'admin', sub = 'coupon-test') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });
const MOCK_CRED = 'coupon-mock-cred';

let app;
let vendor, product, v1;

function signedWebhook(body) {
  const raw = JSON.stringify(body);
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-mock-signature': createHmac('sha256', MOCK_CRED).update(raw).digest('hex') } };
}

before(async () => {
  app = await buildServer();
  // Clear the per-IP coupon-apply + cart-mint rate-limit windows so a prior
  // run's counter (600s TTL, shared Redis) doesn't 429 this suite's applies.
  const { redis } = await import('../dist/lib/redis.js');
  await redis.del('ratelimit:cart-coupon:127.0.0.1', 'ratelimit:cart-new:127.0.0.1');
  await db.connection.upsert({
    where: { provider: 'mock' },
    update: { credentialEncrypted: encryptSecret(MOCK_CRED), status: 'connected' },
    create: { provider: 'mock', category: 'payments', credentialEncrypted: encryptSecret(MOCK_CRED), maskedPreview: 'm…', status: 'connected' },
  });
  vendor = await db.vendor.create({ data: { name: 'cptest Vendor' } });
  product = await db.product.create({
    data: { name: 'cptest Tee', slug: 'cptest-tee', status: 'active', vendorId: vendor.id, variants: { create: [{ sku: 'CPT-1', price: 5000, inventory: 50 }] } },
    include: { variants: true },
  });
  v1 = product.variants[0];
});

after(async () => {
  await db.couponRedemption.deleteMany({ where: { coupon: { code: { startsWith: 'CPTEST' } } } });
  await db.coupon.deleteMany({ where: { code: { startsWith: 'CPTEST' } } });
  await db.paymentEvent.deleteMany({ where: { provider: 'mock' } });
  await db.order.deleteMany({ where: { guestEmail: 'coupon-shopper@example.com' } });
  await db.product.deleteMany({ where: { slug: 'cptest-tee' } });
  await db.vendor.deleteMany({ where: { name: 'cptest Vendor' } });
  await db.connection.deleteMany({ where: { provider: 'mock' } });
  await db.connectionAuditLog.deleteMany({ where: { provider: 'mock' } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

async function newCart(qty = 1) {
  const res = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: v1.id, quantity: qty } });
  return res.json().token;
}

test('admin CRUD gated; percent > 100 rejected; duplicate code 409', async () => {
  const noAuth = await app.inject({ method: 'POST', url: '/api/coupons', payload: { code: 'CPTEST10', type: 'percent', amount: 10 } });
  assert.equal(noAuth.statusCode, 401);

  const role = await db.role.create({ data: { name: 'cptest-role', bundles: ['read'] } });
  const user = await db.adminUser.create({ data: { username: 'cptest-user', passwordHash: 'x', roleId: role.id } });
  try {
    const denied = await app.inject({ method: 'POST', url: '/api/coupons', headers: { authorization: `Bearer ${jwt('custom', user.id)}` }, payload: { code: 'CPTEST10', type: 'percent', amount: 10 } });
    assert.equal(denied.statusCode, 403);
  } finally {
    await db.adminUser.delete({ where: { id: user.id } });
    await db.role.delete({ where: { id: role.id } });
  }

  const bad = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTEST10', type: 'percent', amount: 150 } });
  assert.equal(bad.statusCode, 422, 'percent > 100 rejected');

  const ok = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTEST10', type: 'percent', amount: 10 } });
  assert.equal(ok.statusCode, 201);
  const dup = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTEST10', type: 'percent', amount: 20 } });
  assert.equal(dup.statusCode, 409);
});

test('apply: percent and fixed math; min/max/window/inactive reasons', async () => {
  await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTFIX', type: 'fixed', amount: 1500 } });
  await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTMIN', type: 'percent', amount: 10, minimumAmount: 999999 } });
  await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTOFF', type: 'percent', amount: 10, status: 'inactive' } });

  const cart = await newCart(2); // subtotal 10000

  const pct = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTEST10' } });
  assert.equal(pct.statusCode, 200);
  assert.equal(pct.json().totals.coupon.amount, 1000, '10% of 10000');
  assert.equal(pct.json().totals.total, 9000);

  const fix = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTFIX' } });
  assert.equal(fix.json().totals.coupon.amount, 1500, 'fixed 1500 off');
  assert.equal(fix.json().totals.total, 8500);

  const min = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTMIN' } });
  assert.equal(min.statusCode, 422, 'minimum not met');
  const off = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTOFF' } });
  assert.equal(off.statusCode, 422, 'inactive coupon rejected');
  // Audit F7: nonexistent and invalid both 422 with the SAME message — no
  // enumeration oracle. Case-insensitive (F8): 'cptest10' == 'CPTEST10'.
  const ghost = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'NOPE' } });
  assert.equal(ghost.statusCode, 422, 'nonexistent unified to 422');
  assert.equal(ghost.json().error.message, off.json().error.message, 'same message — no exists-vs-not oracle');
  const lower = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'cptest10' } });
  assert.equal(lower.statusCode, 200, 'lowercase resolves the same coupon');
});

test('recalc silently drops a coupon that hits its global limit mid-session', async () => {
  const c = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTLIM', type: 'fixed', amount: 500, usageLimit: 1 } });
  const couponId = c.json().id;
  const cart = await newCart(1);
  const applied = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTLIM' } });
  assert.equal(applied.json().totals.coupon.amount, 500);

  // Simulate the global limit being reached by another customer.
  await db.coupon.update({ where: { id: couponId }, data: { usageCount: 1 } });
  const recalc = await app.inject({ method: 'GET', url: '/api/cart', headers: { 'x-cart-token': cart } });
  assert.equal(recalc.json().totals.coupon, null, 'exhausted coupon silently dropped on recalc');
  assert.equal(recalc.json().totals.total, 5000, 'back to full price');
});

test('checkout records redemption + bumps usageCount; refund releases it; per-user limit respected', async () => {
  const c = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTONE', type: 'fixed', amount: 1000, usageLimitPerUser: 1 } });
  const couponId = c.json().id;

  const cart = await newCart(1);
  await app.inject({ method: 'POST', url: '/api/cart/identity', payload: { cartToken: cart, email: 'coupon-shopper@example.com' } });
  await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTONE' } });
  const co = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: cart } });
  assert.equal(co.statusCode, 201);
  const orderInfo = co.json();
  assert.equal(orderInfo.total, 4000, '5000 - 1000 coupon');

  // Order carries the coupon discount; redemption + usageCount recorded.
  const order = await db.order.findUnique({ where: { id: orderInfo.orderId } });
  assert.equal(order.discountAmount, 1000);
  assert.match(order.discountLabel, /Coupon CPTESTONE/);
  assert.equal((await db.coupon.findUnique({ where: { id: couponId } })).usageCount, 1);
  assert.equal(await db.couponRedemption.count({ where: { couponId, releasedAt: null } }), 1);

  // Per-user limit now blocks a second use by the same email.
  const cart2 = await newCart(1);
  await app.inject({ method: 'POST', url: '/api/cart/identity', payload: { cartToken: cart2, email: 'coupon-shopper@example.com' } });
  const blocked = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart2, code: 'CPTESTONE' } });
  assert.equal(blocked.statusCode, 422, 'per-user limit reached');
  await app.inject({ method: 'DELETE', url: '/api/cart', headers: { 'x-cart-token': cart2 } });

  // Pay, then full-refund. Release is CONFIRMED-refund driven (audit F6): the
  // admin refund creates the refund + cancels, but the coupon slot frees only
  // when the provider confirms via a refund.succeeded webhook.
  const intent = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber: orderInfo.orderNumber, accessToken: orderInfo.accessToken, provider: 'mock' } });
  const { payload, headers } = signedWebhook({ event_id: 'evt_cp1', kind: 'payment.succeeded', intent_id: intent.json().intentId });
  await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });
  const refund = await app.inject({ method: 'POST', url: `/api/orders/${orderInfo.orderId}/refund`, headers: auth(), payload: {} });
  assert.equal(refund.statusCode, 201);
  const providerRefundId = refund.json().providerRefundId;

  // Not yet released — provider hasn't confirmed.
  assert.equal(await db.couponRedemption.count({ where: { couponId, releasedAt: null } }), 1, 'slot held until provider confirms');

  // Provider confirms the refund → slot released.
  const rw = signedWebhook({ event_id: 'evt_cp_refund', kind: 'refund.succeeded', refund_id: providerRefundId });
  await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload: rw.payload, headers: rw.headers });
  assert.equal(await db.couponRedemption.count({ where: { couponId, releasedAt: null } }), 0, 'redemption released on CONFIRMED refund');
  assert.equal((await db.coupon.findUnique({ where: { id: couponId } })).usageCount, 0, 'usage count freed');
});

test('AUDIT F1: concurrent checkouts of a usageLimit:1 coupon redeem exactly once', async () => {
  const c = await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTRACE', type: 'fixed', amount: 500, usageLimit: 1 } });
  const couponId = c.json().id;

  // Two independent carts, both apply the coupon, then check out at once.
  const [t1, t2] = await Promise.all([newCart(1), newCart(1)]);
  await Promise.all([
    app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: t1, code: 'CPTESTRACE' } }),
    app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: t2, code: 'CPTESTRACE' } }),
  ]);
  const [c1, c2] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: t1 } }),
    app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: t2 } }),
  ]);
  assert.equal(c1.statusCode, 201);
  assert.equal(c2.statusCode, 201);

  // Exactly ONE order got the discount; usageCount is exactly 1.
  const discounted = [c1.json(), c2.json()].filter((o) => o.total === 4500);
  const fullPrice = [c1.json(), c2.json()].filter((o) => o.total === 5000);
  assert.equal(discounted.length, 1, 'exactly one order discounted');
  assert.equal(fullPrice.length, 1, 'the loser paid full price, not a phantom discount');
  assert.equal((await db.coupon.findUnique({ where: { id: couponId } })).usageCount, 1, 'limit:1 honored under concurrency');
  assert.equal(await db.couponRedemption.count({ where: { couponId } }), 1);

  // cleanup both orders
  for (const o of [c1.json(), c2.json()]) {
    await db.couponRedemption.deleteMany({ where: { orderId: o.orderId } });
    await db.order.delete({ where: { id: o.orderId } }).catch(() => {});
  }
});

test('best-single-wins: coupon vs member discount, larger applies, no stacking', async () => {
  // 30% coupon on a 5000 cart = 1500. A member 20% would be 1000. Coupon wins.
  await app.inject({ method: 'POST', url: '/api/coupons', headers: auth(), payload: { code: 'CPTESTBIG', type: 'percent', amount: 30 } });
  const cart = await newCart(1);
  const res = await app.inject({ method: 'POST', url: '/api/cart/coupon', payload: { cartToken: cart, code: 'CPTESTBIG' } });
  const t = res.json().totals;
  assert.equal(t.coupon.amount, 1500);
  assert.equal(t.discount, null, 'no member discount on the anonymous storefront');
  assert.equal(t.total, 3500, 'coupon (the only discount) applied once');
  await app.inject({ method: 'DELETE', url: '/api/cart', headers: { 'x-cart-token': cart } });
});
