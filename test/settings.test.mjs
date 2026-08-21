// Coverage for the new Settings/System/Me slice added for the dashboard +
// sidebar + design-system workstream. Also exercises the specific bug this
// slice depends on being fixed: per-user data (dashboard layout) needs the
// REAL admin user's id in the JWT `sub`, not a shared synthetic token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { hashPassword } from '../dist/lib/password.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwtFor(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub, role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}

let app;
const userA = 'it-settings-a-' + Math.random().toString(36).slice(2, 8);
const userB = 'it-settings-b-' + Math.random().toString(36).slice(2, 8);
let idA, idB;
// The real operator's saved appearance, snapshotted so this suite can (a)
// test the true defaults-when-unset path and (b) put everything back exactly
// as found. The previous version deleted the row outright in after() — every
// suite run silently destroyed the operator's saved theme.
let savedAppearance = null;

before(async () => {
  app = await buildServer();
  const a = await db.adminUser.create({ data: { username: userA, passwordHash: await hashPassword('correct-horse-battery') } });
  const b = await db.adminUser.create({ data: { username: userB, passwordHash: await hashPassword('correct-horse-battery') } });
  idA = a.id;
  idB = b.id;
  savedAppearance = await db.setting.findUnique({ where: { key: 'appearance' } });
  if (savedAppearance) await db.setting.delete({ where: { key: 'appearance' } });
});
after(async () => {
  await db.adminUser.deleteMany({ where: { username: { in: [userA, userB] } } });
  await db.setting.deleteMany({ where: { key: 'appearance' } });
  if (savedAppearance) {
    await db.setting.create({ data: { key: savedAppearance.key, value: savedAppearance.value } });
  }
  await app.close();
  // closeQueues() also quits the lazy redis client this file's system-health
  // test opens (it was the file that first discovered that leak) — a second
  // explicit disconnectRedis() here would double-quit and throw.
  await closeQueues();
  await disconnectDb();
});

test('GET /api/settings/appearance returns defaults when unset', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/settings/appearance', headers: { authorization: `Bearer ${jwtFor(idA)}` } });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.density, 'comfortable');
  assert.equal(body.colorMode, 'light');
});

test('PATCH /api/settings/appearance persists a partial update and merges with existing', async () => {
  const first = await app.inject({ method: 'PATCH', url: '/api/settings/appearance', headers: { authorization: `Bearer ${jwtFor(idA)}` }, payload: { density: 'compact' } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().density, 'compact');

  const second = await app.inject({ method: 'PATCH', url: '/api/settings/appearance', headers: { authorization: `Bearer ${jwtFor(idA)}` }, payload: { colorMode: 'dark' } });
  assert.equal(second.statusCode, 200);
  // density from the first PATCH must survive an unrelated second PATCH —
  // this is a merge, not an overwrite.
  assert.equal(second.json().density, 'compact');
  assert.equal(second.json().colorMode, 'dark');
});

test('PATCH /api/settings/appearance rejects an invalid enum value', async () => {
  const r = await app.inject({ method: 'PATCH', url: '/api/settings/appearance', headers: { authorization: `Bearer ${jwtFor(idA)}` }, payload: { density: 'cozy' } });
  assert.equal(r.statusCode, 422);
});

test('GET /api/system/health reports real checks, not a decorative all-ok', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/health', headers: { authorization: `Bearer ${jwtFor(idA)}` } });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.ok(Array.isArray(body.checks) && body.checks.length >= 5);
  const db_ = body.checks.find((c) => c.id === 'database');
  assert.equal(db_.status, 'ok', 'the real DB check should pass against the actual test database');
  assert.ok(['ok', 'warn', 'error'].includes(body.status));
});

test('GET /api/system/health requires auth (unlike the bare /health liveness probe)', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/system/health' });
  assert.equal(r.statusCode, 401);
});

test('GET /api/me returns the real user id from the token, with a default dashboard layout', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${jwtFor(idA)}` } });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.id, idA);
  assert.ok(Array.isArray(body.dashboardLayout) && body.dashboardLayout.length > 0);
});

test('PATCH /api/me/dashboard-layout is genuinely per-user, not shared/global state', async () => {
  const layoutA = [{ id: 'content', size: 'lg' }];
  const layoutB = [{ id: 'media', size: 'sm' }];

  const saveA = await app.inject({ method: 'PATCH', url: '/api/me/dashboard-layout', headers: { authorization: `Bearer ${jwtFor(idA)}` }, payload: { cards: layoutA } });
  assert.equal(saveA.statusCode, 200);
  const saveB = await app.inject({ method: 'PATCH', url: '/api/me/dashboard-layout', headers: { authorization: `Bearer ${jwtFor(idB)}` }, payload: { cards: layoutB } });
  assert.equal(saveB.statusCode, 200);

  const readA = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${jwtFor(idA)}` } });
  const readB = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${jwtFor(idB)}` } });
  assert.deepEqual(readA.json().dashboardLayout, layoutA);
  assert.deepEqual(readB.json().dashboardLayout, layoutB);
});

test('GET /api/me 404s for a token sub that is not a real admin user (e.g. a stale synthetic token)', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${jwtFor('admin-ui')}` } });
  assert.equal(r.statusCode, 404);
});
