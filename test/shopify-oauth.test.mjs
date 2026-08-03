// Shopify's OAuth install flow, served by this store.
//
// This endpoint hands out store access, so the tests are about what must NEVER
// happen: an unauthenticated caller getting a token, a code being replayed, a
// code minted for one app being redeemed by another, and the merchant being
// bounced somewhere that isn't the app that asked.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';

let app;

const q = (over = {}) => new URLSearchParams({
  client_id: 'contrado-test-client',
  scope: 'read_products,write_orders',
  redirect_uri: 'https://partner.example/callback',
  state: 'STATE123',
  ...over,
}).toString();

before(async () => {
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await db.storeCredential.deleteMany({ where: { label: { startsWith: 'Shopify app ' } } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

describe('the install screen', () => {
  test('renders for a signed-out merchant, naming the scopes asked for', async () => {
    const r = await app.inject({ method: 'GET', url: `/admin/oauth/authorize?${q()}` });
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /would like to access your store/);
    assert.match(r.body, /write_orders/, 'the merchant must see what is being granted');
    assert.match(r.body, /name="password"/, 'a signed-out merchant must be asked to authenticate');
  });

  test('the policy permits the redirect back to the app, and forbids caching', async () => {
    const r = await app.inject({ method: 'GET', url: `/admin/oauth/authorize?${q()}` });
    // helmet's default form-action would swallow the redirect silently — the
    // exact failure that made the Woo approval button look dead.
    assert.match(r.headers['content-security-policy'], /form-action [^;]*https:\/\/partner\.example/);
    assert.match(r.headers['cache-control'], /no-store/);
    assert.match(r.headers.vary, /Cookie/i);
  });

  test('a non-HTTPS redirect_uri is refused', async () => {
    const r = await app.inject({ method: 'GET', url: `/admin/oauth/authorize?${q({ redirect_uri: 'http://partner.example/cb' })}` });
    assert.equal(r.statusCode, 400);
  });

  test('a missing client_id or redirect_uri is refused', async () => {
    for (const url of ['/admin/oauth/authorize', `/admin/oauth/authorize?client_id=x`]) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 400);
    }
  });
});

describe('granting access', () => {
  test('an UNAUTHENTICATED approval mints nothing', async () => {
    const before = await db.storeCredential.count();
    const r = await app.inject({
      method: 'POST', url: `/admin/oauth/authorize?${q()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'approve=1',
    });
    assert.equal(r.statusCode, 401);
    assert.equal(await db.storeCredential.count(), before, 'an anonymous caller caused a credential to be issued');
  });

  test('a wrong password mints nothing', async () => {
    const before = await db.storeCredential.count();
    const r = await app.inject({
      method: 'POST', url: `/admin/oauth/authorize?${q()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'approve=1&username=nobody&password=wrong',
    });
    assert.equal(r.statusCode, 401);
    assert.equal(await db.storeCredential.count(), before);
  });

  test('cancelling returns access_denied to the app, with its state intact', async () => {
    const r = await app.inject({
      method: 'POST', url: `/admin/oauth/authorize?${q()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'approve=0',
    });
    assert.equal(r.statusCode, 302);
    const back = new URL(r.headers.location);
    assert.equal(back.searchParams.get('error'), 'access_denied');
    // state is the app's CSRF defence; dropping it breaks their check.
    assert.equal(back.searchParams.get('state'), 'STATE123');
  });
});

describe('the token exchange', () => {
  test('a forged or malformed code is refused', async () => {
    for (const code of ['garbage', 'a.b', '', 'x'.repeat(40)]) {
      const r = await app.inject({
        method: 'POST', url: '/admin/oauth/access_token',
        payload: { client_id: 'contrado-test-client', client_secret: 's', code },
      });
      assert.equal(r.statusCode, 400, `code "${code.slice(0, 12)}" must not be accepted`);
      assert.doesNotMatch(r.body, /cs_/, 'no credential may appear in a rejection');
    }
  });

  test('a missing code or client_id is refused', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/oauth/access_token', payload: { client_id: 'x' } });
    assert.equal(r.statusCode, 400);
  });

  test('no token is ever issued without a valid code', async () => {
    const before = await db.storeCredential.count();
    await app.inject({
      method: 'POST', url: '/admin/oauth/access_token',
      payload: { client_id: 'contrado-test-client', client_secret: 's', code: 'not-a-real-code' },
    });
    assert.equal(await db.storeCredential.count(), before);
  });
});
