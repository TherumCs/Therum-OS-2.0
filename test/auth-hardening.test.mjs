// Coverage for the auth/security hardening workstream: password policy,
// login rate-limiting, full 2FA enroll->confirm->challenge->verify flow (incl.
// backup codes and the pending2fa-token-can't-access-anything-else guard),
// API tokens (issue/use/scope-enforcement/revoke), and change-password.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { hashPassword } from '../dist/lib/password.js';

const SECRET = process.env.JWT_SECRET ?? '';
function adminJwtFor(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub, role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
function fakeRoleJwt(sub, role) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub, role, iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}

// Local re-implementation of the TOTP generator, independent of src/lib/totp.ts,
// so these tests would actually catch a regression in that file rather than
// just confirming it agrees with itself.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) { const i = B32.indexOf(ch); if (i !== -1) bits += i.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpForStep(secret, step) {
  const key = b32decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1e6).padStart(6, '0');
}
const currentStep = () => Math.floor(Date.now() / 1000 / 30);
function totpNow(secret) {
  return totpForStep(secret, currentStep());
}

let app;
const uName = 'it-hard-' + Math.random().toString(36).slice(2, 8);
const uPass = 'correct-horse-battery-staple';
let uId;

before(async () => {
  app = await buildServer();
  const user = await db.adminUser.create({ data: { username: uName, passwordHash: await hashPassword(uPass) } });
  uId = user.id;
});
after(async () => {
  await db.authEvent.deleteMany({ where: { username: { contains: 'it-hard-' } } });
  await db.apiToken.deleteMany({ where: { userId: uId } });
  await db.adminUser.deleteMany({ where: { username: uName } });
  await app.close();
  await closeQueues();
  await disconnectDb();
  // Deliberately NOT calling disconnectRedis() here, unlike settings.test.mjs.
  // Both files share ONE redis singleton (lib/redis.ts) across the whole
  // `test/*.test.mjs` run. ioredis's .quit() is terminal — combined with
  // maxRetriesPerRequest:null, any command a LATER file issues against an
  // already-quit client queues forever waiting for a reconnect that will
  // never come, hanging node --test with no error and no final summary
  // line. This file sorts alphabetically before settings.test.mjs (which
  // still runs later in the same glob and also touches redis via the
  // system-health check), so it must leave the connection open for that
  // file to keep using — settings.test.mjs's own after() is the one place
  // that actually disconnects it, since nothing after it in glob order
  // touches redis. Fragile (glob-order-dependent) — the durable fix is a
  // per-file redis client or a real global teardown hook; flagged as a
  // follow-up, not worth the redesign mid-workstream.
});

test('setup: rejects a password under the new 10-char minimum', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'irrelevant', password: 'short123' } });
  assert.equal(r.statusCode, 422);
});

test('login rate limiting: locks out after repeated wrong passwords, independent of username case', async () => {
  const rlUser = 'it-hard-rl-' + Math.random().toString(36).slice(2, 6);
  await db.adminUser.create({ data: { username: rlUser, passwordHash: await hashPassword(uPass) } });
  try {
    let lastStatus;
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: rlUser, password: 'wrong' } });
      lastStatus = r.statusCode;
    }
    assert.equal(lastStatus, 401, 'the 10 attempts within the limit should still be normal 401s');
    // 11th attempt (same username, different case) should now be locked —
    // proving the rate-limit key is case-insensitive, matching login itself.
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: rlUser.toUpperCase(), password: 'wrong' } });
    assert.equal(locked.statusCode, 429);
    assert.ok(locked.json().error.details.retryAfterSeconds > 0);
  } finally {
    await db.adminUser.deleteMany({ where: { username: rlUser } });
  }
});

