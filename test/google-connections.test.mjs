// Google family (Gmail / Calendar / Sheets / Drive) — catalog presence,
// per-service OAuth scopes, and the shared-app fallback: one Google Cloud
// OAuth app configured under any family member powers all four.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { nexusCatalog } from '../dist/lib/nexusCatalog.js';
import { oauthService } from '../dist/services/oauth.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'gconn-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

const FAMILY = ['google-drive', 'gmail', 'google-calendar', 'google-sheets'];

let app;
before(async () => {
  app = await buildServer();
  // Clean slate for the family's app rows (none are expected to exist in dev).
  await db.oAuthAppCredential.deleteMany({ where: { provider: { in: FAMILY } } });
});
after(async () => {
  await db.oAuthAppCredential.deleteMany({ where: { provider: { in: FAMILY } } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('catalog: 76 providers (67 + 9 fulfillment); all four Google services present and oauth-typed', () => {
  assert.equal(nexusCatalog.length, 76);
  for (const id of FAMILY) {
    const p = nexusCatalog.find((x) => x.id === id);
    assert.ok(p, `${id} in catalog`);
    assert.equal(p.authType, 'oauth');
  }
});

test('oauth providers list includes the whole Google family', () => {
  const providers = oauthService.providers();
  for (const id of FAMILY) assert.ok(providers.includes(id), id);
});

test('testers registered: all four Google services report testable', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/connections', headers: auth() });
  assert.equal(r.statusCode, 200);
  const rows = r.json();
  for (const id of FAMILY) {
    const row = rows.find((x) => x.id === id);
    assert.ok(row, `${id} listed`);
    assert.equal(row.testable, true, `${id} testable`);
  }
});

test('startUrl 409s with no Google app configured anywhere', async () => {
  await assert.rejects(() => oauthService.startUrl('gmail', 'http://localhost/cb'), /No OAuth app configured/);
});

test('shared-app fallback: app configured under google-drive powers gmail/calendar/sheets with per-service scopes', async () => {
  await oauthService.setApp('google-drive', 'test-client-id.apps.googleusercontent.com', 'test-secret');

  const urls = {};
  for (const id of FAMILY) {
    urls[id] = new URL(await oauthService.startUrl(id, 'http://localhost/cb'));
  }
  for (const id of FAMILY) {
    const u = urls[id];
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth', `${id} authorize endpoint`);
    assert.equal(u.searchParams.get('client_id'), 'test-client-id.apps.googleusercontent.com', `${id} uses the shared app`);
    assert.equal(u.searchParams.get('access_type'), 'offline', `${id} requests refresh token`);
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.ok(u.searchParams.get('state'), `${id} carries signed state`);
  }
  assert.match(urls['gmail'].searchParams.get('scope'), /gmail\.readonly/);
  assert.match(urls['google-calendar'].searchParams.get('scope'), /auth\/calendar\.readonly/);
  assert.match(urls['google-sheets'].searchParams.get('scope'), /spreadsheets\.readonly/);
  assert.match(urls['google-drive'].searchParams.get('scope'), /drive\.readonly/);
});

test('non-Google providers do not fall back to the Google app', async () => {
  // slack has no app configured; the google-drive row must not leak to it.
  await assert.rejects(() => oauthService.startUrl('slack', 'http://localhost/cb'), /No OAuth app configured/);
});
