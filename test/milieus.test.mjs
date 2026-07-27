// Milieus M1 — semantics tests per the spec
// (docs/superpowers/specs/2026-07-21-milieus-native-design.md). Needs DB up +
// built dist: docker compose up -d && npm run build && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

const SECRET = process.env.JWT_SECRET ?? '';

function jwt(role = 'admin', sub = 'milieus-test') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, iat: now, exp: now + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;
let customerId;
let milieuId;

before(async () => {
  app = await buildServer();
  const c = await db.customer.upsert({
    where: { email: 'milieus-test@example.com' },
    update: {},
    create: { email: 'milieus-test@example.com', name: 'Milieus Tester' },
  });
  customerId = c.id;
});

after(async () => {
  // Leave no test data behind.
  await db.milieuMembership.deleteMany({ where: { customerId } });
  await db.milieu.deleteMany({ where: { slug: { startsWith: 'mtest-' } } });
  await db.customer.delete({ where: { id: customerId } }).catch(() => {});
  await app.close();
  await closeQueues(); // open BullMQ queues keep the event loop alive → run never exits
  await disconnectDb();
});

test('milieu create, slug conflict 409, list includes memberCount', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Test VIP', slug: 'mtest-vip', discountPct: 10, memberDurationDays: 14 } });
  assert.equal(res.statusCode, 201);
  milieuId = res.json().id;

  const dupe = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Dupe', slug: 'mtest-vip' } });
  assert.equal(dupe.statusCode, 409);

  const list = await app.inject({ method: 'GET', url: '/api/milieus', headers: auth() });
  assert.equal(list.statusCode, 200);
  const mine = list.json().find((m) => m.slug === 'mtest-vip');
  assert.ok(mine);
  assert.equal(mine.memberCount, 0);
});

test('assign is idempotent and applies the group default duration; re-add resets', async () => {
  const res = await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members`, headers: auth(), payload: { customerId } });
  assert.equal(res.statusCode, 201);
  const first = res.json();
  assert.ok(first.expiresAt, 'default 14-day duration should set an expiry');

  // Manually age the membership, then re-add: assignedAt/expiresAt must reset.
  await db.milieuMembership.update({
    where: { milieu_customer: { milieuId, customerId } },
    data: { assignedAt: new Date(Date.now() - 10 * 24 * 3600e3), expiresAt: new Date(Date.now() + 1 * 24 * 3600e3) },
  });
  const again = await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members`, headers: auth(), payload: { email: 'milieus-test@example.com' } });
  assert.equal(again.statusCode, 201);
  const second = again.json();
  const delta = new Date(second.expiresAt).getTime() - Date.now();
  assert.ok(delta > 13 * 24 * 3600e3, 're-add recomputes expiry from now + group default');

  // Still exactly one membership row (upsert, not duplicate).
  const count = await db.milieuMembership.count({ where: { milieuId, customerId } });
  assert.equal(count, 1);
});

test('extend: adds to max(current, now); permanent membership is a no-op', async () => {
  const before30 = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } } });
  const res = await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members/${customerId}/extend`, headers: auth(), payload: { seconds: 30 * 24 * 3600 } });
  assert.equal(res.statusCode, 200);
  const extended = new Date(res.json().expiresAt).getTime();
  assert.ok(Math.abs(extended - (before30.expiresAt.getTime() + 30 * 24 * 3600e3)) < 2000, 'future expiry extends from current expiry');

  // Past-expiry extension restarts from now (1.x rule).
  await db.milieuMembership.update({ where: { milieu_customer: { milieuId, customerId } }, data: { expiresAt: new Date(Date.now() - 24 * 3600e3) } });
  const r2 = await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members/${customerId}/extend`, headers: auth(), payload: { seconds: 3600 } });
  const fromNow = new Date(r2.json().expiresAt).getTime() - Date.now();
  assert.ok(fromNow > 0 && fromNow <= 3600e3 + 2000, 'past expiry restarts extension from now');

  // Permanent = no-op (null back).
  await db.milieuMembership.update({ where: { milieu_customer: { milieuId, customerId } }, data: { expiresAt: null } });
  const r3 = await app.inject({ method: 'POST', url: `/api/milieus/${milieuId}/members/${customerId}/extend`, headers: auth(), payload: { seconds: 3600 } });
  assert.equal(r3.json().expiresAt, null);
});

