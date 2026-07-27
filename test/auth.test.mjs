// Regression coverage for real username+password admin auth (replaces the
// earlier password-only stub). Deliberately does NOT test "setup from a truly
// empty table" against this shared dev DB — that would silently consume the
// real one-time setup with a throwaway test password before a human ever
// chooses their own. That path is verified once, for real, interactively.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { hashPassword } from '../dist/lib/password.js';

const SECRET = process.env.JWT_SECRET ?? '';
function adminJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: 'it-setup', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}

let app;
const testUsername = 'it-auth-' + Math.random().toString(36).slice(2, 8);
const testPassword = 'correct-horse-battery-staple';

before(async () => {
  app = await buildServer();
  // Seed a throwaway test account directly (bypassing the one-time HTTP setup
  // gate on purpose) so login/setup-refusal can be tested without touching
  // whatever real account state this shared dev DB already has.
  await db.adminUser.create({ data: { username: testUsername, passwordHash: await hashPassword(testPassword) } });
  // Make sure commerce is ON regardless of what other test files left behind —
  // this file is testing AUTH, not capability gating; don't let that interact.
  await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: { authorization: `Bearer ${adminJwt()}` }, payload: { enabled: true } });
});
after(async () => {
  await db.adminUser.deleteMany({ where: { username: testUsername } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('GET /api/auth/status returns a needsSetup boolean', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/auth/status' });
  assert.equal(r.statusCode, 200);
  assert.equal(typeof r.json().needsSetup, 'boolean');
});

test('login: correct username+password returns a valid-shaped JWT', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: testUsername, password: testPassword } });
  assert.equal(r.statusCode, 200);
  const { token } = r.json();
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'header.payload.signature');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  assert.equal(payload.role, 'admin');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test('login: username matching is case-insensitive (a real bug — "Therum" the account, "therum" typed, got rejected)', async () => {
  const mixedCaseUser = 'It-Auth-Mixed-' + Math.random().toString(36).slice(2, 6);
  await db.adminUser.create({ data: { username: mixedCaseUser, passwordHash: await hashPassword(testPassword) } });
  try {
    const lower = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: mixedCaseUser.toLowerCase(), password: testPassword } });
    assert.equal(lower.statusCode, 200, 'lowercase of a mixed-case stored username still logs in');
    const upper = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: mixedCaseUser.toUpperCase(), password: testPassword } });
    assert.equal(upper.statusCode, 200, 'uppercase also still logs in');
  } finally {
    await db.adminUser.deleteMany({ where: { username: mixedCaseUser } });
  }
});

test('login: wrong password rejected, unknown username rejected — same error either way', async () => {
  const wrongPw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: testUsername, password: 'not-it' } });
  assert.equal(wrongPw.statusCode, 401);
  const unknownUser = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'no-such-user-xyz', password: testPassword } });
  assert.equal(unknownUser.statusCode, 401);
  assert.equal(wrongPw.json().error.message, unknownUser.json().error.message, 'does not reveal which part was wrong');
});

test('a minted login token is accepted by the SAME auth the rest of the API uses (not a parallel system)', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: testUsername, password: testPassword } });
  const { token } = login.json();
  const r = await app.inject({ method: 'GET', url: '/api/orders', headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.statusCode, 200, 'the login-issued token is accepted by app.authenticate on a real protected route');
});

test('setup: refused once any account exists (one-time, not repeatable)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'someone-else', password: 'irrelevant123' } });
  assert.equal(r.statusCode, 409);
});

test('setup: rejects a too-short password and an invalid username with 422', async () => {
  const badPw = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'validname', password: 'short' } });
  assert.equal(badPw.statusCode, 422);
  const badUser = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'bad name!', password: 'longenoughpassword' } });
  assert.equal(badUser.statusCode, 422);
});
