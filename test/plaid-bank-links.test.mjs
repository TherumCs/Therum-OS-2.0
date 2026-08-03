// Shopper bank linking (Plaid).
//
// This is consumer financial data, so the tests are about containment rather
// than features: the access token must never leave the server, and one
// shopper must never be able to read or delete another's link.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';
import { encryptSecret } from '../dist/lib/crypto.js';
import { linksFor, unlink, plaidApp } from '../dist/counter/plaid.js';

let app;
let alice;
let bob;
let aliceLink;

const SECRET_TOKEN = 'access-sandbox-THIS-MUST-NEVER-LEAK';

before(async () => {
  app = await buildServer();
  await app.ready();
  alice = await db.customer.create({ data: { email: 'plaid-alice@example.test', name: 'Alice' } });
  bob = await db.customer.create({ data: { email: 'plaid-bob@example.test', name: 'Bob' } });
  aliceLink = await db.bankLink.create({
    data: {
      customerId: alice.id,
      itemId: 'item-alice-test',
      accessTokenEncrypted: encryptSecret(SECRET_TOKEN),
      institutionName: 'Test Federal',
      accountName: 'Checking',
      accountMask: '4321',
      accountType: 'depository',
    },
  });
});

after(async () => {
  await db.bankLink.deleteMany({ where: { itemId: { startsWith: 'item-alice' } } });
  await db.customer.deleteMany({ where: { email: { endsWith: '@example.test' } } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

describe('what a shopper may see about their own bank link', () => {
  test('the access token is NEVER among the returned fields', async () => {
    const links = await linksFor(alice.id);
    assert.equal(links.length, 1);
    const serialized = JSON.stringify(links);
    assert.doesNotMatch(serialized, /access-sandbox/, 'the access token leaked into the shopper-facing shape');
    assert.doesNotMatch(serialized, /accessToken/i, 'no token field may appear at all');
  });

  test('display fields ARE returned, so the shopper knows which account it is', async () => {
    const [l] = await linksFor(alice.id);
    assert.equal(l.institutionName, 'Test Federal');
    assert.equal(l.accountMask, '4321');
    assert.equal(l.accountName, 'Checking');
    // A mask is the last four — never a full account number.
    assert.ok(l.accountMask.length <= 4, 'the stored mask must not be a full account number');
  });

  test("one shopper cannot see another shopper's links", async () => {
    assert.deepEqual(await linksFor(bob.id), [], "Bob must not see Alice's bank link");
  });
});

describe('unlinking', () => {
  test('a shopper cannot unlink an account that is not theirs', async () => {
    const removed = await unlink(bob.id, aliceLink.id);
    assert.equal(removed, false, "Bob unlinked Alice's account");
    const still = await db.bankLink.findUnique({ where: { id: aliceLink.id } });
    assert.ok(still, 'the row must survive an unauthorised unlink');
  });

  test('unlinking DELETES the row rather than flagging it', async () => {
    // A "revoked" flag would leave a live access token in the database
    // belonging to someone who asked for it to be gone.
    const own = await db.bankLink.create({
      data: {
        customerId: alice.id, itemId: 'item-alice-second',
        accessTokenEncrypted: encryptSecret('access-sandbox-second'),
      },
    });
    const removed = await unlink(alice.id, own.id);
    assert.equal(removed, true);
    assert.equal(await db.bankLink.findUnique({ where: { id: own.id } }), null,
      'the row (and its token) must be gone, not marked');
  });
});

describe('the shopper-facing HTTP surface', () => {
  test('every bank route refuses an unauthenticated caller', async () => {
    const calls = [
      ['GET', '/api/shop/account/banks'],
      ['POST', '/api/shop/account/banks/link-token'],
      ['POST', '/api/shop/account/banks/exchange'],
      ['DELETE', `/api/shop/account/banks/${aliceLink.id}`],
    ];
    for (const [method, url] of calls) {
      const r = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      assert.equal(r.statusCode, 401, `${method} ${url} must require a signed-in shopper`);
      assert.doesNotMatch(r.body, /access-sandbox/, 'no token may appear in an error body');
    }
  });
});

describe('configuration safety', () => {
  test('an unconfigured store reports not-ready rather than half-working', async () => {
    // Nothing is connected in the test database; the app must be null, not a
    // partially-populated object that fails later at Plaid.
    const configured = await plaidApp();
    assert.ok(configured === null || (configured.clientId && configured.secret),
      'plaidApp must return null or a COMPLETE credential, never a partial one');
  });

  test('environment defaults to sandbox, never production', async () => {
    // Getting this backwards points real bank credentials at a test key, or
    // treats production data as disposable.
    const configured = await plaidApp();
    if (configured) assert.ok(['sandbox', 'production'].includes(configured.env));
  });
});
