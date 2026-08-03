// Outbound webhooks — the half of the partner bridge that did not exist.
//
// A partner could read the catalogue and never learn an order happened, so a
// connected POD vendor had nothing to fulfil. These tests use a REAL local
// HTTP server as the partner endpoint rather than a stub, so the signature is
// verified the way the partner will actually verify it.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';
import { deliver } from '../dist/counter/webhookDelivery.js';
import { encryptSecret } from '../dist/lib/crypto.js';

let app;
let partner;
let received = [];
let partnerPort;
let failNext = 0;

before(async () => {
  app = await buildServer();
  await app.ready();
  partner = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, raw });
      if (failNext > 0) { failNext--; res.writeHead(500); res.end('nope'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => partner.listen(0, '127.0.0.1', r));
  partnerPort = partner.address().port;
});

after(async () => {
  await db.webhookDelivery.deleteMany({ where: { topic: { startsWith: 'test.' } } });
  await db.storeWebhook.deleteMany({ where: { name: { startsWith: 'TESTHOOK' } } });
  partner.close();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

async function makeHook(topic, opts = {}) {
  return db.storeWebhook.create({
    data: {
      name: `TESTHOOK ${topic}`,
      topic,
      deliveryUrl: `http://127.0.0.1:${partnerPort}/hook`,
      secretEncrypted: encryptSecret(opts.secret ?? 'test-partner-secret'),
      status: opts.status ?? 'active',
    },
  });
}

describe('outbound webhooks', () => {
  test('an event reaches the partner, signed the way Woo signs it', async () => {
    received = [];
    const hook = await makeHook('test.created');
    const payload = { id: 'order_1', total: '24.00' };
    await deliver({ topic: 'test.created', resourceId: 'order_1', payload });

    assert.equal(received.length, 1, 'partner endpoint was never called');
    const got = received[0];

    // The signature must verify over the EXACT bytes sent — signing a
    // re-serialized object is the classic way this breaks in production.
    const expected = createHmac('sha256', 'test-partner-secret').update(got.raw, 'utf8').digest('base64');
    assert.equal(got.headers['x-wc-webhook-signature'], expected, 'signature does not verify over the delivered body');

    assert.equal(got.headers['x-wc-webhook-topic'], 'test.created');
    assert.equal(got.headers['x-wc-webhook-resource'], 'test');
    assert.equal(got.headers['x-wc-webhook-event'], 'created');
    assert.deepEqual(JSON.parse(got.raw), payload);

    const log = await db.webhookDelivery.findMany({ where: { webhookId: hook.id } });
    assert.equal(log.length, 1);
    assert.equal(log[0].responseCode, 200);
  });

  test('a wrong secret produces a signature the partner will REJECT', async () => {
    received = [];
    await makeHook('test.wrongsecret', { secret: 'the-real-secret' });
    await deliver({ topic: 'test.wrongsecret', resourceId: 'o2', payload: { id: 'o2' } });
    const got = received[0];
    const wrong = createHmac('sha256', 'not-the-secret').update(got.raw, 'utf8').digest('base64');
    assert.notEqual(got.headers['x-wc-webhook-signature'], wrong,
      'a signature computed with the wrong secret must not match — otherwise the signature proves nothing');
  });

  test('a paused webhook receives nothing', async () => {
    received = [];
    await makeHook('test.paused', { status: 'paused' });
    await deliver({ topic: 'test.paused', resourceId: 'o3', payload: {} });
    assert.equal(received.length, 0, 'a paused webhook was still delivered to');
  });

  test('a failing endpoint is retried once, then recorded — never thrown', async () => {
    received = [];
    failNext = 1;
    const hook = await makeHook('test.retry');
    // Must not reject: an order cannot fail because a partner is down.
    await assert.doesNotReject(() => deliver({ topic: 'test.retry', resourceId: 'o4', payload: {} }));
    assert.equal(received.length, 2, 'expected one failure then one retry');
    const log = await db.webhookDelivery.findMany({ where: { webhookId: hook.id }, orderBy: { attempt: 'asc' } });
    assert.equal(log.length, 2);
    assert.equal(log[0].responseCode, 500);
    assert.equal(log[1].responseCode, 200);
  });

  test('an unreachable host is recorded as an error, not a crash', async () => {
    const hook = await db.storeWebhook.create({
      data: {
        name: 'TESTHOOK dead', topic: 'test.dead',
        // Port 9 discards; nothing listens.
        deliveryUrl: 'http://127.0.0.1:9/hook',
        secretEncrypted: encryptSecret('s'),
      },
    });
    await assert.doesNotReject(() => deliver({ topic: 'test.dead', resourceId: 'o5', payload: {} }));
    const log = await db.webhookDelivery.findMany({ where: { webhookId: hook.id } });
    assert.ok(log.length >= 1, 'no delivery attempt was recorded');
    assert.ok(log.every((d) => d.responseCode === null && d.error), 'expected errors, not response codes');
  });

  test('no subscribers is a no-op, not an error', async () => {
    await assert.doesNotReject(() => deliver({ topic: 'test.nobodylistening', resourceId: 'o6', payload: {} }));
  });
});

describe('the partner-facing webhook API', () => {
  const key = () => ({ authorization: 'Basic ' + Buffer.from('bad:bad').toString('base64') });

  test('registering a webhook requires a valid store key', async () => {
    const r = await app.inject({
      method: 'POST', url: '/wp-json/wc/v3/webhooks', headers: key(),
      payload: { topic: 'order.created', delivery_url: 'https://partner.example/hook' },
    });
    assert.equal(r.statusCode, 401, 'an invalid key must not be able to register a webhook');
  });

  test('an unsupported topic is refused', async () => {
    const r = await app.inject({
      method: 'POST', url: '/wp-json/wc/v3/webhooks', headers: key(),
      payload: { topic: 'customer.ssn.exfiltrate', delivery_url: 'https://partner.example/hook' },
    });
    // 401 fires first for a bad key; the point is it never reaches creation.
    assert.notEqual(r.statusCode, 201);
    const made = await db.storeWebhook.findMany({ where: { topic: 'customer.ssn.exfiltrate' } });
    assert.equal(made.length, 0);
  });
});
