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
import { settingsService } from '../dist/services/settings.service.js';

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
  // These tests share the DEVELOPMENT database, and 2FA enforcement is a
  // site-wide setting. A run killed mid-test leaves it ON, which then 403s
  // every unrelated test in the next run — and locks the developer out of
  // their own admin. Clearing it here makes that unrecoverable state
  // self-healing rather than something to debug twice.
  await settingsService.setSecurity({ requireTwoFactor: false });
  app = await buildServer();
  const user = await db.adminUser.create({ data: { username: uName, passwordHash: await hashPassword(uPass) } });
  uId = user.id;
});
after(async () => {
  // Belt and braces: `withEnforcement` restores it too, but an assertion that
  // throws outside that helper must not leave the flag set.
  await settingsService.setSecurity({ requireTwoFactor: false });
  await db.authEvent.deleteMany({ where: { username: { contains: 'it-hard-' } } });
  await db.apiToken.deleteMany({ where: { userId: uId } });
  if (efId) await db.apiToken.deleteMany({ where: { userId: efId } });
  await db.adminUser.deleteMany({ where: { username: { in: [uName, efName] } } });
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

// ─── 2FA enforcement (site-wide) ────────────────────────────────────────────
//
// The setting is restored through settingsService directly rather than over
// HTTP, because HTTP is exactly what the feature under test blocks — a
// cleanup that has to get past the gate it just enabled is a cleanup that
// fails when the gate works. Leaving enforcement on would strand every later
// test in this run AND the developer's own login.
async function withEnforcement(fn) {
  await settingsService.setSecurity({ requireTwoFactor: true });
  try {
    await fn();
  } finally {
    await settingsService.setSecurity({ requireTwoFactor: false });
    if (efId) {
      await db.adminUser.update({
        where: { id: efId },
        data: { totpEnabled: false, totpSecret: null, backupCodes: null, totpLastStep: null },
      });
    }
  }
}

// A DEDICATED account, not the shared `uName` one. Earlier tests in this file
// change that user's password and deliberately trip its login rate limiter, so
// reusing it here made these tests fail on a 401 that had nothing to do with
// 2FA — a false failure pointing at the wrong feature.
const efName = 'it-hard-2fa-' + Math.random().toString(36).slice(2, 8);
const efPass = 'enforcement-test-passphrase';
let efId;

async function enforcementUser() {
  if (!efId) {
    const u = await db.adminUser.create({ data: { username: efName, passwordHash: await hashPassword(efPass) } });
    efId = u.id;
  }
  return efId;
}

async function sessionToken() {
  const id = await enforcementUser();
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: efName, password: efPass } });
  const body = JSON.parse(r.body);
  assert.ok(body.token, `login failed (${r.statusCode}): ${r.body}`);
  return { token: body.token, id };
}

test('enforcement leaves the password login working — it gates the session, not the door', async () => {
  await withEnforcement(async () => {
    await enforcementUser();
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: efName, password: efPass } });
    // Refusing the login itself would lock out every existing account the
    // instant the toggle is flipped, including whoever flipped it.
    assert.equal(r.statusCode, 200);
    assert.ok(JSON.parse(r.body).token, 'no session token issued');
  });
});

test('an un-enrolled session is refused everywhere except enrolment', async () => {
  await withEnforcement(async () => {
    const { token } = await sessionToken();
    const auth = { authorization: `Bearer ${token}` };

    const blocked = await app.inject({ method: 'GET', url: '/api/settings/site', headers: auth });
    assert.equal(blocked.statusCode, 403);
    assert.equal(JSON.parse(blocked.body).error.code, 'two_factor_required');

    for (const url of ['/api/me', '/api/auth/2fa']) {
      const r = await app.inject({ method: 'GET', url, headers: auth });
      assert.equal(r.statusCode, 200, `${url} must stay reachable or enrolment is impossible`);
    }
    const enroll = await app.inject({ method: 'POST', url: '/api/auth/2fa/enroll', headers: auth });
    assert.equal(enroll.statusCode, 200);

    // Not on the allowlist on purpose: opting back out cannot be the escape hatch.
    const disable = await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: auth });
    assert.equal(disable.statusCode, 403);
  });
});

test('/api/me tells the admin shell to show enrolment', async () => {
  await withEnforcement(async () => {
    const { token } = await sessionToken();
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })).body);
    assert.equal(me.mustEnrollTwoFactor, true);
    assert.equal(me.twoFactorEnabled, false);
  });
});

test('enrolling ends the block — the way out actually works', async () => {
  await withEnforcement(async () => {
    const { token } = await sessionToken();
    const auth = { authorization: `Bearer ${token}` };
    const { secret } = JSON.parse((await app.inject({ method: 'POST', url: '/api/auth/2fa/enroll', headers: auth })).body);
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/auth/2fa/confirm',
      headers: auth,
      payload: { code: totpNow(secret) },
    });
    assert.equal(confirm.statusCode, 200);
    assert.equal(JSON.parse(confirm.body).backupCodes.length, 8);

    const after = await app.inject({ method: 'GET', url: '/api/settings/site', headers: auth });
    assert.equal(after.statusCode, 200, 'still blocked after enrolling');
  });
});

test('an API token from an un-enrolled account is refused, with a reason', async () => {
  const issued = JSON.parse(
    (await app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: { authorization: `Bearer ${adminJwtFor(await enforcementUser())}` },
      payload: { name: 'enforcement-probe', scope: 'read' },
    })).body,
  );
  const apiToken = issued.token;
  const ok = await app.inject({ method: 'GET', url: '/api/settings/site', headers: { authorization: `Bearer ${apiToken}` } });
  assert.equal(ok.statusCode, 200);

  await withEnforcement(async () => {
    // A token has no interactive session behind it, so it cannot enrol and the
    // allowlist would be meaningless — it fails, but says why.
    const r = await app.inject({ method: 'GET', url: '/api/settings/site', headers: { authorization: `Bearer ${apiToken}` } });
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).error.code, 'two_factor_required');
  });
});

test('enforcementReadiness reports who would be affected before the toggle is flipped', async () => {
  const id = await enforcementUser();
  const r = await app.inject({ method: 'GET', url: '/api/settings/security', headers: { authorization: `Bearer ${adminJwtFor(id)}` } });
  assert.equal(r.statusCode, 200);
  const { readiness } = JSON.parse(r.body);
  const me = readiness.withoutTwoFactor.find((u) => u.username === efName);
  assert.ok(me, 'the un-enrolled test user is missing from the readiness list');
  assert.ok(readiness.total >= 1 && readiness.enrolled >= 0);
});

test('turning enforcement off restores access immediately, not after a cache TTL', async () => {
  await settingsService.setSecurity({ requireTwoFactor: true });
  const { token } = await sessionToken();
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings/site', headers: auth })).statusCode, 403);
  await settingsService.setSecurity({ requireTwoFactor: false });
  // The cached read is cleared on write. If it were only TTL-bounded, an
  // admin undoing a mistake would sit locked out watching nothing happen.
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings/site', headers: auth })).statusCode, 200);
});