test('discountFor: largest single milieu wins, expired memberships excluded', async () => {
  const { milieuService } = await import('../dist/services/milieu.service.js');
  // Second milieu with a bigger discount.
  const big = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Bigger', slug: 'mtest-big', discountPct: 25 } });
  const bigId = big.json().id;
  await app.inject({ method: 'POST', url: `/api/milieus/${bigId}/members`, headers: auth(), payload: { customerId } });

  const d = await milieuService.discountFor(customerId);
  assert.equal(d.pct, 25);
  assert.equal(d.milieuName, 'Bigger');

  // Expire the bigger membership → falls back to the 10% one.
  await db.milieuMembership.update({ where: { milieu_customer: { milieuId: bigId, customerId } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const d2 = await milieuService.discountFor(customerId);
  assert.equal(d2.pct, 10);
});

test('sweep: expired membership revoked; expired milieu deleted with cascade', async () => {
  // Expired membership on the big milieu (set above) gets swept.
  const res = await app.inject({ method: 'POST', url: '/api/milieus/sweep', headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().membershipsRevoked >= 1);

  // Group-lifetime timeline: milieu with expiresAt in the past disappears entirely.
  const dying = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Dying', slug: 'mtest-dying', expiresAt: new Date(Date.now() - 1000).toISOString() } });
  const dyingId = dying.json().id;
  await app.inject({ method: 'POST', url: `/api/milieus/${dyingId}/members`, headers: auth(), payload: { customerId } });
  const sweep2 = await app.inject({ method: 'POST', url: '/api/milieus/sweep', headers: auth() });
  assert.ok(sweep2.json().milieusDeleted >= 1);
  const gone = await app.inject({ method: 'GET', url: `/api/milieus/${dyingId}`, headers: auth() });
  assert.equal(gone.statusCode, 404);
  const orphans = await db.milieuMembership.count({ where: { milieuId: dyingId } });
  assert.equal(orphans, 0, 'memberships cascade with the milieu');
});

test('M2 discount: member order priced down with label; guest order untouched', async () => {
  // Variant to order — reuse whatever the seed has.
  const variant = await db.productVariant.findFirst({ select: { id: true, price: true } });
  assert.ok(variant, 'needs seeded variant');

  // Customer is in mtest-vip (10%) from earlier tests; make membership active/permanent.
  await db.milieuMembership.update({ where: { milieu_customer: { milieuId, customerId } }, data: { expiresAt: null, pendingAt: null } });

  const res = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { customerId, items: [{ variantId: variant.id, quantity: 1 }], currency: 'USD' } });
  assert.equal(res.statusCode, 201);
  const order = res.json();
  const expectedDiscount = Math.round(variant.price * 0.1);
  assert.equal(order.discountAmount, expectedDiscount);
  assert.equal(order.total, variant.price - expectedDiscount);
  assert.match(order.discountLabel, /Test VIP discount \(10%\)/);
  assert.equal(order.payment.amount, order.total, 'payment amount matches discounted total');
  // cleanup: release reservation + delete order
  await db.$executeRawUnsafe(`UPDATE product_variants SET reserved = reserved - 1 WHERE id = '${variant.id}'`);
  await db.order.delete({ where: { id: order.id } });

  // Guest (no customer) — no discount fields set.
  const guest = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(), payload: { items: [{ variantId: variant.id, quantity: 1 }], currency: 'USD' } });
  assert.equal(guest.statusCode, 201);
  assert.equal(guest.json().discountAmount, 0);
  assert.equal(guest.json().total, variant.price);
  await db.$executeRawUnsafe(`UPDATE product_variants SET reserved = reserved - 1 WHERE id = '${variant.id}'`);
  await db.order.delete({ where: { id: guest.json().id } });
});

test('M3 reminders: fires once per membership within window, stamps reminderSentAt', async () => {
  const { milieuService } = await import('../dist/services/milieu.service.js');
  await db.milieuMembership.update({
    where: { milieu_customer: { milieuId, customerId } },
    data: { expiresAt: new Date(Date.now() + 2 * 24 * 3600e3), reminderSentAt: null },
  });
  const first = await milieuService.runReminders(3);
  assert.ok(first >= 1);
  const second = await milieuService.runReminders(3);
  assert.equal(second, 0, 'reminder fires at most once per membership');
  const row = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } } });
  assert.ok(row.reminderSentAt);
});

