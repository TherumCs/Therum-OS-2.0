// Regression coverage for verifyJwt (lib/session.ts) — verifies the REAL
// admin JWT the backend mints on login/setup. Replaces the earlier test file
// for the retired password-only scheme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyJwt, inspectSession, shouldRenew, signSession, SESSION_TTL_SECONDS } from '../lib/session.ts';

const SECRET = process.env.JWT_SECRET;

function mint(overrides = {}) {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'user-1', role: 'admin', iat: now, exp: now + 3600, ...overrides };
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  return `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

test('verifyJwt accepts a validly-signed, unexpired token and returns sub/role', async () => {
  const result = await verifyJwt(mint());
  assert.deepEqual(result, { sub: 'user-1', role: 'admin' });
});

test('verifyJwt rejects tampering, malformed input, and absence', async () => {
  const [h, p, s] = mint().split('.');
  const tamperedSig = s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A');
  assert.equal(await verifyJwt(`${h}.${p}.${tamperedSig}`), null, 'flipped signature rejected');
  assert.equal(await verifyJwt('not.a.jwt.at.all'), null, 'wrong segment count rejected');
  assert.equal(await verifyJwt('garbage'), null, 'no dots at all rejected');
  assert.equal(await verifyJwt(''), null);
  assert.equal(await verifyJwt(undefined), null);
  assert.equal(await verifyJwt(null), null);
});

test('verifyJwt rejects an expired-but-validly-signed token', async () => {
  const expired = mint({ exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(await verifyJwt(expired), null);
});

test('verifyJwt rejects a token signed with the wrong secret', async () => {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'x', role: 'admin', iat: now, exp: now + 3600 })}`;
  const wrongSecretToken = `${data}.${createHmac('sha256', 'totally-different-secret').update(data).digest('base64url')}`;
  assert.equal(await verifyJwt(wrongSecretToken), null);
});

test('verifyJwt rejects a token missing sub/role claims', async () => {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iat: now, exp: now + 3600 })}`;
  const noClaims = `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
  assert.equal(await verifyJwt(noClaims), null);
});

// ── Sliding sessions ───────────────────────────────────────────────────
// The admin used to sign you out mid-work: a 12h token that nothing renewed.
// An ACTIVE session must renew; an idle one must still expire.

function mintWithLife(secondsLeft) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin', iat: now, exp: now + secondsLeft })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

test('shouldRenew: only once past halfway through the token life', () => {
  assert.equal(shouldRenew(mintWithLife(SESSION_TTL_SECONDS - 60)), false, 'a fresh token is not renewed on every request');
  assert.equal(shouldRenew(mintWithLife(Math.floor(SESSION_TTL_SECONDS / 2) - 60)), true, 'past halfway it renews');
  assert.equal(shouldRenew(mintWithLife(60)), true, 'nearly dead renews');
  assert.equal(shouldRenew('not-a-token'), false, 'garbage does not throw');
});

test('signSession mints a token this app accepts, with a full lifetime', async () => {
  const fresh = await signSession('u1', 'admin');
  const seen = await verifyJwt(fresh);
  assert.equal(seen?.sub, 'u1');
  assert.equal(seen?.role, 'admin');
  const { exp } = JSON.parse(Buffer.from(fresh.split('.')[1], 'base64url').toString());
  const life = exp - Math.floor(Date.now() / 1000);
  assert.ok(life > SESSION_TTL_SECONDS - 30 && life <= SESSION_TTL_SECONDS, `renewed token should carry a full life, got ${life}s`);
  assert.equal(shouldRenew(fresh), false, 'a just-renewed token is not immediately renewed again');
});

test('inspectSession names WHY a session failed, not just that it did', async () => {
  assert.equal((await inspectSession(undefined)).verdict, 'no-cookie');
  // A well-formed token signed with the WRONG secret — which in practice means
  // the admin and the API are running with different JWT_SECRETs, the failure
  // this verdict exists to name.
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', role: 'admin', iat: now, exp: now + 600 })).toString('base64url');
  const wrongSig = createHmac('sha256', 'a-different-secret-entirely-not-the-real-one').update(`${header}.${payload}`).digest('base64url');
  assert.equal((await inspectSession(`${header}.${payload}.${wrongSig}`)).verdict, 'bad-signature');
  // Garbage that is not even base64 is reported separately rather than being
  // mislabelled as a signature failure.
  assert.equal((await inspectSession('a.b.c')).verdict, 'verify-threw');
  assert.equal((await inspectSession(mintWithLife(-60))).verdict, 'expired');
  assert.equal((await inspectSession(await signSession('u1', 'admin'))).verdict, 'ok');
});
