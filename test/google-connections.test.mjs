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

test('catalog: 85 providers; all four Google services present and oauth-typed', () => {
  // 80 since 2026-08-01: Hostinger, the first 'hosting' entry — the provider
  // that owns the MACHINE rather than another integration for the store.
  // 81 with Flodesk (messaging).
  assert.equal(nexusCatalog.length, 85); // +plaid, +merchize, +jetprint, +podpluser, -podplus (not a real provider) — 2026-08-02
  for (const id of FAMILY) {
    const p = nexusCatalog.find((x) => x.id === id);
    assert.ok(p, `${id} in catalog`);
    assert.equal(p.authType, 'oauth');
  }
});

// Sign in with Google is a SEPARATE catalog entry from the Google apps
// family: same vendor, different OAuth application, and it authenticates
// SHOPPERS rather than connecting the merchant's own Drive or Calendar.
// Folding them together would have one set of scopes serving both.
test('customer sign-in providers are their own identity category', () => {
  const identity = nexusCatalog.filter((p) => p.category === 'identity').map((p) => p.id);
  assert.deepEqual(identity.sort(), ['apple-signin', 'facebook-login', 'google-signin']);
  assert.notEqual(nexusCatalog.find((p) => p.id === 'google-signin'), nexusCatalog.find((p) => p.id === 'google-drive'));
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

// `example` is rendered as the INPUT PLACEHOLDER. A sentence there reads as if
// it were the value to type — one said "a token from Printful — NOT a ck_/cs_
// WooCommerce key" and appeared inside the box. Examples must be sample
// VALUES; guidance belongs in credentialHint or note.
test('catalog examples are sample values, not sentences', () => {
  const offenders = [];
  const check = (who, ex) => {
    if (!ex) return;
    if (ex.length > 42 || /—|\bNOT\b/.test(ex)) offenders.push(`${who}: ${ex}`);
  };
  for (const p of nexusCatalog) {
    check(p.id, p.example);
    for (const f of p.fields ?? []) check(`${p.id}/${f.label}`, f.example);
  }
  assert.deepEqual(offenders, [], 'these read as guidance, not as a value');
});

// A pattern that rejects its own example would block a merchant from entering
// anything at all, with no way around it.
test('every catalog example satisfies its own pattern', () => {
  const broken = [];
  for (const p of nexusCatalog) {
    if (p.pattern && p.example && !new RegExp(p.pattern).test(p.example)) broken.push(p.id);
    for (const f of p.fields ?? []) {
      if (f.pattern && f.example && !new RegExp(f.pattern).test(f.example)) broken.push(`${p.id}/${f.label}`);
    }
  }
  assert.deepEqual(broken, []);
});