test('M4 registration: public signup, approval gate, honeypot, max signups, rate limit', async () => {
  // Reg-enabled milieu with approval.
  const reg = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Waitlist', slug: 'mtest-wait', regEnabled: true, regSlug: 'mtest-wait-join', regRequiresApproval: true, memberDurationDays: 30, discountPct: 50 } });
  assert.equal(reg.statusCode, 201);
  const regId = reg.json().id;

  // Public signup — NO auth header at all.
  const signup = await app.inject({ method: 'POST', url: '/api/public/register/mtest-wait-join', payload: { email: 'milieus-signup@example.com', name: 'Signup Test' } });
  assert.equal(signup.statusCode, 201);
  assert.equal(signup.json().status, 'pending');

  const newCustomer = await db.customer.findUnique({ where: { email: 'milieus-signup@example.com' } });
  assert.ok(newCustomer, 'signup created a real Customer');

  // Pending = no discount despite the milieu's 50%.
  const { milieuService } = await import('../dist/services/milieu.service.js');
  const d = await milieuService.discountFor(newCustomer.id);
  assert.ok(!d || d.pct !== 50, 'pending membership grants no discount');

  // Approve → active, duration starts now, discount applies.
  const approved = await app.inject({ method: 'POST', url: `/api/milieus/${regId}/members/${newCustomer.id}/approve`, headers: auth() });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().pendingAt, null);
  const d2 = await milieuService.discountFor(newCustomer.id);
  assert.equal(d2.pct, 50);

  // Honeypot: filled website field → fake 201, no membership row created.
  const bot = await app.inject({ method: 'POST', url: '/api/public/register/mtest-wait-join', payload: { email: 'bot@example.com', website: 'http://spam.example' } });
  assert.equal(bot.statusCode, 201);
  assert.equal(await db.customer.findUnique({ where: { email: 'bot@example.com' } }), null);

  // Unknown/disabled slug → 404.
  const nope = await app.inject({ method: 'POST', url: '/api/public/register/no-such-link', payload: { email: 'x@example.com' } });
  assert.equal(nope.statusCode, 404);

  // Max signups: cap at current count → next signup rejected.
  const current = (await db.milieu.findUnique({ where: { id: regId } })).regSignupCount;
  await db.milieu.update({ where: { id: regId }, data: { regMaxSignups: current } });
  const capped = await app.inject({ method: 'POST', url: '/api/public/register/mtest-wait-join', payload: { email: 'late@example.com' } });
  assert.equal(capped.statusCode, 422);
  await db.milieu.update({ where: { id: regId }, data: { regMaxSignups: 0 } });

  // Rate limit: hammer until 429 (limit 5/hour/IP; some hits already spent above).
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/public/register/mtest-wait-join', payload: { email: `rate${i}@example.com` } });
    if (r.statusCode === 429) { limited = true; break; }
  }
  assert.ok(limited, 'per-IP rate limit kicks in');

  // Cleanup M4 artifacts.
  await db.milieuMembership.deleteMany({ where: { milieuId: regId } });
  await db.milieu.delete({ where: { id: regId } });
  await db.customer.deleteMany({ where: { email: { in: ['milieus-signup@example.com', 'late@example.com', 'rate0@example.com', 'rate1@example.com', 'rate2@example.com', 'rate3@example.com', 'rate4@example.com', 'rate5@example.com'] } } });
});

test('AUDIT: public re-registration of an existing member is a no-op (no renewal, no name overwrite, no counter burn)', async () => {
  const reg = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'NoOp Grp', slug: 'mtest-noop', regEnabled: true, regSlug: 'mtest-noop-join', memberDurationDays: 14 } });
  const regId = reg.json().id;

  // Distinct client IPs — the previous test legitimately exhausted the
  // default inject IP's 5/hour budget (rate limit is checked before the
  // member-no-op lookup, same order as 1.x).
  const first = await app.inject({ method: 'POST', url: '/api/public/register/mtest-noop-join', remoteAddress: '10.9.9.1', payload: { email: 'noop@example.com', name: 'Original Name' } });
  assert.equal(first.statusCode, 201);
  const customer = await db.customer.findUnique({ where: { email: 'noop@example.com' } });
  const before = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId: regId, customerId: customer.id } } });
  const countBefore = (await db.milieu.findUnique({ where: { id: regId } })).regSignupCount;

  // Attacker re-submits the member's email with a hostile name (their own IP).
  const again = await app.inject({ method: 'POST', url: '/api/public/register/mtest-noop-join', remoteAddress: '10.9.9.2', payload: { email: 'noop@example.com', name: '<img onerror=x>' } });
  assert.equal(again.statusCode, 201);
  assert.equal(again.json().status, 'active');

  const after = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId: regId, customerId: customer.id } } });
  assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime(), 'expiry NOT renewed by re-registration');
  assert.equal(after.assignedAt.getTime(), before.assignedAt.getTime(), 'assignedAt untouched');
  const c2 = await db.customer.findUnique({ where: { email: 'noop@example.com' } });
  assert.equal(c2.name, 'Original Name', 'existing customer name never overwritten from public path');
  const countAfter = (await db.milieu.findUnique({ where: { id: regId } })).regSignupCount;
  assert.equal(countAfter, countBefore, 'signup counter not burned by repeat submissions');

  await db.milieuMembership.deleteMany({ where: { milieuId: regId } });
  await db.milieu.delete({ where: { id: regId } });
  await db.customer.delete({ where: { id: customer.id } });
});

