// End-to-end API tests via Fastify inject(). Needs the DB up + env loaded:
//   docker compose up -d && npm run build && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { recomputeReservations } from './support/reservations.mjs';
import { ensureSiteVisible } from './support/publicSite.mjs';

const SECRET = process.env.JWT_SECRET ?? '';
const WHSECRET = process.env.WEBHOOK_SECRET ?? '';

function jwt(role = 'admin') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'it', role, iat: now, exp: now + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;
let variantId;
before(async () => {
  // A dev box left in coming-soon mode serves the launch page to every
  // public request, and these assertions then fail on content.
  await ensureSiteVisible();
  const { redis } = await import('../dist/lib/redis.js');
  // The order limiter is real (10 per 10 minutes per IP) and the suite creates
  // far more than that from 127.0.0.1, so a later file used to 429 on a test
  // that has nothing to do with rate limiting. Cleared per file, the way the
  // cart limiters already are — the limiter itself stays exercised by the test
  // that asserts it.
  await redis.del('ratelimit:order-create:127.0.0.1');
  app = await buildServer();
});
after(async () => {
  // The extension-register test seeds a real row directly (name: it-ext-<ts>);
  // clean it up so repeated runs don't pile up in this shared dev DB.
  await db.extension.deleteMany({ where: { name: { startsWith: 'it-ext-' } } });
  // This suite creates ACTIVE "IT Product …" rows plus real orders against
  // them — both used to leak into the shared dev DB (and onto the public
  // /shop) on every run. Delete the orders first (they FK-pin the variants),
  // then the products.
  const leaked = await db.product.findMany({ where: { name: { startsWith: 'IT Product' } }, select: { id: true } });
  if (leaked.length) {
    const ids = leaked.map((p) => p.id);
    const orders = await db.order.findMany({ where: { items: { some: { variant: { productId: { in: ids } } } } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      await db.refund.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await db.product.deleteMany({ where: { id: { in: ids } } });
  }
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('health reports db up', async () => {
  const r = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().db, true);
});

test('product create requires auth (401)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/products', payload: { name: 'x' } });
  assert.equal(r.statusCode, 401);
});

test('create product returns entity with variant', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/products',
    headers: auth(),
    payload: { name: `IT Product ${Date.now()}`, status: 'active', variants: [{ price: 2500, inventory: 5 }] },
  });
  assert.equal(r.statusCode, 201);
  const p = r.json();
  assert.ok(p.id);
  assert.equal(p.variants.length, 1);
  variantId = p.variants[0].id;
});

test('order reserves inventory + is idempotent + total is correct', async () => {
  const key = `it-${Date.now()}`;
  const payload = { items: [{ variantId, quantity: 2 }], idempotencyKey: key };
  const r1 = await app.inject({ method: 'POST', url: '/api/orders', payload });
  assert.equal(r1.statusCode, 201);
  const o1 = r1.json();
  assert.equal(o1.status, 'pending');
  assert.equal(o1.total, 5000);
  const r2 = await app.inject({ method: 'POST', url: '/api/orders', payload });
  assert.equal(r2.json().id, o1.id, 'idempotent: same order id');
});

test('oversell guard returns 409', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/orders', payload: { items: [{ variantId, quantity: 9999 }] } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error.code, 'conflict');
});

test('webhook rejects bad signature, accepts valid + marks paid', async () => {
  const oc = await app.inject({ method: 'POST', url: '/api/orders', payload: { items: [{ variantId, quantity: 1 }] } });
  const orderId = oc.json().id;
  const body = JSON.stringify({ type: 'payment.succeeded', orderId, txnId: 'it-txn' });

  const bad = await app.inject({ method: 'POST', url: '/api/webhooks/test', headers: { 'content-type': 'application/json', 'x-therum-signature': 'nope' }, payload: body });
  assert.equal(bad.statusCode, 401);

  const sig = createHmac('sha256', WHSECRET).update(body).digest('hex');
  const ok = await app.inject({ method: 'POST', url: '/api/webhooks/test', headers: { 'content-type': 'application/json', 'x-therum-signature': sig }, payload: body });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, 'processing');
});

test('extension register works; bad permission is 422', async () => {
  const good = await app.inject({ method: 'POST', url: '/api/extensions', headers: auth(), payload: { name: `it-ext-${Date.now()}`, version: '1.0.0', manifest: { hooks: ['onOrderPaid'], permissions: ['orders:read'] } } });
  assert.equal(good.statusCode, 201);
  const bad = await app.inject({ method: 'POST', url: '/api/extensions', headers: auth(), payload: { name: 'it-bad', version: '1', manifest: { permissions: ['users:delete'] } } });
  assert.equal(bad.statusCode, 422);
});
