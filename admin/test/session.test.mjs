// Regression coverage for verifyJwt (lib/session.ts) — verifies the REAL
// admin JWT the backend mints on login/setup. Replaces the earlier test file
// for the retired password-only scheme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyJwt } from '../lib/session.ts';

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