test('AUDIT: bundle gate — custom role without storefront-manager gets 403 on mutations, 200 on reads', async () => {
  const role = await db.role.create({ data: { name: 'mtest-limited-role', bundles: ['read'] } });
  // AdminUser has no scalar role column — 'custom' rides in the JWT; access
  // is resolved live from roleId (auth.ts resolveAccess).
  const user = await db.adminUser.create({ data: { username: 'mtest-limited', passwordHash: 'x', roleId: role.id } });
  const customAuth = { authorization: `Bearer ${jwt('custom', user.id)}` };
  try {
    const read = await app.inject({ method: 'GET', url: '/api/milieus', headers: customAuth });
    assert.equal(read.statusCode, 200, 'reads stay open to authenticated custom roles');
    const write = await app.inject({ method: 'POST', url: '/api/milieus', headers: customAuth, payload: { name: 'Nope', slug: 'mtest-nope' } });
    assert.equal(write.statusCode, 403);
    assert.equal(write.json().error.code, 'bundle_required');
    const sweep = await app.inject({ method: 'POST', url: '/api/milieus/sweep', headers: customAuth });
    assert.equal(sweep.statusCode, 403, 'sweep is also bundle-gated');
  } finally {
    await db.adminUser.delete({ where: { id: user.id } });
    await db.role.delete({ where: { id: role.id } });
  }
});

test('AUDIT: regEnabled without regSlug rejected; PATCH regSlug conflict is a clean 409', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Bad', slug: 'mtest-bad', regEnabled: true } });
  assert.equal(bad.statusCode, 422);

  const a = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'A', slug: 'mtest-a', regEnabled: true, regSlug: 'mtest-a-join' } });
  const b = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'B', slug: 'mtest-b' } });
  const clash = await app.inject({ method: 'PATCH', url: `/api/milieus/${b.json().id}`, headers: auth(), payload: { regSlug: 'mtest-a-join' } });
  assert.equal(clash.statusCode, 409);
  await db.milieu.deleteMany({ where: { slug: { in: ['mtest-a', 'mtest-b'] } } });
});

test('capability gate: disabling memberships 403s the whole surface', async () => {
  const { capabilityService } = await import('../dist/services/capability.service.js');
  await capabilityService.setEnabled('memberships', false);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/milieus', headers: auth() });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'capability_disabled');
  } finally {
    await capabilityService.setEnabled('memberships', true);
  }
});

test('AUDIT: name-only PATCH must not reset discount/duration/registration (partial()-defaults bug)', async () => {
  const create = await app.inject({ method: 'POST', url: '/api/milieus', headers: auth(), payload: { name: 'Patch Guard', slug: 'mtest-patch-guard', discountPct: 25, memberDurationDays: 90, regEnabled: true, regSlug: 'mtest-pg-join', regMaxSignups: 10 } });
  assert.equal(create.statusCode, 201);
  const id = create.json().id;
  const patch = await app.inject({ method: 'PATCH', url: `/api/milieus/${id}`, headers: auth(), payload: { name: 'Patch Guard Renamed' } });
  assert.equal(patch.statusCode, 200);
  const m = await db.milieu.findUnique({ where: { id } });
  assert.equal(m.discountPct, 25, 'discount survives name-only PATCH');
  assert.equal(m.memberDurationDays, 90, 'duration survives');
  assert.equal(m.regEnabled, true, 'registration link survives');
  assert.equal(m.regSlug, 'mtest-pg-join');
  assert.equal(m.regMaxSignups, 10);
  await db.milieu.delete({ where: { id } });
});
