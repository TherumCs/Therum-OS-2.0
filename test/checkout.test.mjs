// Counter C1 — gateway layer lifecycle against the REAL wiring: mock
// gateway with genuine HMAC webhook verification, the payment_events
// ledger, guest access-token auth, refund accounting, and the Nexus
// credential gate. Fixtures created per-run, fully removed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { encryptSecret } from '../dist/lib/crypto.js';
import { recomputeReservations } from './support/reservations.mjs';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt(role = 'admin', sub = 'checkout-test') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, iat: now, exp: now + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

const MOCK_CRED = 'mock-secret-credential';

let app;
let vendor, product, variantId;
let orderNumber, orderId, accessToken, intentId;

function signedWebhook(body) {
  const raw = JSON.stringify(body);
  return {
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-mock-signature': createHmac('sha256', MOCK_CRED).update(raw).digest('hex') },
  };
}

before(async () => {
  const { redis } = await import('../dist/lib/redis.js');
  // The order limiter is real (10 per 10 minutes per IP) and the suite creates
  // far more than that from 127.0.0.1, so a later file used to 429 on a test
  // that has nothing to do with rate limiting. Cleared per file, the way the
  // cart limiters already are — the limiter itself stays exercised by the test
  // that asserts it.
  await redis.del('ratelimit:order-create:127.0.0.1');
  app = await buildServer();
  // Mock gateway "connected in Nexus" — seeded directly ('mock' is
  // deliberately not in the public catalog).
  await db.connection.upsert({
    where: { provider: 'mock' },
    update: { credentialEncrypted: encryptSecret(MOCK_CRED), status: 'connected' },
    create: { provider: 'mock', category: 'payments', credentialEncrypted: encryptSecret(MOCK_CRED), maskedPreview: 'mock…', status: 'connected' },
  });
  vendor = await db.vendor.create({ data: { name: 'cktest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'cktest Widget', slug: 'cktest-widget', status: 'active', vendorId: vendor.id,
      variants: { create: [{ sku: 'CKT-1', price: 5000, inventory: 10 }] },
    },
    include: { variants: true },
  });
  variantId = product.variants[0].id;
});

after(async () => {
  await db.paymentEvent.deleteMany({ where: { provider: 'mock' } });
  if (orderId) {
    await db.refund.deleteMany({ where: { orderId } });
    await db.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  await db.product.deleteMany({ where: { slug: 'cktest-widget' } });
  await db.vendor.deleteMany({ where: { name: 'cktest Vendor' } });
  await db.connection.deleteMany({ where: { provider: 'mock' } });
  await db.connectionAuditLog.deleteMany({ where: { provider: 'mock' } });
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('orders mint an access token; gateways list shows mock connected', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { items: [{ variantId, quantity: 2 }], currency: 'USD' } });
  assert.equal(create.statusCode, 201);
  const order = create.json();
  orderNumber = order.number;
  orderId = order.id;
  accessToken = order.accessToken;
  assert.match(accessToken, /^[0-9a-f]{32}$/, '128-bit hex access token minted at creation');

  const gws = await app.inject({ method: 'GET', url: '/api/checkout/gateways' });
  assert.equal(gws.statusCode, 200);
  const mock = gws.json().find((g) => g.id === 'mock');
  assert.ok(mock && mock.connected === true);
  // Post-audit (L-2): the PUBLIC list is connected gateways only — stripe
  // stays hidden from anonymous checkout until it's connected in Nexus.
  assert.ok(!gws.json().some((g) => g.id === 'stripe'), 'unconnected gateways hidden from the public list');
});

test('intent creation: guest-authed by order token; wrong token 401s; unconnected provider 409s', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber, accessToken: 'f'.repeat(32), provider: 'mock' } });
  assert.equal(bad.statusCode, 401);

  const stripe = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber, accessToken, provider: 'stripe' } });
  assert.equal(stripe.statusCode, 409, 'stripe not connected in Nexus → setup required');

  const res = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber, accessToken, provider: 'mock' } });
  assert.equal(res.statusCode, 200);
  const intent = res.json();
  intentId = intent.intentId;
  assert.match(intentId, /^mock_pi_/);
  assert.equal(intent.status, 'requires_action');

  const payment = await db.payment.findFirst({ where: { orderId } });
  assert.equal(payment.txnId, intentId, 'intent stored on the payment row');
  assert.equal(payment.method, 'mock');
});

