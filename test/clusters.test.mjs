// Cluster — ported from the 1.x plugin's GroupEngineTest.php (the semantic
// spec) plus 2.0-specific coverage: merged-variant resolution, drift, and the
// capability/bundle gates. Fixtures are created per-run and fully removed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt(role = 'admin', sub = 'clusters-test') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, iat: now, exp: now + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;
let vendorA, vendorB;
// pA: created FIRST (the "lowest id" analog for default-primary tests).
// pA has color+size variants; pB color-only (drift!); pC color+size.
let pA, pB, pC, pD;

before(async () => {
  app = await buildServer();
  vendorA = await db.vendor.create({ data: { name: 'ctest Vendor A' } });
  vendorB = await db.vendor.create({ data: { name: 'ctest Vendor B' } });

  pA = await db.product.create({
    data: {
      name: 'ctest Tee A', slug: 'ctest-tee-a', status: 'active', vendorId: vendorA.id,
      variants: { create: [
        { sku: 'CTA-RED-M', price: 2000, color: 'red', size: 'M', inventory: 5 },
        { sku: 'CTA-BLUE-M', price: 2000, color: 'blue', size: 'M', inventory: 0 }, // out of stock
      ] },
    },
  });
  // ensure strictly later createdAt ordering
  await new Promise((r) => setTimeout(r, 20));
  pB = await db.product.create({
    data: {
      name: 'ctest Tee B', slug: 'ctest-tee-b', status: 'active', vendorId: vendorB.id,
      variants: { create: [
        { sku: 'CTB-BLUE', price: 1800, color: 'blue', size: 'M', inventory: 7 }, // same combo as CTA-BLUE-M, in stock
        { sku: 'CTB-GREEN', price: 1900, color: 'green', size: null, inventory: 3 }, // color-only → drift vs size users
      ] },
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  pC = await db.product.create({
    data: {
      name: 'ctest Tee C', slug: 'ctest-tee-c', status: 'active', vendorId: vendorB.id,
      variants: { create: [{ sku: 'CTC-RED-L', price: 2100, color: 'red', size: 'L', inventory: 4 }] },
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  pD = await db.product.create({
    data: { name: 'ctest Tee D', slug: 'ctest-tee-d', status: 'active', vendorId: vendorA.id },
  });
});

after(async () => {
  // Leave no test data behind — groups first (memberships cascade), then products/vendors.
  await db.clusterGroup.deleteMany({ where: { name: { startsWith: 'ctest' } } });
  await db.product.deleteMany({ where: { slug: { startsWith: 'ctest-' } } });
  await db.vendor.deleteMany({ where: { name: { startsWith: 'ctest' } } });
  await app.close();
  await closeQueues(); // open queues/redis keep the event loop alive → run never exits
  await disconnectDb();
});

test('create: fewer than 2 products is rejected (422); unknown product ids rejected', async () => {
  const one = await app.inject({ method: 'POST', url: '/api/clusters', headers: auth(), payload: { name: 'ctest Solo', productIds: [pA.id] } });
  assert.equal(one.statusCode, 422);
  const ghost = await app.inject({ method: 'POST', url: '/api/clusters', headers: auth(), payload: { name: 'ctest Ghost', productIds: [pA.id, 'nope-123'] } });
  assert.equal(ghost.statusCode, 422);
  assert.equal(await db.clusterGroup.count({ where: { name: { startsWith: 'ctest' } } }), 0, 'failed creates leave no group row');
});

test('create writes symmetric membership; primary defaults to earliest-created member', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/clusters', headers: auth(), payload: { name: 'ctest Group1', productIds: [pB.id, pA.id, pC.id] } });
  assert.equal(r.statusCode, 201);
  const g = r.json();
  assert.equal(g.members.length, 3);
  // pA created first → default primary despite being listed second.
  assert.equal(g.primaryProductId, pA.id);
  assert.equal(g.primaryIsExplicit, false);
  assert.ok(g.members[0].isPrimary && g.members[0].productId === pA.id, 'members ordered primary-first');
});

test('explicit primary overrides; non-member 422s; clearing reverts to earliest', async () => {
  const g = await db.clusterGroup.findFirst({ where: { name: 'ctest Group1' } });
  const set = await app.inject({ method: 'POST', url: `/api/clusters/${g.id}/primary`, headers: auth(), payload: { productId: pC.id } });
  assert.equal(set.statusCode, 200);
  assert.equal(set.json().primaryProductId, pC.id);
  assert.equal(set.json().primaryIsExplicit, true);

  const bad = await app.inject({ method: 'POST', url: `/api/clusters/${g.id}/primary`, headers: auth(), payload: { productId: pD.id } });
  assert.equal(bad.statusCode, 422, 'non-member primary rejected (declared divergence from 1.x silent ignore)');

  const clear = await app.inject({ method: 'POST', url: `/api/clusters/${g.id}/primary`, headers: auth(), payload: { productId: null } });
  assert.equal(clear.statusCode, 200);
  assert.equal(clear.json().primaryProductId, pA.id, 'reverts to earliest-created member');
});

test('resolveMerged: union by combo; in-stock later member beats out-of-stock earlier member', async () => {
  const g = await db.clusterGroup.findFirst({ where: { name: 'ctest Group1' } });
  const r = await app.inject({ method: 'GET', url: `/api/clusters/${g.id}/resolve`, headers: auth() });
  assert.equal(r.statusCode, 200);
  const { variants } = r.json();
  const byCombo = new Map(variants.map((v) => [`${v.color ?? ''}|${v.size ?? ''}`, v]));
  // red/M only exists on pA → routed to A.
  assert.equal(byCombo.get('red|M').sourceProductName, 'ctest Tee A');
  // blue/M exists on A (out of stock) AND B (in stock) → B wins the tie (1.x rule).
  assert.equal(byCombo.get('blue|M').sourceProductName, 'ctest Tee B');
  assert.equal(byCombo.get('blue|M').sku, 'CTB-BLUE');
  // red/L only on C; green (no size) only on B.
  assert.equal(byCombo.get('red|L').sourceProductName, 'ctest Tee C');
  assert.equal(byCombo.get('green|').sourceProductName, 'ctest Tee B');
  assert.equal(variants.length, 4, 'one entry per combo, deduped');
});

test('drift: member using only color flagged missing "size" (1.x missing/extra shape)', async () => {
  const g = await db.clusterGroup.findFirst({ where: { name: 'ctest Group1' } });
  const r = await app.inject({ method: 'GET', url: `/api/clusters/${g.id}/drift`, headers: auth() });
  assert.equal(r.statusCode, 200);
  const findings = r.json();
  // pB has a size on CTB-BLUE but CTB-GREEN has none — pB still USES size dim
  // via CTB-BLUE, so no drift for pB... pA and pC both use color+size. All
  // three use both dims → expect NO drift findings for this group.
  assert.deepEqual(findings, []);
});

test('drift positive case: color-only member vs color+size members', async () => {
  const pE = await db.product.create({
    data: {
      name: 'ctest Tee E', slug: 'ctest-tee-e', status: 'active', vendorId: vendorB.id,
      variants: { create: [{ sku: 'CTE-BLACK', price: 1500, color: 'black', size: null, inventory: 2 }] },
    },
  });
  const r = await app.inject({ method: 'POST', url: '/api/clusters', headers: auth(), payload: { name: 'ctest DriftGrp', productIds: [pD.id, pE.id, pC.id] } });
  assert.equal(r.statusCode, 201);
  const gid = r.json().id;
  const drift = (await app.inject({ method: 'GET', url: `/api/clusters/${gid}/drift`, headers: auth() })).json();
  // pE uses color only; pC uses color+size (pD has no variants → not compared).
  const e = drift.find((f) => f.productName === 'ctest Tee E');
  assert.ok(e, 'color-only member flagged');
  assert.deepEqual(e.missing, ['size']);
  await db.clusterGroup.delete({ where: { id: gid } });
  await db.product.delete({ where: { id: pE.id } });
});

test('update shrink GCs orphans; steal from another group dissolves 1-member donor; override cleared when its member leaves', async () => {
  const g1 = await db.clusterGroup.findFirst({ where: { name: 'ctest Group1' } });
  // Set explicit primary to pC, then shrink the group to exclude pC:
  await app.inject({ method: 'POST', url: `/api/clusters/${g1.id}/primary`, headers: auth(), payload: { productId: pC.id } });
  const shrunk = await app.inject({ method: 'PATCH', url: `/api/clusters/${g1.id}`, headers: auth(), payload: { productIds: [pA.id, pB.id] } });
  assert.equal(shrunk.statusCode, 200);
  assert.equal(shrunk.json().members.length, 2);
  assert.equal(shrunk.json().primaryProductId, pA.id, 'override on removed member cleared → earliest rules');
  assert.equal(await db.clusterMembership.count({ where: { productId: pC.id } }), 0, 'pC GCed');

  // New group with pC + pD; then steal pC into group1 → donor left with 1 → dissolves.
  const g2 = await app.inject({ method: 'POST', url: '/api/clusters', headers: auth(), payload: { name: 'ctest Donor', productIds: [pC.id, pD.id] } });
  assert.equal(g2.statusCode, 201);
  const donorId = g2.json().id;
  const stolen = await app.inject({ method: 'PATCH', url: `/api/clusters/${g1.id}`, headers: auth(), payload: { productIds: [pA.id, pB.id, pC.id] } });
  assert.equal(stolen.statusCode, 200);
  assert.equal(stolen.json().members.length, 3);
  assert.equal(await db.clusterGroup.count({ where: { id: donorId } }), 0, 'donor group dissolved (1.x sibling-dissolution)');
  assert.equal(await db.clusterMembership.count({ where: { productId: pD.id } }), 0, 'orphaned donor member detached');
});

test('candidates excludes grouped products; delete leaves products intact', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/clusters/candidates?q=ctest', headers: auth() });
  const ids = r.json().map((c) => c.id);
  assert.ok(!ids.includes(pA.id) && !ids.includes(pB.id) && !ids.includes(pC.id), 'grouped members not offered');
  assert.ok(ids.includes(pD.id), 'ungrouped product offered');

  const g1 = await db.clusterGroup.findFirst({ where: { name: 'ctest Group1' } });
  const del = await app.inject({ method: 'DELETE', url: `/api/clusters/${g1.id}`, headers: auth() });
  assert.equal(del.statusCode, 200);
  assert.equal(await db.product.count({ where: { slug: { startsWith: 'ctest-' } } }), 4, 'products untouched by group delete');
});

test('gates: capability off → 403 whole surface; custom role without bundle → 403 mutations, 200 reads', async () => {
  // Bundle gate.
  const role = await db.role.create({ data: { name: 'ctest-limited', bundles: ['read'] } });
  const user = await db.adminUser.create({ data: { username: 'ctest-limited-user', passwordHash: 'x', roleId: role.id } });
  const customAuth = { authorization: `Bearer ${jwt('custom', user.id)}` };
  try {
    const read = await app.inject({ method: 'GET', url: '/api/clusters', headers: customAuth });
    assert.equal(read.statusCode, 200);
    const write = await app.inject({ method: 'POST', url: '/api/clusters', headers: customAuth, payload: { name: 'ctest Nope', productIds: [pA.id, pB.id] } });
    assert.equal(write.statusCode, 403);
    assert.equal(write.json().error.code, 'bundle_required');
  } finally {
    await db.adminUser.delete({ where: { id: user.id } });
    await db.role.delete({ where: { id: role.id } });
  }

  // Capability gate.
  const off = await app.inject({ method: 'PATCH', url: '/api/capabilities/merged-products', headers: auth(), payload: { enabled: false } });
  assert.equal(off.statusCode, 200);
  try {
    const r = await app.inject({ method: 'GET', url: '/api/clusters', headers: auth() });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error.code, 'capability_disabled');
  } finally {
    await app.inject({ method: 'PATCH', url: '/api/capabilities/merged-products', headers: auth(), payload: { enabled: true } });
  }
});
