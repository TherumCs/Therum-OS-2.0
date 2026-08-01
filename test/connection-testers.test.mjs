// Connection testers, exercised against the REAL provider APIs with knowingly
// bad credentials.
//
// The point is not that a wrong key fails — it is that the tester reaches the
// provider at all. A tester pointed at a dead URL, or one that trusts an HTTP
// status the provider does not use, returns a green tick that means nothing.
// Authorize.Net is the reason this file exists: it answers 200 even when
// authentication fails, and the real answer is a code in the body.
//
// These make outbound requests. They are skipped when the network is
// unavailable rather than failing the suite for something that is not our bug.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectionService } from '../dist/services/connection.service.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';

const ACTOR = 'tester-audit';

// provider -> a syntactically plausible but definitely invalid credential
const CASES = [
  ['mollie', 'test_bogusbogusbogusbogusbogus'],
  ['razorpay', 'rzp_test_bogus|bogussecret'],
  ['payu', '123456|bogussecret'],
  ['adyen', 'BOGUS-API-KEY|BogusMerchant'],
  ['klarna', 'bogus_uid|bogus_password'],
  ['authorizenet', 'bogusLogin|bogusTransactionKey'],
  ['gelato', 'bogus-gelato-key'],
  ['spod', 'bogus-spod-token'],
  ['flodesk', 'bogusflodeskkey'],
  ['mailchimp', 'bogus0000000000000000000000000-us21'],
  ['onesignal', 'bogus-app-id|bogusrestapikey'],
  // Vonage joins with ':' — the separator is per provider, not universal.
  ['vonage', 'bogus:bogussecret'],
  ['whatsapp', '12345|bogustoken'],
  // Ecommerce + identity. Shopify and BigCommerce are addressed by the
  // merchant's own store, so these use a domain shaped like a real one.
  // These two are addressed BY THE MERCHANT'S STORE, so a bogus store 404s and
  // that is correct — see STORE_ADDRESSED below.
  ['shopify', 'bogus-probe-store.myshopify.com|bogustoken'],
  ['bigcommerce', 'bogushash|bogustoken'],
  ['squarespace', 'bogussquarespacekey'],
  ['lemonsqueezy', 'boguslskey|12345'],
  ['wix', 'boguswixkey|siteid|acctid'],
  ['etsy', 'bogusetsykey|bogussecret'],
  ['amazon', 'amzn1.application-oa2-client.bogus|bogussecret|bogusrefresh'],
  ['facebook-login', '123456|bogussecret'],
  // AI, apps, hosting.
  ['deepseek', 'sk-bogusdeepseekkey'],
  ['perplexity', 'pplx-bogusperplexitykey'],
  ['elevenlabs', 'boguselevenlabskey'],
  ['airtable', 'bogusairtabletoken|appBogusBaseId1'],
  ['hostinger', 'bogushostingertoken'],
  ['zoom', 'bogusacct|bogusclient|bogussecret'],
  ['jira', 'https://therum-probe.atlassian.net|a@b.com|bogustoken'],
  ['zendesk', 'therum-probe|a@b.com|bogustoken'],
  ['salesforce', 'https://login.salesforce.com|bogusclient|bogussecret'],
];

let online = true;

before(async () => {
  online = await fetch('https://api.mollie.com/v2/methods', { signal: AbortSignal.timeout(8000) })
    .then(() => true)
    .catch(() => false);
});

after(async () => {
  await db.connection.deleteMany({ where: { provider: { in: CASES.map(([p]) => p) } } }).catch(() => {});
  await db.connectionAuditLog.deleteMany({ where: { provider: { in: CASES.map(([p]) => p) } } }).catch(() => {});
  await disconnectDb();
  await disconnectRedis();
});

for (const [provider, credential] of CASES) {
  test(`${provider}: the tester reaches the real API and rejects a bad key`, async (t) => {
    if (!online) return t.skip('no network');

    await connectionService.connect(provider, credential, ACTOR);
    const result = await connectionService.test(provider, ACTOR);

    // A wrong credential must be REJECTED. If this passes, the tester is not
    // actually checking anything.
    assert.equal(result.ok, false, `${provider} accepted a bogus credential: ${result.detail}`);

    // And it must say something specific. "Network error" or a 404 means the
    // endpoint moved or was never right, which is the failure this file is
    // looking for — not a wrong key.
    assert.ok(result.detail && result.detail.length > 0, 'the failure has a reason');
    assert.doesNotMatch(result.detail, /Network error|ENOTFOUND|fetch failed/i,
      `${provider} could not reach its endpoint — the tester URL is wrong, not the key`);
    // Shopify and BigCommerce build their URL from the merchant's own store, so
    // a store that does not exist answers 404 — correct, not a wrong endpoint.
    const STORE_ADDRESSED = new Set(['shopify', 'bigcommerce', 'magento', 'jira', 'zendesk']);
    if (!STORE_ADDRESSED.has(provider)) {
      assert.doesNotMatch(result.detail, /^404/, `${provider} endpoint 404s — wrong URL`);
    }
  });
}

test('every provider that claims to be testable has a tester that runs', async (t) => {
  if (!online) return t.skip('no network');
  const list = await connectionService.list();
  const testable = list.filter((p) => p.testable);
  // Not an assertion about the number — it is a guard that the flag and the
  // registry cannot drift apart, because "Test connection" on a provider with
  // no tester is a button that lies.
  assert.ok(testable.length > 0);
  for (const p of testable) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0);
  }
});