test('2FA: full enroll -> confirm -> login requires challenge -> verify succeeds', async () => {
  const enroll = await app.inject({ method: 'POST', url: '/api/auth/2fa/enroll', headers: { authorization: `Bearer ${adminJwtFor(uId)}` } });
  assert.equal(enroll.statusCode, 200);
  const { secret } = enroll.json();
  assert.match(secret, /^[A-Z2-7]+$/);

  const confirm = await app.inject({ method: 'POST', url: '/api/auth/2fa/confirm', headers: { authorization: `Bearer ${adminJwtFor(uId)}` }, payload: { code: totpNow(secret) } });
  assert.equal(confirm.statusCode, 200);
  const { backupCodes } = confirm.json();
  assert.equal(backupCodes.length, 8);

  // Login now must NOT return a real token — it must demand the second factor.
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: uPass } });
  assert.equal(login.statusCode, 200);
  const loginBody = login.json();
  assert.equal(loginBody.needsTwoFactor, true);
  assert.ok(loginBody.challengeToken);
  assert.equal(loginBody.token, undefined, 'no real session token until 2FA is verified');

  // The pending2fa challenge token must NOT work as a real session token —
  // this is the exact gap found and fixed in middleware/auth.ts.
  const misuse = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${loginBody.challengeToken}` } });
  assert.equal(misuse.statusCode, 401, 'a pending2fa token must never grant real API access');

  // Wrong code fails without consuming the real session.
  const wrongCode = await app.inject({ method: 'POST', url: '/api/auth/verify-2fa', payload: { challengeToken: loginBody.challengeToken, code: '000000' } });
  assert.equal(wrongCode.statusCode, 401);

  // Correct code succeeds and returns a real, working session token. Must
  // request the NEXT step explicitly, not totpNow() again — confirm() above
  // already consumed the current step for anti-replay purposes, and this
  // whole test runs in well under 30s, so a second totpNow() call would
  // likely generate the identical, already-used code and get correctly
  // rejected (this bit the first version of this test for exactly that
  // reason: a real anti-replay behavior, not a bug in the TOTP code itself,
  // which is separately verified against real RFC 4226 vectors).
  const verified = await app.inject({ method: 'POST', url: '/api/auth/verify-2fa', payload: { challengeToken: loginBody.challengeToken, code: totpForStep(secret, currentStep() + 1) } });
  assert.equal(verified.statusCode, 200);
  const realToken = verified.json().token;
  const meCheck = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${realToken}` } });
  assert.equal(meCheck.statusCode, 200);

  // A backup code works exactly once.
  const login2 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: uPass } });
  const challenge2 = login2.json().challengeToken;
  const useBackup1 = await app.inject({ method: 'POST', url: '/api/auth/verify-2fa', payload: { challengeToken: challenge2, code: backupCodes[0] } });
  assert.equal(useBackup1.statusCode, 200, 'an unused backup code should work');

  const login3 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: uPass } });
  const challenge3 = login3.json().challengeToken;
  const reuseBackup1 = await app.inject({ method: 'POST', url: '/api/auth/verify-2fa', payload: { challengeToken: challenge3, code: backupCodes[0] } });
  assert.equal(reuseBackup1.statusCode, 401, 'the same backup code must not work a second time');

  // Disable cleanly turns it back off.
  const disable = await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: { authorization: `Bearer ${adminJwtFor(uId)}` } });
  assert.equal(disable.statusCode, 200);
  const loginAfterDisable = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: uPass } });
  assert.equal(loginAfterDisable.json().needsTwoFactor, undefined, '2FA off means login returns a real token again');
});

test('API tokens: issue, use as bearer auth, scope enforcement, revoke', async () => {
  const issueRead = await app.inject({ method: 'POST', url: '/api/auth/tokens', headers: { authorization: `Bearer ${adminJwtFor(uId)}` }, payload: { name: 'ci-readonly', scope: 'read' } });
  assert.equal(issueRead.statusCode, 201);
  const { token: readToken, id: readTokenId } = issueRead.json();
  assert.match(readToken, /^tro_/);

  // Works as a Bearer credential on a real protected route.
  const useToken = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${readToken}` } });
  assert.equal(useToken.statusCode, 200);
  assert.equal(useToken.json().id, uId);

  // Read-scoped token can't mutate.
  const blockedWrite = await app.inject({ method: 'PATCH', url: '/api/me/dashboard-layout', headers: { authorization: `Bearer ${readToken}` }, payload: { cards: [] } });
  assert.equal(blockedWrite.statusCode, 403);

  // A write-scoped token can.
  const issueWrite = await app.inject({ method: 'POST', url: '/api/auth/tokens', headers: { authorization: `Bearer ${adminJwtFor(uId)}` }, payload: { name: 'ci-write', scope: 'write' } });
  const { token: writeToken, id: writeTokenId } = issueWrite.json();
  const allowedWrite = await app.inject({ method: 'PATCH', url: '/api/me/dashboard-layout', headers: { authorization: `Bearer ${writeToken}` }, payload: { cards: [{ id: 'content', size: 'xs' }] } });
  assert.equal(allowedWrite.statusCode, 200);

  // Listing never re-serializes the hash.
  const list = await app.inject({ method: 'GET', url: '/api/auth/tokens', headers: { authorization: `Bearer ${adminJwtFor(uId)}` } });
  assert.ok(list.json().every((t) => !('tokenHash' in t)));

  // Revoke actually takes effect immediately.
  await app.inject({ method: 'DELETE', url: `/api/auth/tokens/${readTokenId}`, headers: { authorization: `Bearer ${adminJwtFor(uId)}` } });
  const afterRevoke = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${readToken}` } });
  assert.equal(afterRevoke.statusCode, 401);

  await app.inject({ method: 'DELETE', url: `/api/auth/tokens/${writeTokenId}`, headers: { authorization: `Bearer ${adminJwtFor(uId)}` } });
});

test('change-password: requires the correct current password, then the new one actually works', async () => {
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: `Bearer ${adminJwtFor(uId)}` }, payload: { currentPassword: 'not-it', newPassword: 'brand-new-password-1' } });
  assert.equal(wrong.statusCode, 401);

  const ok = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: `Bearer ${adminJwtFor(uId)}` }, payload: { currentPassword: uPass, newPassword: 'brand-new-password-1' } });
  assert.equal(ok.statusCode, 200);

  const oldPwLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: uPass } });
  assert.equal(oldPwLogin.statusCode, 401, 'the old password must stop working');

  const newPwLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: uName, password: 'brand-new-password-1' } });
  assert.equal(newPwLogin.statusCode, 200);
});

test('a token minted with a role other than admin or pending2fa is rejected outright', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${fakeRoleJwt(uId, 'editor')}` } });
  assert.equal(r.statusCode, 401);
});