test('webhook: forged signature rejected; valid payment.succeeded marks paid; replay deduped', async () => {
  const evt = { event_id: 'evt_1', kind: 'payment.succeeded', intent_id: intentId };
  const { payload } = signedWebhook(evt);

  const forged = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers: { 'content-type': 'application/json', 'x-mock-signature': 'deadbeef'.repeat(8) } });
  assert.ok(forged.statusCode >= 400, `forged signature rejected (${forged.statusCode})`);

  const unsigned = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers: { 'content-type': 'application/json' } });
  assert.equal(unsigned.statusCode, 401, 'unsigned webhook rejected');

  const good = signedWebhook(evt);
  const ok = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload: good.payload, headers: good.headers });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().replay, false);

  const order = await db.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  assert.equal(order.status, 'processing', 'payment.succeeded advanced pending → processing');
  assert.equal(order.payment.status, 'paid');
  // Inventory: reservation converted to sale (10 - 2 = 8).
  const v = await db.productVariant.findUnique({ where: { id: variantId } });
  assert.equal(v.inventory, 8);
  assert.equal(v.reserved, 0);

  const replay = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload: good.payload, headers: good.headers });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replay, true, 'ledger dedupes the identical event id');
  assert.equal(await db.paymentEvent.count({ where: { provider: 'mock', providerEventId: 'evt_1' } }), 1);
});

test('unknown event kinds are ledgered but change nothing', async () => {
  const { payload, headers } = signedWebhook({ event_id: 'evt_2', kind: 'dispute.opened', intent_id: intentId });
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });
  assert.equal(res.statusCode, 200);
  const order = await db.order.findUnique({ where: { id: orderId } });
  assert.equal(order.status, 'processing', 'order untouched by unhandled kind');
});

test('refunds: bundle-gated; partial then full; accounting + cancel + restock', async () => {
  // Custom role without storefront-manager → 403.
  const role = await db.role.create({ data: { name: 'cktest-role', bundles: ['read'] } });
  const user = await db.adminUser.create({ data: { username: 'cktest-user', passwordHash: 'x', roleId: role.id } });
  try {
    const denied = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/refund`, headers: { authorization: `Bearer ${jwt('custom', user.id)}` }, payload: { amount: 1000 } });
    assert.equal(denied.statusCode, 403);
  } finally {
    await db.adminUser.delete({ where: { id: user.id } });
    await db.role.delete({ where: { id: role.id } });
  }

  // Partial refund: 3000 of 10000.
  const partial = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/refund`, headers: auth(), payload: { amount: 3000, reason: 'partial test' } });
  assert.equal(partial.statusCode, 201);
  assert.match(partial.json().providerRefundId, /^mock_re_/);
  let order = await db.order.findUnique({ where: { id: orderId } });
  assert.equal(order.refundedTotal, 3000);
  assert.equal(order.status, 'processing', 'partial refund leaves status alone');

  // Over-refund rejected.
  const over = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/refund`, headers: auth(), payload: { amount: 999999 } });
  assert.equal(over.statusCode, 422);

  // Full remaining (amount omitted) → cancel + restock through the state machine.
  const full = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/refund`, headers: auth(), payload: {} });
  assert.equal(full.statusCode, 201);
  order = await db.order.findUnique({ where: { id: orderId } });
  assert.equal(order.refundedTotal, 10000, 'fully refunded');
  assert.equal(order.status, 'cancelled', 'full refund cancels through the real state machine');
  const v = await db.productVariant.findUnique({ where: { id: variantId } });
  assert.equal(v.inventory, 10, 'restocked (refund path)');

  // refund.failed webhook rolls accounting back.
  const r = await db.refund.findFirst({ where: { orderId, amount: 3000 } });
  const { payload, headers } = signedWebhook({ event_id: 'evt_3', kind: 'refund.failed', refund_id: r.providerRefundId });
  await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });
  order = await db.order.findUnique({ where: { id: orderId } });
  assert.equal(order.refundedTotal, 7000, 'failed refund decremented back');
  assert.equal((await db.refund.findUnique({ where: { id: r.id } })).status, 'failed');
});

