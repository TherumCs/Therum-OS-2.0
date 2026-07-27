// Counter C4 — storefront surfaces: render, catalog visibility rules,
// receipt token auth, capability gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

let app;
let vendor, product, order;

before(async () => {
  app = await buildServer();
  const { redis } = await import('../dist/lib/redis.js');
  await redis.del('ratelimit:cart-new:127.0.0.1');
  vendor = await db.vendor.create({ data: { name: 'sftest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'sftest Hoodie', slug: 'sftest-hoodie', status: 'active', vendorId: vendor.id,
      variants: { create: [{ sku: 'SFT-1', price: 4500, inventory: 9 }] },
    },
    include: { variants: true },
  });
  await db.product.create({ data: { name: 'sftest Draft', slug: 'sftest-draft', status: 'draft', vendorId: vendor.id } });
});

after(async () => {
  if (order?.orderId) {
    await db.order.delete({ where: { id: order.orderId } }).catch(() => {});
  }
  await db.product.deleteMany({ where: { slug: { startsWith: 'sftest-' } } });
  await db.vendor.deleteMany({ where: { name: 'sftest Vendor' } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('/shop renders active products only; / serves the Base Theme site', async () => {
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200, 'bare / is the site frontend now, not a shop redirect');
  assert.match(root.headers['content-type'], /text\/html/);

  const res = await app.inject({ method: 'GET', url: '/shop' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /sftest Hoodie/);
  assert.doesNotMatch(res.body, /sftest Draft/, 'draft products never leak to the storefront');
  assert.match(res.headers['content-security-policy'], /connect-src 'self'/);
});

test('/product/:slug renders detail; draft and unknown slugs 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/product/sftest-hoodie' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /sftest Hoodie/);
  assert.match(res.body, /Add to cart/);

  const draft = await app.inject({ method: 'GET', url: '/product/sftest-draft' });
  assert.equal(draft.statusCode, 404, 'draft product page hidden');
  const ghost = await app.inject({ method: 'GET', url: '/product/no-such' });
  assert.equal(ghost.statusCode, 404);
});

test('/cart and /checkout render shells (client-side hydrated)', async () => {
  const cart = await app.inject({ method: 'GET', url: '/cart' });
  assert.equal(cart.statusCode, 200);
  assert.match(cart.body, /cart-root/);
  const co = await app.inject({ method: 'GET', url: '/checkout' });
  assert.equal(co.statusCode, 200);
  assert.match(co.body, /co-root/);
});

test('/order-received/ authenticates by access token; wrong/missing token 404s', async () => {
  // Real order through the real cart machinery.
  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: product.variants[0].id, quantity: 1 } });
  const token = add.json().token;
  const co = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: token, email: 'sf-shopper@example.com' } });
  order = co.json();

  const ok = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}&token=${order.accessToken}` });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, new RegExp(order.orderNumber));
  assert.match(ok.body, /sf-shopper@example\.com/);

  const bad = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}&token=${'0'.repeat(32)}` });
  assert.equal(bad.statusCode, 404, 'wrong token → generic not-found');
  const none = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}` });
  assert.equal(none.statusCode, 404, 'missing token → not-found');
});

test('capability gate: commerce off → closed page, catalog hidden', async () => {
  const { capabilityService } = await import('../dist/services/capability.service.js');
  await capabilityService.setEnabled('commerce', false);
  try {
    const res = await app.inject({ method: 'GET', url: '/shop' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /isn't open yet/);
    assert.doesNotMatch(res.body, /sftest Hoodie/);
  } finally {
    await capabilityService.setEnabled('commerce', true);
  }
});