test('checkout return: verifies with provider and 303s to the receipt with the token', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/checkout/return?provider=mock&order=${orderNumber}&token=${accessToken}` });
  assert.equal(res.statusCode, 303);
  const loc = res.headers.location;
  assert.match(loc, /\/order-received\/\?order=/);
  assert.ok(loc.includes(accessToken), 'receipt link carries the guest token');

  const wrongToken = await app.inject({ method: 'GET', url: `/api/checkout/return?provider=mock&order=${orderNumber}&token=${'0'.repeat(32)}` });
  assert.equal(wrongToken.statusCode, 401);
});

test('AUDIT H-1: accessToken absent from admin list/get/transition; present only at creation', async () => {
  const list = await app.inject({ method: 'GET', url: '/api/orders', headers: auth() });
  assert.equal(list.statusCode, 200);
  for (const o of list.json().items) {
    assert.ok(!('accessToken' in o), 'list must not leak guest tokens');
  }
  const one = await app.inject({ method: 'GET', url: `/api/orders/${orderId}`, headers: auth() });
  assert.ok(!('accessToken' in one.json()), 'get must not leak the guest token');
});

test('AUDIT C-2: refund retry with same idempotency key returns the SAME refund, no double money', async () => {
  // Fresh paid order.
  const create = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { items: [{ variantId, quantity: 1 }], currency: 'USD' } });
  const o = create.json();
  const intent = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber: o.number, accessToken: o.accessToken, provider: 'mock' } });
  const { payload, headers } = signedWebhook({ event_id: 'evt_r1', kind: 'payment.succeeded', intent_id: intent.json().intentId });
  await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });

  const key = 'retry-test-idempotency-key-1';
  const first = await app.inject({ method: 'POST', url: `/api/orders/${o.id}/refund`, headers: auth(), payload: { amount: 2000, idempotencyKey: key } });
  assert.equal(first.statusCode, 201);
  const second = await app.inject({ method: 'POST', url: `/api/orders/${o.id}/refund`, headers: auth(), payload: { amount: 2000, idempotencyKey: key } });
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().id, first.json().id, 'retry returned the ORIGINAL refund row');
  const order = await db.order.findUnique({ where: { id: o.id } });
  assert.equal(order.refundedTotal, 2000, 'refunded once, not twice');
  assert.equal(await db.refund.count({ where: { orderId: o.id } }), 1);

  // Derived-key retry (no client key): identical amount+reason also dedupes.
  const d1 = await app.inject({ method: 'POST', url: `/api/orders/${o.id}/refund`, headers: auth(), payload: { amount: 1000, reason: 'dup' } });
  const d2 = await app.inject({ method: 'POST', url: `/api/orders/${o.id}/refund`, headers: auth(), payload: { amount: 1000, reason: 'dup' } });
  assert.equal(d2.json().id, d1.json().id);
  await db.refund.deleteMany({ where: { orderId: o.id } });
  await db.order.delete({ where: { id: o.id } });
});

test('AUDIT C-1: a ledgered-but-unapplied event is APPLIED on retry, not swallowed as replay', async () => {
  // Fresh order + intent.
  const create = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { items: [{ variantId, quantity: 1 }], currency: 'USD' } });
  const o = create.json();
  const intent = await app.inject({ method: 'POST', url: '/api/checkout/intent', payload: { orderNumber: o.number, accessToken: o.accessToken, provider: 'mock' } });
  const iid = intent.json().intentId;

  // Simulate the failure mode: event ledgered (applied:false) but never applied.
  await db.paymentEvent.create({ data: { provider: 'mock', providerEventId: 'evt_stuck', kind: 'payment.succeeded', paymentIntentId: iid, applied: false } });

  // Provider retry of the same event id — must RE-APPLY, not no-op.
  const { payload, headers } = signedWebhook({ event_id: 'evt_stuck', kind: 'payment.succeeded', intent_id: iid });
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/psp/mock', payload, headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().replay, true, 'recognized as a ledgered retry');
  const order = await db.order.findUnique({ where: { id: o.id } });
  assert.equal(order.status, 'processing', 'the stuck event was applied on retry');
  const evt = await db.paymentEvent.findUnique({ where: { provider_event: { provider: 'mock', providerEventId: 'evt_stuck' } } });
  assert.equal(evt.applied, true);

  await db.order.delete({ where: { id: o.id } });
  // restock manually since we bypass the normal lifecycle teardown
  await db.productVariant.update({ where: { id: variantId }, data: { inventory: 10, reserved: 0 } });
});

test('AUDIT H-2: Stripe refund.updated maps by refund status, not unconditionally to succeeded', async () => {
  const { stripeGateway } = await import('../dist/lib/payments/stripeGateway.js');
  const mk = (status) => stripeGateway.parseEvent({ id: 'evt_x', type: 'refund.updated', data: { object: { id: 're_1', status, payment_intent: 'pi_1' } } });
  assert.equal(mk('succeeded').kind, 'refund.succeeded');
  assert.equal(mk('failed').kind, 'refund.failed');
  assert.equal(mk('canceled').kind, 'refund.failed');
  assert.equal(mk('pending').kind, 'refund.pending');
  // metadata order_id fallback rides through payload (M-1).
  const withMeta = stripeGateway.parseEvent({ id: 'evt_y', type: 'payment_intent.succeeded', data: { object: { id: 'pi_2', metadata: { order_id: 'ord_123' } } } });
  assert.equal(withMeta.payload.orderId, 'ord_123');
});

test('AUDIT L-2: anonymous gateway list shows only CONNECTED gateways', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/checkout/gateways' });
  assert.equal(res.statusCode, 200);
  const ids = res.json().map((g) => g.id);
  assert.ok(ids.includes('mock'), 'connected gateway listed');
  assert.ok(!ids.includes('stripe'), 'unconnected gateway hidden from anonymous checkout');
});

test('C4.1 method strip: registry grouped, availability resolved from connections', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/checkout/methods' });
  assert.equal(res.statusCode, 200);
  const { groups, methods } = res.json();
  // 'crypto' is absent BY DESIGN: all six coins carry `hidden: true` (parked,
  // not abandoned), and a group with no visible method must not render an
  // empty tab. The 1.x order is otherwise preserved.
  assert.deepEqual(groups.map((g) => g.id), ['card', 'wallets', 'bnpl', 'bank', 'p2p'], '1.x strip group order, minus fully-hidden groups');
  assert.ok(!methods.some((m) => m.group === 'crypto'), 'a hidden method must not reach the response at all');

  const card = methods.find((m) => m.id === 'card');
  assert.equal(card.available, true, 'card fulfilled by a connected provider');
  // Asserts it resolved to SOME connected payment provider, not specifically
  // 'mock'. This suite runs against the development database: the moment a
  // real gateway (Square) was connected there, it won the card method and this
  // assertion failed — a test that only passed while the operator had no
  // payment provider set up.
  const connectedPayments = (await db.connection.findMany({ where: { category: 'payments' }, select: { provider: true } })).map((c) => c.provider);
  assert.ok(
    [...connectedPayments, 'mock'].includes(card.provider),
    `card resolved to ${card.provider}, which is not a connected payment provider`,
  );

  const klarna = methods.find((m) => m.id === 'klarna');
  assert.equal(klarna.available, false, 'unconnected provider → setup required');
  assert.equal(klarna.provider, null);

  // NO CHECKS EVER — the registry must not contain any check/cheque method.
  assert.equal(methods.some((m) => /check|cheque/i.test(m.id) || /check|cheque/i.test(m.label)), false);
});

test('C6: sales report counts only PAID orders; math is exact; auth required', async () => {
  const noAuth = await app.inject({ method: 'GET', url: '/api/reports/sales' });
  assert.equal(noAuth.statusCode, 401);

  const res = await app.inject({ method: 'GET', url: '/api/reports/sales?days=1', headers: auth() });
  assert.equal(res.statusCode, 200);
  const r = res.json();
  // This suite paid exactly one order through the webhook path (5000 - 1000
  // refunded earlier in the lifecycle tests may vary) — assert invariants,
  // not brittle absolutes:
  assert.equal(typeof r.gross, 'number');
  assert.equal(r.net, r.gross - r.refunded, 'net = gross - refunded, always');
  assert.ok(r.orderCount >= 1, 'the paid order from this suite is counted');
  assert.ok(Array.isArray(r.topProducts) && Array.isArray(r.daily));
  if (r.orderCount > 0) assert.equal(r.averageOrder, Math.round(r.gross / r.orderCount));
});

test('C6: receipt + refund emails are safe no-ops without SMTP and never throw', async () => {
  const { commerceEmailService } = await import('../dist/services/commerceEmail.service.js');
  // No SMTP configured in the test env — both must resolve silently (the
  // webhook path calls them fire-and-forget; a throw here = unhandled
  // rejection in production).
  await commerceEmailService.sendReceipt('nonexistent-order-id', 'http://localhost');
  await commerceEmailService.sendRefundNotice('nonexistent-order-id');
  assert.ok(true, 'no throw');
});
